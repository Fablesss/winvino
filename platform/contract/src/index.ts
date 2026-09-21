// Публичный вход пакета. Для каждого клиента (веб, бот, нативный) контракт один.
export * from './wine.ts';
export * from './recognition.ts';
export * from './errors.ts';
export * from './routes.ts';
export * from './client.ts';
export { buildOpenApiDocument, OPENAPI_DOCUMENT_VERSION, type OpenApiDocument } from './openapi.ts';
