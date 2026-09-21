// Сервис распознавания по контракту организатора (eval.zip → README.md).
//
//   node scripts/serve-eval.mjs [--port 8080] [--host 127.0.0.1] [--min-visual 0.4] [--min-confidence 0]
//
// POST /v1/eval/predict, multipart-поле `image` → {"slug": "...", "confidence": 0.93, ...}.
// Скрипт организатора читает только `slug`; остальные поля — для отладки.
// GET /health → готовность и модель.
//
// Чекпойнт энкодера и веса слияния берутся из data/raw/model/recognizer.json
// (его пишет scripts/eval-recognizer.mjs --write-config).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseMultipart } from './lib/multipart.mjs';
import { createRecognizer } from './lib/recognizer.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const port = Number(arg('port', process.env.PORT ?? 8080));
const host = arg('host', '127.0.0.1');
const MAX_BODY = 40 * 1024 * 1024;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.bmp', '.tif', '.tiff', '.jfif']);

// Пороги отказа поверх recognizer.json: --min-visual 0.4 — «вина нет в каталоге»,
// --min-confidence 0.5 — «не уверен». Без флагов берутся значения из конфига.
const overrides = {};
if (arg('min-visual') !== undefined) overrides.minVisual = Number(arg('min-visual'));
if (arg('min-confidence') !== undefined) overrides.minConfidence = Number(arg('min-confidence'));
const recognizer = await createRecognizer({ config: overrides });

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

async function predict(req, res) {
  const body = await readBody(req);
  const image = parseMultipart(body, req.headers['content-type']).find((p) => p.name === 'image');
  if (!image || !image.data.length) return send(res, 400, { slug: null, error: 'нет поля image' });

  const ext = path.extname(image.filename ?? '').toLowerCase();
  const tmp = path.join(os.tmpdir(), `winvino-${crypto.randomUUID()}${IMAGE_EXT.has(ext) ? ext : '.img'}`);
  fs.writeFileSync(tmp, image.data);
  try {
    const r = await recognizer.recognize(tmp);
    console.log(`${new Date().toISOString()} ${image.filename} → ${r.slug} p=${r.confidence} ${JSON.stringify(r.ms)}`);
    const { _ranked, ...out } = r;
    return send(res, 200, out);
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'POST' && url.pathname === '/v1/eval/predict') return await predict(req, res);
    if (req.method === 'GET' && url.pathname === '/health') {
      const { checkpoint, minVisual, minConfidence } = recognizer.config;
      return send(res, 200, { ok: true, checkpoint, minVisual, minConfidence });
    }
    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return send(res, err.status ?? 500, { slug: null, error: err.message });
  }
});

server.listen(port, host, () => console.log(`слушаю http://${host}:${port}/v1/eval/predict`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { recognizer.stop(); server.close(() => process.exit(0)); });
}
