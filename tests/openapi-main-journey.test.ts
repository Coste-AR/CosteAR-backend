import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Operation = {
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};

type OpenApiDocument = {
  info: { version: string };
  paths: Record<string, Record<string, Operation>>;
};

const requiredOperations = [
  ['post', '/auth/login'],
  ['post', '/auth/refresh'],
  ['post', '/auth/logout'],
  ['get', '/companies'],
  ['get', '/companies/{companyId}/cost-structures'],
  ['get', '/cost-structures/{id}'],
  ['put', '/cost-structures/{id}/raw-material'],
  ['put', '/cost-structures/{id}/direct-labor'],
  ['put', '/cost-structures/{id}/indirect-costs'],
  ['post', '/cost-structures/{id}/calculate'],
  ['post', '/cost-structures/{id}/simulate'],
  ['get', '/structures/{id}/periods'],
  ['get', '/structures/{id}/periods/open'],
  ['get', '/structures/{id}/periods/compare'],
  ['post', '/periods/{id}/close'],
  ['get', '/periods/{id}/tablero-dueno'],
  ['post', '/datos/submit'],
  ['get', '/validaciones/pending'],
  ['post', '/validaciones/{entryId}/review'],
] as const;

describe('contrato OpenAPI del recorrido principal', () => {
  const document = JSON.parse(
    readFileSync(new URL('../openapi/openapi.json', import.meta.url), 'utf8'),
  ) as OpenApiDocument;

  it('publica una revisión explícita que el consumidor puede fijar', () => {
    expect(document.info.version).toMatch(/^1\.\d+\.\d+$/);
  });

  it.each(requiredOperations)('%s %s declara éxitos y errores estructurados', (method, path) => {
    const operation = document.paths[path]?.[method];
    expect(operation, `${method.toUpperCase()} ${path} falta en OpenAPI`).toBeDefined();

    const responses = operation?.responses ?? {};
    expect(Object.keys(responses).some((status) => status.startsWith('2'))).toBe(true);
    expect(responses['400']).toBeDefined();
    expect(responses['401']).toBeDefined();
    expect(responses['422']).toBeDefined();
    expect(responses['500']).toBeDefined();

    for (const response of Object.values(responses)) {
      expect(response.content?.['application/json']?.schema).toBeDefined();
    }
  });
});
