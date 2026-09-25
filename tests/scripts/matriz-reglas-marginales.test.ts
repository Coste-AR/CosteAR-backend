import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import matriz from '../fixtures/analisis-marginal/reglas-r1-r35.json';

describe('V-A1 — matriz R1–R35', () => {
  it('enumera las 35 reglas una sola vez y declara los alcances posteriores', () => {
    expect(matriz.reglas.map(({ regla }) => regla)).toEqual(
      Array.from({ length: 35 }, (_, indice) => `R${indice + 1}`),
    );
    expect(matriz.pendientesDeclaradas.map(({ tarea }) => tarea)).toEqual(['O1-02', 'M9-01', 'M12-01']);
  });

  it.each(matriz.reglas)('$regla → $modulo tiene un test nombrado que existe', ({ regla, archivo, test }) => {
    const contenido = readFileSync(resolve(process.cwd(), archivo), 'utf8');
    expect(contenido, `${regla} apunta a un test inexistente: ${archivo} :: ${test}`).toContain(test);
  });
});
