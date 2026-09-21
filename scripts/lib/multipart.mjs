// Разбор multipart/form-data без зависимостей: сервису нужно одно поле с файлом.

/** @returns {{name: string, filename: string|null, contentType: string|null, data: Buffer}[]} */
export function parseMultipart(body, contentTypeHeader) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader ?? '');
  if (!m) throw new Error('нет boundary в Content-Type');
  const boundary = Buffer.from(`--${m[1] ?? m[2].trim()}`);
  const parts = [];
  let pos = body.indexOf(boundary);
  while (pos >= 0) {
    const start = pos + boundary.length;
    // «--» после разделителя — конец тела.
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    const next = body.indexOf(boundary, start);
    if (next < 0) break;
    const chunk = body.subarray(start + 2, next - 2); // без \r\n после разделителя и перед следующим
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headers = chunk.subarray(0, headerEnd).toString('utf8');
      const name = /name="([^"]*)"/i.exec(headers)?.[1];
      if (name !== undefined) {
        parts.push({
          name,
          filename: /filename="([^"]*)"/i.exec(headers)?.[1] ?? null,
          contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? null,
          data: chunk.subarray(headerEnd + 4),
        });
      }
    }
    pos = next;
  }
  return parts;
}
