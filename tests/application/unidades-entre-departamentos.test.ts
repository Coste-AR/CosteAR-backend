import { describe, it, expect } from 'vitest';
import { validateProcessInputs } from '@/application/cost-structures/validate-inputs.js';
import { MissingInputError } from '@/domain/errors/calculation-errors.js';

/**
 * LA PLATA QUE SE EVAPORABA ENTRE DEPARTAMENTOS.
 *
 * Las "recibidas del departamento anterior" se tipean a mano, y nadie
 * verificaba que coincidieran con las que el anterior transfirió: cada cuadro se
 * validaba contra sí mismo, nunca contra el de al lado.
 *
 * Caso real de la auditoría (citrícola): el departamento 1 transfirió 42.000
 * litros por $16.800.000 y se cargó que el 2 recibió 30.000. Entraron
 * $12.000.000. Se evaporaron $4.800.000 —el 28% del costo del departamento— sin
 * una sola advertencia, y el costo unitario quedó en $513,89 en vez de $489,58.
 */

const dep = (
  name: string,
  sequence: number,
  schedule: Record<string, number | null> | null,
) => ({ name, sequence, schedule: schedule as never, hasByProductLines: false, jointMethod: null });

/** Depto 1: pone 45.000, transfiere 42.000, deja 3.000 en proceso. */
const molienda = (over: Record<string, number | null> = {}) =>
  dep('Molienda', 1, {
    initialWip: 0,
    startedInProduction: 45_000,
    receivedFromPrevious: null,
    unitIncrease: null,
    transferredOut: 42_000,
    finishedInStock: 0,
    totalLossReported: null,
    normalLoss: 0,
    finalWip: 3_000,
    finalWipMpAvance: 1,
    finalWipConvAvance: 0.5,
    ...over,
  });

const empaque = (recibidas: number, over: Record<string, number | null> = {}) =>
  dep('Empaque', 2, {
    initialWip: 0,
    startedInProduction: null,
    receivedFromPrevious: recibidas,
    unitIncrease: null,
    transferredOut: recibidas,
    finishedInStock: 0,
    totalLossReported: null,
    normalLoss: 0,
    finalWip: 0,
    finalWipMpAvance: 1,
    finalWipConvAvance: 1,
    ...over,
  });

describe('Las unidades que salen de una etapa son las que entran a la siguiente', () => {
  it('con la cadena bien encadenada no se queja', () => {
    expect(() => validateProcessInputs([molienda(), empaque(42_000)])).not.toThrow();
  });

  it('CORTA el cálculo cuando recibió menos de lo que le transfirieron', () => {
    // El caso de la auditoría, exacto.
    const correr = () => validateProcessInputs([molienda(), empaque(30_000)]);

    expect(correr).toThrow(MissingInputError);
    expect(correr).toThrow(/transfirió 42000/);
    expect(correr).toThrow(/recibió 30000/);
    expect(correr).toThrow(/Faltan 12000/);
  });

  it('también corta si recibió de más (plata inventada)', () => {
    const correr = () => validateProcessInputs([molienda(), empaque(50_000)]);

    expect(correr).toThrow(/Sobran 8000/);
  });

  it('el mensaje explica qué se pierde, no solo que los números difieren', () => {
    try {
      validateProcessInputs([molienda(), empaque(30_000)]);
      throw new Error('debería haber cortado');
    } catch (e) {
      // Un costista que lee "42000 ≠ 30000" no sabe por qué le importa.
      expect((e as Error).message).toMatch(/se pierde \(o se inventa\) el costo que traían/);
    }
  });

  it('funciona aunque las transferidas del anterior estén DEDUCIDAS por diferencia', () => {
    // Si el costista cargó la existencia final y dejó vacías las transferidas,
    // el cuadro las despeja. La comparación tiene que usar ese número resuelto,
    // no un cero.
    const sinTransferidas = molienda({ transferredOut: null });

    expect(() => validateProcessInputs([sinTransferidas, empaque(42_000)])).not.toThrow();
    expect(() => validateProcessInputs([sinTransferidas, empaque(30_000)])).toThrow(
      /transfirió 42000/,
    );
  });

  it('las pérdidas del departamento anterior no se cuentan como transferidas', () => {
    // 45.000 puestas − 3.000 en proceso − 2.000 de merma = 40.000 transferidas.
    const conMerma = molienda({ transferredOut: null, totalLossReported: 2_000 });

    expect(() => validateProcessInputs([conMerma, empaque(40_000)])).not.toThrow();
    expect(() => validateProcessInputs([conMerma, empaque(42_000)])).toThrow(/Sobran 2000/);
  });

  it('el primer departamento no se compara contra nada', () => {
    // No tiene anterior: "recibidas" no aplica.
    expect(() => validateProcessInputs([molienda()])).not.toThrow();
  });

  it('un aumento de unidades en el 2º departamento no rompe la comparación', () => {
    // La fermentación agrega volumen DESPUÉS de recibir: lo recibido sigue
    // siendo lo transferido.
    const conAumento = empaque(42_000, { unitIncrease: 5_000, transferredOut: 47_000 });

    expect(() => validateProcessInputs([molienda(), conAumento])).not.toThrow();
  });
});

describe('H12 — departamentos con unidades distintas, con factor de conversión declarado', () => {
  it('con factor declarado, compara transferidas × factor contra recibidas', () => {
    // Molienda transfiere 42.000 toneladas de fruta; Destilado declaró que
    // cada tonelada rinde 10 litros ⇒ se esperan 420.000 litros recibidos.
    const destiladoConFactor = { ...empaque(420_000), conversionFromPrevious: 10 };
    expect(() => validateProcessInputs([molienda(), destiladoConFactor])).not.toThrow();
  });

  it('con factor declarado, sigue cortando si no coincide: la plata tampoco se conserva sin conversión', () => {
    const destiladoConFactor = { ...empaque(300_000), conversionFromPrevious: 10 };
    const correr = () => validateProcessInputs([molienda(), destiladoConFactor]);

    expect(correr).toThrow(MissingInputError);
    expect(correr).toThrow(/Se esperaban 420000/);
    expect(correr).toThrow(/× factor 10/);
  });

  it('sin factor declarado, sigue exigiendo igualdad exacta 1 a 1 (H2 intacto)', () => {
    // Ningún departamento existente antes de H12 declaró factor: tiene que
    // comportarse exactamente igual que antes.
    const correr = () => validateProcessInputs([molienda(), empaque(30_000)]);
    expect(correr).toThrow(/Faltan 12000/);
  });

  it('un factor de 1 explícito es indistinguible de no declararlo', () => {
    const destiladoFactor1 = { ...empaque(42_000), conversionFromPrevious: 1 };
    expect(() => validateProcessInputs([molienda(), destiladoFactor1])).not.toThrow();
  });
});
