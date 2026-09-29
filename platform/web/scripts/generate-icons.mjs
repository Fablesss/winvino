// Иконки PWA и favicon из одного SVG. Результат коммитится; перегенерировать: npm run icons -w @winvino/web
// Цвета — из app/brand.ts (здесь продублированы: .mjs не импортирует .ts без сборки).
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const RUBY = "#8F3D42";
const PAPER = "#FEFDFA";

// Бутылка с этикеткой в уголках видоискателя — «наведи камеру на вино». Координаты в боксе 512.
function iconSvg({ cornerRadius, contentScale }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${cornerRadius}" fill="${RUBY}"/>
  <g transform="translate(256 256) scale(${contentScale}) translate(-256 -256)">
    <path d="M112 164V112h52M348 112h52v52M400 348v52h-52M164 400h-52v-52" fill="none" stroke="${PAPER}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <rect x="236" y="120" width="40" height="22" rx="5" fill="${PAPER}"/>
    <path d="M240 146v36c0 22-34 30-34 60v126q0 14 14 14h72q14 0 14-14V242c0-30-34-38-34-60v-36z" fill="${PAPER}"/>
    <rect x="218" y="272" width="76" height="62" rx="4" fill="${RUBY}"/>
    <rect x="232" y="292" width="48" height="8" rx="4" fill="${PAPER}"/>
    <rect x="242" y="310" width="28" height="6" rx="3" fill="${PAPER}" opacity="0.7"/>
  </g>
</svg>`;
}

/** Обычная иконка — со скруглением; maskable — в край, всё содержимое в безопасной зоне 80%. */
const regularSvg = iconSvg({ cornerRadius: 112, contentScale: 1.08 });
const maskableSvg = iconSvg({ cornerRadius: 0, contentScale: 0.9 });

const iconsDir = new URL("../public/icons/", import.meta.url);
const appDir = new URL("../app/", import.meta.url);
mkdirSync(iconsDir, { recursive: true });

const outputs = [
  [new URL("icon-192.png", iconsDir), regularSvg, 192],
  [new URL("icon-512.png", iconsDir), regularSvg, 512],
  [new URL("icon-maskable-512.png", iconsDir), maskableSvg, 512],
  // Файловые соглашения Next: app/apple-icon.png и app/icon.svg сами попадают в <head>.
  [new URL("apple-icon.png", appDir), maskableSvg, 180],
];

for (const [fileUrl, svg, size] of outputs) {
  writeFileSync(fileUrl, await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer());
  console.log(`записан ${fileUrl.pathname}`);
}
writeFileSync(new URL("icon.svg", appDir), regularSvg);
console.log(`записан ${new URL("icon.svg", appDir).pathname}`);
