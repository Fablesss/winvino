"""OCR рендеров каталога через PaddleOCR PP-OCRv5.

Только распознавание: на вход список картинок, на выход JSONL — строка на кадр.
Матчинг и запись в базу остаются на стороне Node (scripts/lib/matcher.mjs).

Результат пишется построчно со сбросом на диск, и при повторном запуске уже
обработанные кадры пропускаются. Полный прогон по каталогу идёт десятки минут, и
оборванный процесс не должен терять сделанное.

    .venv-ocr\\Scripts\\python.exe ocr/paddle_ocr.py --list files.txt --out result.jsonl
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import statistics
import sys
import time
from ctypes import wintypes
from pathlib import Path

# Без этого PaddleX на старте ходит проверять доступность источников моделей.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

import cv2  # noqa: E402
import numpy as np  # noqa: E402


def peak_memory_mb() -> float:
    """Пиковый рабочий набор процесса. Через WinAPI, чтобы не тянуть psutil."""
    if sys.platform != "win32":
        import resource

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

    class Counters(ctypes.Structure):
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    kernel32 = ctypes.windll.kernel32
    psapi = ctypes.windll.psapi
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    counters = Counters()
    counters.cb = ctypes.sizeof(Counters)
    psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb)
    return counters.PeakWorkingSetSize / 1024 / 1024


def load_flat(path: Path, min_width: int) -> tuple[np.ndarray, int, int]:
    """Читает рендер и плющит альфу на БЕЛЫЙ фон.

    Рендеры каталога приходят с вырезанным фоном. Если альфу просто отбросить,
    прозрачное станет чёрным, и тёмный текст на светлой этикетке потеряет контраст.
    np.fromfile + imdecode — потому что cv2.imread на Windows не открывает пути
    с не-ASCII символами.
    """
    img = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"не удалось декодировать {path}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        img = (img[:, :, :3].astype(np.float32) * alpha + 255.0 * (1.0 - alpha)).astype(np.uint8)

    height, width = img.shape[:2]
    if min_width and width < min_width:
        scale = min_width / width
        img = cv2.resize(img, (min_width, round(height * scale)), interpolation=cv2.INTER_CUBIC)
    return img, width, height


def build_ocr(args: argparse.Namespace):
    from paddleocr import PaddleOCR

    return PaddleOCR(
        text_detection_model_name=f"PP-OCRv5_{args.det}_det",
        text_recognition_model_name=args.rec,
        # Модули для страниц документов: на бутылке только добавляют время.
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="cpu",
        enable_mkldnn=not args.no_mkldnn,
        cpu_threads=args.threads,
    )


def extract_lines(result) -> list[dict]:
    """Строки и уверенности из результата PaddleOCR 3.x в порядке детектора."""
    data = result.json.get("res", result.json) if hasattr(result, "json") else result
    texts = data.get("rec_texts", [])
    scores = data.get("rec_scores", [])
    return [{"text": t, "score": round(float(s), 4)} for t, s in zip(texts, scores)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", required=True, help="файл со списком картинок, по пути на строку")
    parser.add_argument("--out", required=True, help="JSONL с результатами; дописывается")
    parser.add_argument("--det", choices=["mobile", "server"], default="mobile")
    parser.add_argument("--rec", default="eslav_PP-OCRv5_mobile_rec")
    parser.add_argument("--min-width", type=int, default=0, help="апскейл узких кадров до этой ширины; 0 — без апскейла")
    parser.add_argument("--threads", type=int, default=4)
    # В paddlepaddle 3.3.1 на CPU связка oneDNN + исполнитель PIR падает на каждом кадре:
    # "ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]".
    parser.add_argument("--no-mkldnn", action="store_true", help="отключить oneDNN (обход ошибки Paddle 3.3 на CPU)")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    files = [line.strip() for line in Path(args.list).read_text(encoding="utf-8").splitlines() if line.strip()]
    out_path = Path(args.out)

    # Готовыми считаются только УСПЕШНЫЕ кадры: иначе запись с ошибкой навсегда
    # исключила бы кадр из обработки. Повторы одного файла при чтении JSONL на
    # стороне Node разрешаются в пользу последней записи.
    done: set[str] = set()
    if out_path.exists():
        for line in out_path.read_text(encoding="utf-8").splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue  # обрыв посреди строки при прошлом запуске
            if "file" in record and "error" not in record:
                done.add(record["file"])
    todo = [f for f in files if f not in done]
    print(f"кадров в списке: {len(files)}, уже готово: {len(done)}, к обработке: {len(todo)}", file=sys.stderr)
    if not todo:
        return 0

    t_init = time.perf_counter()
    ocr = build_ocr(args)
    init_s = time.perf_counter() - t_init
    print(f"инициализация: {init_s:.1f} с, память после загрузки моделей: {peak_memory_mb():.0f} МБ", file=sys.stderr)

    timings: list[float] = []
    engine = f"paddleocr PP-OCRv5_{args.det}_det + {args.rec}"
    with out_path.open("a", encoding="utf-8") as out:
        for i, rel in enumerate(todo, 1):
            record = {"file": rel, "engine": engine, "min_width": args.min_width}
            try:
                img, width, height = load_flat(root / rel, args.min_width)
                t0 = time.perf_counter()
                results = ocr.predict(img)
                ms = (time.perf_counter() - t0) * 1000
                lines = extract_lines(results[0]) if results else []
                record.update(
                    width=width,
                    height=height,
                    ms=round(ms),
                    lines=lines,
                    text=" ".join(line["text"] for line in lines),
                )
                timings.append(ms)
            except Exception as err:  # кадр не должен ронять весь прогон
                record.update(error=f"{type(err).__name__}: {err}", lines=[], text="")
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            out.flush()
            if i % 50 == 0:
                avg = statistics.mean(timings) if timings else 0
                left_min = (len(todo) - i) * avg / 60000
                print(f"  {i}/{len(todo)}  {avg:.0f} мс/кадр  осталось ~{left_min:.0f} мин", file=sys.stderr)

    if timings:
        ordered = sorted(timings)
        summary = {
            "frames": len(timings),
            "init_s": round(init_s, 1),
            "avg_ms": round(statistics.mean(ordered)),
            "p50_ms": round(ordered[len(ordered) // 2]),
            "p90_ms": round(ordered[int(len(ordered) * 0.9)]),
            "max_ms": round(ordered[-1]),
            "peak_memory_mb": round(peak_memory_mb()),
        }
        print("SUMMARY " + json.dumps(summary, ensure_ascii=False), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
