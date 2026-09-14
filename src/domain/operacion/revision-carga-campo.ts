export const PRODUCCION_SUPERA_PLANTEL = 'La producción supera la cantidad de aves vivas del lote';
export const BAJA_SUPERA_PLANTEL = 'La baja supera la cantidad de aves vivas del lote';

type EventoPoblacion = {
  tipo: 'ALTA' | 'BAJA';
  cantidad: number | { toString(): string };
  motivo: string | null;
};

export function saldoVivo(eventos: EventoPoblacion[]): number {
  return eventos.reduce((saldo, evento) => {
    const cantidad = Number(evento.cantidad);
    if (evento.tipo === 'ALTA') return saldo + cantidad;
    return evento.motivo === null ? saldo : saldo - cantidad;
  }, 0);
}

export function revisionProduccion(unidadesProducidas: number, avesVivas: number) {
  const requiereRevision = unidadesProducidas > avesVivas;
  return {
    requiereRevision,
    motivoRevision: requiereRevision ? PRODUCCION_SUPERA_PLANTEL : null,
  };
}

export function revisionBaja(cantidad: number, avesVivas: number) {
  const requiereRevision = cantidad > avesVivas;
  return {
    requiereRevision,
    motivoRevision: requiereRevision ? BAJA_SUPERA_PLANTEL : null,
  };
}
