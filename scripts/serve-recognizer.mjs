// Сервис распознавания: внутренний для platform/api и по контракту организатора.
//
//   node scripts/serve-recognizer.mjs [--port 8080] [--host 127.0.0.1] [--min-visual 0.4] [--min-confidence 0]
//
// POST /v1/recognize      multipart `image` → топ-5 кандидатов и сигналы для решения на стороне
//                         platform/api (matched / ambiguous / not_found — пороги там):
//                         {candidates: [{slug, confidence, visual, text}], visualMax, ocrText,
//                          ocrLetters, box, boxSource, ms}
// POST /v1/eval/predict   контракт организатора (eval.zip → README.md): {"slug", "confidence", ...};
//                         скрипт организатора читает только slug
// GET  /health            200 — модели загружены; 503 — поднимается или воркер перезапускается
//
// Слушает сразу, модели грузятся в фоне: пока не готово — 503 с понятной ошибкой.
// Чекпойнт и веса слияния — из $WINVINO_DATA_DIR/model/recognizer.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseMultipart } from './lib/multipart.mjs';
import { createRecognizer, WorkerUnavailableError } from './lib/recognizer.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const port = Number(arg('port', process.env.PORT ?? 8080));
const host = arg('host', process.env.HOST ?? '127.0.0.1');
const MAX_BODY = 40 * 1024 * 1024;
// Воркеры обрабатывают кадры по одному; длинная очередь всё равно упрётся в таймаут клиента.
const MAX_IN_FLIGHT = Number(process.env.RECOGNIZER_MAX_IN_FLIGHT ?? 4);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.bmp', '.tif', '.tiff', '.jfif']);

// Пороги отказа поверх recognizer.json: --min-visual 0.4 — «вина нет в каталоге»,
// --min-confidence 0.5 — «не уверен». Без флагов берутся значения из конфига.
// Влияют только на /v1/eval/predict: /v1/recognize отдаёт сигналы, решает platform/api.
const overrides = {};
const minVisual = arg('min-visual', process.env.EVAL_MIN_VISUAL);
const minConfidence = arg('min-confidence', process.env.EVAL_MIN_CONFIDENCE);
if (minVisual !== undefined) overrides.minVisual = Number(minVisual);
if (minConfidence !== undefined) overrides.minConfidence = Number(minConfidence);
const recognizer = createRecognizer({ config: overrides });
recognizer.ready.catch((err) => console.error(`распознаватель не поднялся: ${err.message}`));

let inFlight = 0;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('тело больше 40 МБ'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/** Сохраняет фото из multipart во временный файл, распознаёт, удаляет файл. */
async function recognizeUpload(req) {
  const body = await readBody(req);
  const image = parseMultipart(body, req.headers['content-type']).find((p) => p.name === 'image');
  if (!image || !image.data.length) throw Object.assign(new Error('нет поля image'), { status: 400 });
  const ext = path.extname(image.filename ?? '').toLowerCase();
  const tmp = path.join(os.tmpdir(), `winvino-${crypto.randomUUID()}${IMAGE_EXT.has(ext) ? ext : '.img'}`);
  fs.writeFileSync(tmp, image.data);
  try {
    const r = await recognizer.recognize(tmp);
    console.log(`${new Date().toISOString()} ${req.url} ${image.filename ?? '-'} → ${r.candidates[0]?.slug ?? '-'} p=${r.confidence} vis=${r.visual_max.toFixed(3)} ${JSON.stringify(r.ms)}`);
    return r;
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}

const routes = {
  'POST /v1/recognize': async (req, res) => {
    const r = await recognizeUpload(req);
    return send(res, 200, {
      candidates: r.candidates.map((c) => ({ slug: c.slug, confidence: c.p, visual: c.vis, text: c.txt })),
      visualMax: r.visual_max,
      ocrText: r.ocr_text,
      ocrLetters: r.ocr_letters,
      box: r.box,
      boxSource: r.box_source,
      ms: r.ms,
    });
  },
  'POST /v1/eval/predict': async (req, res) => {
    const { _ranked, ...out } = await recognizeUpload(req);
    return send(res, 200, out);
  },
  'GET /health': async (req, res) => {
    const { checkpoint, minVisual: mv, minConfidence: mc } = recognizer.config;
    const ready = recognizer.isReady();
    return send(res, ready ? 200 : 503, { ok: ready, status: ready ? 'ready' : 'starting', model: recognizer.model(), checkpoint, minVisual: mv, minConfidence: mc });
  },
};

const server = http.createServer(async (req, res) => {
  const route = routes[`${req.method} ${new URL(req.url, 'http://x').pathname}`];
  if (!route) return send(res, 404, { error: 'not found' });
  const isRecognition = req.method === 'POST';
  if (isRecognition && inFlight >= MAX_IN_FLIGHT) {
    return send(res, 503, { slug: null, error: 'busy', message: `в работе уже ${inFlight} кадров` });
  }
  if (isRecognition) inFlight += 1;
  try {
    return await route(req, res);
  } catch (err) {
    if (err instanceof WorkerUnavailableError) return send(res, 503, { slug: null, error: 'unavailable', message: err.message });
    if (!err.status) console.error(err);
    return send(res, err.status ?? 500, { slug: null, error: err.status ? 'bad_request' : 'internal', message: err.message });
  } finally {
    if (isRecognition) inFlight -= 1;
  }
});

server.listen(port, host, () => console.log(`слушаю http://${host}:${port} (POST /v1/recognize, POST /v1/eval/predict, GET /health)`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { recognizer.stop(); server.close(() => process.exit(0)); });
}
