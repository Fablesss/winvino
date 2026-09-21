import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, API_ROUTES, buildOpenApiDocument } from '../src/index.ts';

const document = buildOpenApiDocument();

function collectAdditionalPropertiesFalse(node: unknown, path: string, found: string[]): string[] {
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      if (key === 'additionalProperties' && child === false) found.push(path);
      collectAdditionalPropertiesFalse(child, `${path}.${key}`, found);
    }
  }
  return found;
}

describe('OpenAPI document', () => {
  it('committedOpenApiJsonMatchesSchemas — иначе: npm run openapi:write', () => {
    const committed: unknown = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
    expect(committed).toEqual(document);
  });

  it('exposesNamedComponentsForCodegen', () => {
    expect(Object.keys(document.components.schemas).sort()).toEqual(
      ['ApiError', 'ApiErrorCode', 'Health', 'NotFoundReason', 'Recognition', 'Wine', 'WineCandidate', 'WineColor', 'WineSweetness'].sort(),
    );
  });

  it('responsesStayExtensible — нет additionalProperties: false', () => {
    expect(collectAdditionalPropertiesFalse(document.components.schemas, 'schemas', [])).toEqual([]);
  });

  it('componentsCarryNoPerSchemaDialect', () => {
    for (const [id, schema] of Object.entries(document.components.schemas)) {
      expect(schema, id).not.toHaveProperty('$schema');
      expect(schema, id).not.toHaveProperty('$id');
    }
  });

  it('recognitionEndpointDocumentsEveryErrorCodeExceptRouting', () => {
    const recognize = (document.paths[API_ROUTES.recognitions] as { post: { responses: Record<string, { description: string }> } }).post;
    const documented = Object.values(recognize.responses).map((response) => response.description).join(' ');
    for (const code of API_ERROR_CODES.filter((errorCode) => errorCode !== 'NOT_FOUND')) {
      expect(documented, code).toContain(code);
    }
  });

  it('includesServerWhenGiven', () => {
    expect(buildOpenApiDocument({ serverUrl: 'https://api.example.test' }).servers).toEqual([
      { url: 'https://api.example.test' },
    ]);
  });
});
