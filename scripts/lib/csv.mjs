// Разбор CSV по RFC 4180: кавычки, "" внутри кавычек, переводы строк внутри ячейки.
// Выгрузка Strapi содержит запятые и переносы в описаниях — split(',') её ломает.

/** @returns {string[][]} строки как массивы ячеек, без BOM и хвостового \r */
export function parseCsv(src) {
  const text = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** CSV с заголовком → массив объектов по именам колонок. */
export function parseCsvObjects(src) {
  const [header, ...rows] = parseCsv(src);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
