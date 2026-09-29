"""Пары слагов с одинаковым или почти одинаковым рендером каталога (WIN-9).

Считается по кешу визуального индекса: эмбеддинги референсов уже лежат в
`data/raw/model/index/`, поэтому прогон модели не нужен — только numpy.

Классы пары, по убыванию однозначности:
  same_file   — один и тот же файл на двух слагах (`shared_image` в манифесте);
  same_bytes  — разные имена файлов, побайтово одна картинка;
  near        — сходство видов >= --min-sim.

Признак `same_title` отделяет дубли одного вина (одно название, два слага) от разных
вин с неразличимым фото: первое владелец каталога должен схлопнуть, второму — поправить
фото. Сходство считается так же, как в поиске: максимум по парам видов референса.

    .venv-ml\\Scripts\\python.exe -m ml.dupes --min-sim 0.95
→ data/raw/dataset/dupes/pairs.csv, pairs.json, sheet_*.jpg и docs/CATALOG-DUPES.md
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from datetime import date
from itertools import combinations
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .common import CATALOG_PATH, DATASET_DIR, ROOT, CatalogItem, cutout, flatten, load_cached, load_catalog
from .retrieval import index_cache_path

OUT_DIR = DATASET_DIR / "dupes"
MD_PATH = ROOT / "docs" / "CATALOG-DUPES.md"
# Прямой путь /uploads/... сайт отдаёт 404, картинка доступна только через ресайзер (см. scripts/lib/render.mjs).
IMG_URL = "https://api.vino-svoe.ru/v1/img/str-api/{box}/{box}/resize/uploads/{file}"
SITE_URL = "https://vino-svoe.ru/wines/{slug}"


def ref_sim(emb: np.ndarray) -> np.ndarray:
    """[n, views, d] → [n, n]: максимум сходства по парам видов, как в `VisualIndex.scores`."""
    e = emb / np.linalg.norm(emb, axis=-1, keepdims=True)
    s = np.full((len(e), len(e)), -1.0, np.float32)
    for a in range(e.shape[1]):
        for b in range(e.shape[1]):
            np.maximum(s, e[:, a] @ e[:, b].T, out=s)
    return s


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tokens(title: str) -> set[str]:
    return {t for t in re.split(r"[^0-9a-zа-яё]+", title.lower().replace("ё", "е")) if t}


def norm_title(title: str) -> str:
    """Порядок слов сохраняется: «Фантом 30/70» и «Фантом 70/30» — разные вина."""
    return " ".join(t for t in re.split(r"[^0-9a-zа-яё]+", title.lower().replace("ё", "е")) if t)


def title_dupes(catalog: list[CatalogItem]) -> list[tuple[CatalogItem, CatalogItem, str]]:
    """Дубли одного вина, найденные по названию, а не по картинке.

    Порог сходства рендеров их не ловит: одно вино заводят дважды с разными фото, и
    «Жемчужная 9 Пино нуар» против «Жемчужная 9 Пино Нуар» отличаются только регистром.
    Ищем только внутри винодельни — совпадение названий у разных производителей («Мускат»)
    дублем не является. Две степени уверенности:
      title_exact  — название и категория совпадают после нормализации, дубль почти наверняка;
      title_subset — одно название вложено в другое по словам, решает человек.

    Категория обязательна для `title_exact`: цвет и сладость живут не в названии, поэтому у
    Alma Valley «Солнце, воздух, виноград» — это линейка из белого, красного и розового, а не
    один слаг трижды.
    """
    by_winery: dict[str, list[CatalogItem]] = {}
    for c in catalog:
        by_winery.setdefault(c.winery.strip().lower(), []).append(c)
    out = []
    for items in by_winery.values():
        for a, b in combinations(sorted(items, key=lambda c: c.slug), 2):
            if a.image.name == b.image.name:
                continue  # это уже same_file
            same_category = a.category.strip().lower() == b.category.strip().lower()
            if norm_title(a.title) == norm_title(b.title) and same_category:
                out.append((a, b, "title_exact"))
            elif one_wine(a, b):
                out.append((a, b, "title_subset"))
    return out


def one_wine(a: CatalogItem, b: CatalogItem) -> bool:
    """Похоже на одно вино под двумя слагами: одно название вложено в другое по словам.

    Каталог пишет одно и то же вино и коротко, и полностью («Новый Свет. Каберне» против
    «Российское шампанское выдержанное брют розовое „Новый Свет. Каберне“»), поэтому точное
    совпадение строк такие дубли не ловит. Различающее слово (сорт, год, сладость) вложению
    мешает, так что «Мезенка: Рислинг сухое» и «…полусухое» здесь не пара — и правильно.
    """
    ta, tb = tokens(a.title), tokens(b.title)
    return bool(ta) and bool(tb) and (ta <= tb or tb <= ta)


# Три разные проблемы, у каждой свой адресат: первые две — к владельцу каталога, третья — к
# модели (WIN-12), там фото действительно разные. Имена групп — ключ для потребителей
# выгрузки (`scripts/build-eval-exclusions.mjs`), менять их вместе с ними.
BROKEN_PHOTO = "одно фото на разные вина"
DUPLICATE_WINE = "дубль одного вина"
SAME_DESIGN = "разные вина, похожий дизайн"
CANDIDATE = "кандидат в дубли, решает человек"


def group_of(kind: str, is_one_wine: bool) -> str:
    """Группа определяет адресата и то, попадёт ли пара в исключения оценки.

    `title_subset` в метрику не идёт: «Пино Нуар» вложено в «Пино Нуар Джавага», но это
    разные вина, и выкинуть такие кадры значило бы подогнать цифру.
    """
    if kind == "title_subset":
        return CANDIDATE
    if is_one_wine:
        return DUPLICATE_WINE
    return SAME_DESIGN if kind == "near" else BROKEN_PHOTO


def pair_row(kind: str, sim: float, a: CatalogItem, b: CatalogItem) -> dict:
    return {
        "kind": kind,
        "group": group_of(kind, one_wine(a, b)),
        "sim": round(sim, 4),
        "one_wine": one_wine(a, b),
        "same_title": a.title.strip().lower() == b.title.strip().lower(),
        "same_winery": a.winery.strip().lower() == b.winery.strip().lower(),
        "category_diff": a.category.strip().lower() != b.category.strip().lower(),
        "slug_a": a.slug, "title_a": a.title, "winery_a": a.winery, "category_a": a.category,
        "slug_b": b.slug, "title_b": b.title, "winery_b": b.winery, "category_b": b.category,
        "file_a": a.image.name, "file_b": b.image.name,
    }


def font(size: int):
    """Встроенный шрифт PIL — битмапный latin-1, кириллица в подписях станет квадратами."""
    for name in ("arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def write_sheets(rows: list[dict], item_by_slug: dict[str, CatalogItem], top: int) -> None:
    """Лист: строка = два рендера пары. Шесть пар на лист, чтобы решать глазами."""
    for old in OUT_DIR.glob("sheet_*.jpg"):
        old.unlink()
    cell, per_sheet = 300, 6
    f_title, f_small = font(13), font(11)
    for s in range(0, min(top, len(rows)), per_sheet):
        chunk = rows[s: s + per_sheet]
        sheet = Image.new("RGB", (cell * 2, cell * len(chunk)), "white")
        draw = ImageDraw.Draw(sheet)
        for r_i, r in enumerate(chunk):
            for c_i, side in enumerate("ab"):
                item = item_by_slug[r[f"slug_{side}"]]
                tile = flatten(cutout(load_cached(item.image)))
                tile.thumbnail((cell - 6, cell - 30))
                sheet.paste(tile, (c_i * cell + 3, r_i * cell + 3))
                draw.text((c_i * cell + 3, r_i * cell + cell - 26), item.title[:44], fill="blue", font=f_title)
                draw.text((c_i * cell + 3, r_i * cell + cell - 13), f"{item.winery[:28]} | {item.slug[:40]}", fill="black", font=f_small)
            draw.text((3, r_i * cell + 3), f"#{s + r_i} {r['kind']} {r['sim']:.3f}", fill="red", font=f_small)
        sheet.save(OUT_DIR / f"sheet_{s // per_sheet:03d}.jpg", quality=82)


def in_db_by_slug(path: Path = CATALOG_PATH) -> dict[str, bool]:
    """`in_db` манифеста: слаг есть в зеркале каталога, значит и страница на сайте откроется.

    Проверяется по зеркалу, а не запросами к сайту: в CSV организатора 2103 слага, в зеркале
    2041, и у слага вне зеркала `/wines/<slug>` отдаёт 404 — ссылку на него ставить нечестно.
    """
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            out[r["slug"]] = bool(r.get("in_db"))
    return out


def cell(item: CatalogItem, on_site: bool, box: int) -> str:
    """Ячейка таблицы: превью с сайта, название, ссылка на карточку и на файл в дампе."""
    img = IMG_URL.format(box=box, file=item.image.name)
    local = "../" + item.image.relative_to(ROOT).as_posix()
    site = f"[карточка]({SITE_URL.format(slug=item.slug)})" if on_site else "нет на сайте"
    title = item.title.strip().replace("|", "\\|")  # вертикальная черта разорвала бы строку таблицы
    return (f'<img src="{img}" height="150"><br>'
            f'**{title}** · {item.category}<br>'
            f'`{item.slug}`<br>{site} · [файл в дампе]({local})')


GROUP_DOC = {
    BROKEN_PHOTO: (
        "Разным винам выдан один и тот же файл. Такую пару не разводит ни модель, ни текст на "
        "этикетке: картинка буквально одна. Чинится только в каталоге — залить верное фото."),
    DUPLICATE_WINE: (
        "Похоже на одно вино под двумя слагами: одно название вложено в другое по словам "
        "(каталог пишет вино и коротко, и полным именем). Нужно решение владельца: схлопнуть "
        "слаги или объяснить, чем вина различаются. Спорные пары в списке оставлены намеренно."),
    SAME_DESIGN: (
        "Фото разные, совпадает дизайн линейки. Ошибка каталога тут ни при чём: это задача "
        "распознавания — разрешение этикетки и текст (WIN-12)."),
    CANDIDATE: (
        "Одно название вложено в другое внутри одной винодельни. Часть из них — тот же дубль "
        "(«Бельбек Санджовезе» и «Санджовезе»), часть — разные вина («Пино Нуар» и «Пино Нуар "
        "Джавага»). Различить может только владелец каталога, поэтому из оценки эти кадры "
        "**не** исключаются."),
}


def write_md(groups: dict[str, list[dict]], item_by_slug: dict[str, CatalogItem],
             on_site: dict[str, bool], catalog_size: int, tag: str, min_sim: float, box: int) -> None:
    slugs = {r["slug_a"] for rs in groups.values() for r in rs} | {r["slug_b"] for rs in groups.values() for r in rs}
    out = [
        "# Каталог: разные вина с одинаковым или почти одинаковым фото",
        "",
        f"Сгенерировано `ml/dupes.py` {date.today():%d.%m.%Y} — индекс `{tag}`, порог сходства "
        f"{min_sim}. Файл перезаписывается скриптом, править руками бессмысленно.",
        "",
        f"Затронуто **{len(slugs)} слагов из {catalog_size}** ({len(slugs) / catalog_size:.1%}). "
        "Сходство считается по эмбеддингам рендеров (максимум по парам видов), `same_file` — один "
        "файл на два слага по манифесту, `same_bytes` — разные имена файлов с одним sha256.",
        "",
        "| Группа | Пар | Кому |",
        "|---|---|---|",
    ]
    owner = {BROKEN_PHOTO: "владельцу каталога", DUPLICATE_WINE: "владельцу каталога",
             SAME_DESIGN: "в модель, WIN-12", CANDIDATE: "владельцу каталога, но в метрику не идёт"}
    for name, part in groups.items():
        out.append(f"| [{name}](#{name.replace(' ', '-').replace(',', '')}) | {len(part)} | {owner[name]} |")
    out += ["", "Превью подтягиваются с сайта через ресайзер API; ссылка «файл в дампе» ведёт на "
            "оригинал в распакованном дампе uploads и работает при локальном просмотре.", ""]

    for name, part in groups.items():
        out += [f"## {name}", "", GROUP_DOC[name], ""]
        if name == BROKEN_PHOTO:
            diff = sum(1 for r in part if r["category_diff"])
            other = sum(1 for r in part if not r["same_winery"])
            out += [f"Из них у {diff} пар **разная категория вина** (белое против красного и т. п.), "
                    f"у {other} — **разные винодельни**: тут ошибка доказывается без всякой модели.", ""]
        out += ["| № | Сходство | A | B |", "|---|---|---|---|"]
        for i, r in enumerate(part, 1):
            mark = " ⚠️" if r["category_diff"] and name == BROKEN_PHOTO else ""
            a, b = item_by_slug[r["slug_a"]], item_by_slug[r["slug_b"]]
            out.append(f"| {i} | `{r['kind']}`<br>{r['sim']:.3f}{mark} | "
                       f"{cell(a, on_site[a.slug], box)} | {cell(b, on_site[b.slug], box)} |")
        out.append("")
    out += ["---", "",
            "Пересобрать: `.venv-ml\\Scripts\\python.exe -m ml.dupes --min-sim 0.95`. "
            "Машинная выгрузка для правок каталога — `data/raw/dataset/dupes/pairs.csv`, "
            "контактные листы для проверки глазами — `sheet_*.jpg` там же.", ""]
    MD_PATH.parent.mkdir(parents=True, exist_ok=True)
    MD_PATH.write_text("\n".join(out), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="siglip2-b16-ft1-e4", help="какой индекс брать из data/raw/model/index")
    ap.add_argument("--min-sim", type=float, default=0.95)
    ap.add_argument("--sheets", type=int, default=120, help="сколько верхних пар вынести на листы")
    ap.add_argument("--box", type=int, default=300, help="размер превью в отчёте: бокс ресайзера сайта")
    args = ap.parse_args()

    catalog = load_catalog()
    item_by_slug = {c.slug: c for c in catalog}
    by_image: dict[str, list[CatalogItem]] = {}
    for c in catalog:
        by_image.setdefault(c.image.name, []).append(c)
    names = sorted(by_image)

    cache = index_cache_path(catalog, args.tag)
    if not cache.exists():
        print(f"нет индекса {cache} — сначала соберите его (ml.retrieval.build_index)")
        return 1
    emb = np.load(cache)["emb"]
    if len(emb) != len(names):
        print(f"индекс на {len(emb)} референсов, в манифесте {len(names)} — индекс от другого каталога")
        return 1
    print(f"слагов {len(catalog)}, уникальных рендеров {len(names)}, индекс {cache.name}")

    rows = []
    # один файл на несколько слагов: пара без всякой модели
    for name, items in by_image.items():
        for a, b in combinations(sorted(items, key=lambda c: c.slug), 2):
            rows.append(pair_row("same_file", 1.0, a, b))

    s = ref_sim(emb)
    pairs = np.argwhere(np.triu(s, 1) >= args.min_sim)
    digest: dict[str, str] = {}
    for i, j in pairs:
        for k in (i, j):
            digest.setdefault(names[k], sha256(by_image[names[k]][0].image))
    for i, j in pairs:
        kind = "same_bytes" if digest[names[i]] == digest[names[j]] else "near"
        for a in by_image[names[i]]:
            for b in by_image[names[j]]:
                rows.append(pair_row(kind, float(s[i, j]), a, b))

    # Дубли одного вина с разными фото: сходство рендеров у них ниже порога, ловятся названием.
    pos = {n: i for i, n in enumerate(names)}
    seen = {frozenset((r["slug_a"], r["slug_b"])) for r in rows}
    for a, b, kind in title_dupes(catalog):
        if frozenset((a.slug, b.slug)) in seen:
            continue
        rows.append(pair_row(kind, float(s[pos[a.image.name], pos[b.image.name]]), a, b))

    order = {"same_file": 0, "same_bytes": 1, "title_exact": 2, "title_subset": 3, "near": 4}
    rows.sort(key=lambda r: (order[r["kind"]], -r["sim"], r["slug_a"]))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0]) if rows else []
    with (OUT_DIR / "pairs.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, delimiter=";")
        w.writeheader()
        w.writerows(rows)
    (OUT_DIR / "pairs.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    groups = {name: [r for r in rows if r["group"] == name]
              for name in (BROKEN_PHOTO, DUPLICATE_WINE, SAME_DESIGN, CANDIDATE)}
    for name, part in groups.items():
        files = {r["file_a"] for r in part} | {r["file_b"] for r in part}
        extra = ""
        if part and name == "одно фото на разные вина":
            extra = (f", разная категория {sum(1 for r in part if r['category_diff'])}"
                     f", разные винодельни {sum(1 for r in part if not r['same_winery'])}")
        print(f"{name:<29} пар {len(part):>3}  рендеров {len(files):>3}{extra}")
    slugs = {r["slug_a"] for r in rows} | {r["slug_b"] for r in rows}
    print(f"затронуто слагов {len(slugs)} из {len(catalog)} ({len(slugs) / len(catalog):.1%})")

    on_site = in_db_by_slug()
    write_md(groups, item_by_slug, on_site, len(catalog), args.tag, args.min_sim, args.box)
    print(f"→ {MD_PATH.relative_to(ROOT)}: без карточки на сайте "
          f"{sum(1 for s in slugs if not on_site.get(s))} из {len(slugs)} слагов")

    write_sheets(rows, item_by_slug, args.sheets)
    print(f"→ {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
