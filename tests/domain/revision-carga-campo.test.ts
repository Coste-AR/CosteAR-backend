import { describe, expect, it } from 'vitest';
import {
  BAJA_SUPERA_PLANTEL,
  PRODUCCION_SUPERA_PLANTEL,
  revisionBaja,
  revisionProduccion,
  saldoVivo,
} from '@/domain/operacion/revision-carga-campo.js';

describe('revisiÃ³n de cargas de campo', () => {
  it('deriva el plantel y excluye bajas importadas todavÃ­a sin clasificar', () => {
    expect(saldoVivo([
      { tipo: 'ALTA', cantidad: 100, motivo: null },
      { tipo: 'BAJA', cantidad: 10, motivo: 'MORTALIDAD' },
      { tipo: 'BAJA', cantidad: 20, motivo: null },
    ])).toBe(90);
  });

  it('sÃ³lo marca producciÃ³n cuando supera el 100% del plantel vivo', () => {
    expect(revisionProduccion(100, 100)).toEqual({ requiereRevision: false, motivoRevision: null });
    expect(revisionProduccion(101, 100)).toEqual({
      requiereRevision: true,
      motivoRevision: PRODUCCION_SUPERA_PLANTEL,
    });
  });

  it('sÃ³lo marca una baja cuando producirÃ­a saldo negativo', () => {
    expect(revisionBaja(100, 100)).toEqual({ requiereRevision: false, motivoRevision: null });
    expect(revisionBaja(101, 100)).toEqual({
      requiereRevision: true,
      motivoRevision: BAJA_SUPERA_PLANTEL,
    });
  });
});
