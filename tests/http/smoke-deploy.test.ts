import { describe, it, expect } from 'vitest';
// @ts-expect-error — el script es .mjs sin tipos; se importa por lo que hace, no por su tipo.
import { evaluarSalud, mismoCommit } from '../../scripts/smoke-deploy.mjs';

/**
 * LA DECISIÓN DEL SMOKE POST-DEPLOY, PROBADA SIN DEPLOYAR.
 *
 * `evaluarSalud` es la única parte del chequeo que puede equivocarse: el resto
 * es `fetch` y `setTimeout`. Se prueba acá, sin red y sin base, porque un
 * chequeo que solo se puede verificar deployando no protege nada — es
 * exactamente el error del 21-08, cuando el test del healthcheck se escribió
 * sobre `buildApp()` y el CI lo cargó con «0 test».
 *
 * El caso que más importa es el último: que un ambiente que NO se actualizó
 * termine en rojo. Si eso se rompiera, el chequeo daría verde sobre un deploy
 * que nunca llegó, que es peor que no tenerlo.
 */
const SHA = 'a88ef12b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f';

describe('smoke post-deploy — qué hacer con lo que responde el ambiente', () => {
  it('acepta cuando el ambiente informa el commit que se acaba de mergear', () => {
    const r = evaluarSalud({ shaEsperado: SHA, respuesta: { ok: true, version: SHA } });
    expect(r.estado).toBe('ok');
  });

  it('espera mientras el ambiente todavía sirve la versión anterior', () => {
    const r = evaluarSalud({
      shaEsperado: SHA,
      respuesta: { ok: true, version: '0000000000000000000000000000000000000000' },
    });
    expect(r.estado).toBe('esperar');
    expect(r.motivo).toContain('todavía corre');
  });

  it('espera cuando el ambiente no responde: puede estar reiniciando', () => {
    expect(evaluarSalud({ shaEsperado: SHA, respuesta: { ok: false, status: 502 } }).estado).toBe(
      'esperar',
    );
    expect(
      evaluarSalud({ shaEsperado: SHA, respuesta: { ok: false, error: 'timeout' } }).estado,
    ).toBe('esperar');
  });

  /**
   * `desconocido` significa que falta `RAILWAY_GIT_COMMIT_SHA` en el ambiente.
   * El tiempo no lo arregla: reintentar doce veces para después decir lo mismo
   * solo retrasa el diagnóstico seis minutos.
   */
  it('aborta enseguida si el ambiente no sabe qué versión corre', () => {
    const r = evaluarSalud({ shaEsperado: SHA, respuesta: { ok: true, version: 'desconocido' } });
    expect(r.estado).toBe('abortar');
    expect(r.motivo).toContain('RAILWAY_GIT_COMMIT_SHA');
  });

  it('aborta si /health responde sin el campo version', () => {
    expect(evaluarSalud({ shaEsperado: SHA, respuesta: { ok: true } }).estado).toBe('abortar');
  });

  it('aborta si el SHA esperado no alcanza para comparar nada', () => {
    expect(evaluarSalud({ shaEsperado: 'abc', respuesta: { ok: true, version: SHA } }).estado).toBe(
      'abortar',
    );
    expect(evaluarSalud({ shaEsperado: '', respuesta: { ok: true, version: SHA } }).estado).toBe(
      'abortar',
    );
  });
});

describe('comparación de commits', () => {
  it('acepta el corto contra el largo, en cualquier orden y sin importar mayúsculas', () => {
    expect(mismoCommit(SHA, SHA.slice(0, 7))).toBe(true);
    expect(mismoCommit(SHA.slice(0, 7), SHA)).toBe(true);
    expect(mismoCommit(SHA.toUpperCase(), SHA)).toBe(true);
    expect(mismoCommit(` ${SHA} `, SHA)).toBe(true);
  });

  /**
   * Un prefijo de menos de 7 caracteres colisiona demasiado fácil. Antes que
   * afirmar que dos commits son el mismo con esa evidencia, se dice que no.
   */
  it('rechaza prefijos demasiado cortos para significar algo', () => {
    expect(mismoCommit(SHA, 'a88')).toBe(false);
    expect(mismoCommit(SHA, '')).toBe(false);
  });

  it('rechaza commits distintos', () => {
    expect(mismoCommit(SHA, 'b88ef12b3c4d5e6f')).toBe(false);
  });
});
