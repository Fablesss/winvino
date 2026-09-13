// Получение и подготовка рендеров каталога под OCR.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { projectRoot } from './db.mjs';

// resize, а НЕ fit: fit апскейлит оригинал до запрошенного бокса и добавляет паддинг,
// новой детализации в нём нет. resize с боксом 1600 отдаёт оригинал как есть
// (истинные размеры в каталоге: от 167x700 до 1600+, медиана по ширине ~335).
// Прямой путь /uploads/... отдаёт 404 — только через ресайзер.
const IMG_BASE = 'https://api.vino-svoe.ru/v1/img/str-api/1600/1600/resize';
const HEADERS = { 'User-Agent': 'winvino-label-scanner/0.1', Referer: 'https://vino-svoe.ru/' };

export const CACHE_DIR = path.join(projectRoot, 'data', 'raw', 'renders');

/** Скачивает рендер с локальным кешем: повторный прогон не дёргает чужой сервер. */
export async function fetchRender(imageUrl) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, path.basename(imageUrl));
  try {
    return await fs.readFile(file);
  } catch {
    const res = await fetch(`${IMG_BASE}${imageUrl}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`картинка ${imageUrl}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(file, buf);
    return buf;
  }
}

/**
 * Варианты подготовки кадра:
 *   full — весь рендер бутылки;
 *   band — вертикальная полоса, где обычно сидит этикетка. Горлышко, фольга и блики
 *          на стекле дают tesseract много мусора, обрезка их убирает.
 *
 * Общее для обоих: рендеры приходят с альфой и вырезанным фоном, поэтому плющим на
 * БЕЛЫЙ — иначе прозрачность станет чёрной и тёмный текст потеряет контраст.
 * Мелкие кадры апскейлим: информации это не добавляет, но tesseract заметно лучше
 * работает при высоте строки больше ~20px.
 */
export const VARIANTS = ['full', 'band'];
const BAND = { top: 0.25, bottom: 0.80 };
const TARGET_WIDTH = 1200;

export async function preprocess(buf, variant = 'band') {
  const meta = await sharp(buf).metadata();
  let img = sharp(buf).flatten({ background: '#ffffff' });

  if (variant === 'band') {
    const top = Math.round(meta.height * BAND.top);
    const height = Math.round(meta.height * (BAND.bottom - BAND.top));
    img = img.extract({ left: 0, top, width: meta.width, height });
  }

  const width = variant === 'band' ? meta.width : meta.width;
  if (width < TARGET_WIDTH) img = img.resize({ width: TARGET_WIDTH, kernel: 'lanczos3' });

  // 96 dpi — иначе tesseract ругается «Invalid resolution 25 dpi» и гадает сам.
  return img.greyscale().normalise().withMetadata({ density: 96 }).png().toBuffer();
}
