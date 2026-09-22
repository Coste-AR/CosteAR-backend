import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CATEGORIA_AVICOLA_POSTURA,
  PAQUETE_AVICOLA_POSTURA,
} from '@/application/operacion/paquete-avicola.js';

const USER = 'user-1';
const PERIOD_ID = '00000000-0000-0000-0000-000000000001';

const { db } = vi.hoisted(() => ({
  db: {
    costPeriod: { findFirst: vi.fn() },
    calculationRun: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    paqueteRubro: { findMany: vi.fn() },
    parametroCosteo: { findMany: vi.fn() },
  },
}));

vi.mock('@/infrastructure/database/prisma.js', () => ({
  prisma: db,
  withTenant: async (_userId: string, fn: (tx: unknown) => unknown) => fn(db),
}));

vi.mock('@/infrastructure/http/plugins/authenticate.js', () => ({
  authenticate: async (request: FastifyRequest, _reply: FastifyReply) => {
    (request as FastifyRequest & { authUser: object }).authUser = { id: USER, role: 'EMPRESA_ADMIN', jobTitle: null };
  },
}));

async function app() {
  const Fastify = (await import('fastify')).default;
  const { registerOwnerDashboardRoutes } = await import('@/infrastructure/http/routes/owner-dashboard.routes.js');
  const { errorHandler } = await import('@/infrastructure/http/error-handler.js');
  // La ruta declara `schema.response` con Zod (#282): sin estos dos compilers
  // Fastify intenta leer el ZodObject como JSON Schema crudo y explota al
  // construir la ruta. `app.ts` los setea igual, scoped al prefijo `/api`.
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const server = Fastify({ logger: false });
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.setErrorHandler(errorHandler);
  await server.register(registerOwnerDashboardRoutes);
  await server.ready();
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.costPeriod.findFirst.mockResolvedValue({ id: PERIOD_ID, code: '2026-09', companyId: 'company-1', productionQuantity: 24, salesQuantity: 24 });
  db.company.findFirst.mockResolvedValue({
    unidadGestion: { codigo: 'cajon', nombre: 'Cajón', factor: 12 },
    paquetesRubro: [{ category: CATEGORIA_AVICOLA_POSTURA }],
  });
  db.paqueteRubro.findMany.mockResolvedValue([{
    category: CATEGORIA_AVICOLA_POSTURA,
    companyId: 'company-1',
    structureId: null,
    periodId: null,
    userId: USER,
    ...PAQUETE_AVICOLA_POSTURA,
    scale: null,
  }]);
  db.parametroCosteo.findMany.mockResolvedValue([]);
  db.calculationRun.findFirst.mockResolvedValue({
    id: 'run-1', validated: true, executedAt: new Date('2026-09-02T00:00:00.000Z'),
    results: {
      grossMargin: 12, incompletitud: { incompleto: false, motivos: [] },
      detail: { unitCost: { unitFinishedGoodsCost: 5, basadoEn: 'producidas' } },
      contribucionMarginal: { incompleta: false, precioUnitario: 4, unidadesVendidas: 24, costoVariableUnitario: 2, contribucionMarginalUnitaria: 2, componentes: [] },
      puntoEquilibrio: { incompleta: false, unidadesEquilibrio: 24, fechaUltimoRecalculo: '2026-09-02T00:00:00.000Z' },
    },
  });
});

describe('GET /periods/:id/tablero-dueno', () => {
  it('declara rubro ausente y su motivo sin inferirlo desde industry', async () => {
    db.company.findFirst.mockResolvedValue({
      industry: 'cualquier texto',
      unidadGestion: { codigo: 'cajon', nombre: 'Cajón', factor: 12 },
    });

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { rubro?: unknown; pendientes: Array<{ area: string; dato: string }> } };
    expect(body.data).toHaveProperty('rubro');
    expect(body.data.rubro).toBeNull();
    expect(body.data.pendientes).toContainEqual({
      area: 'configuracion',
      dato: 'La empresa no tiene un paquete de rubro declarado',
      periodo: { id: PERIOD_ID, codigo: '2026-09' },
    });
  });

  it('publica la clave y los íconos exactos del paquete avícola resuelto', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { rubro: unknown } };
    expect(body.data.rubro).toEqual({
      clave: CATEGORIA_AVICOLA_POSTURA,
      nombreProducto: 'AVI',
      icons: PAQUETE_AVICOLA_POSTURA.icons,
      kpisHome: [
        { clave: 'costo_cajon', etiqueta: 'Costo por cajón', unidad: 'ARS/cajon', valor: 60, completo: true },
        { clave: 'contribucion_marginal_cajon', etiqueta: 'Contribución marginal por cajón', unidad: 'ARS/cajon', valor: 24, completo: true },
        { clave: 'punto_equilibrio', etiqueta: 'Punto de equilibrio', unidad: 'cajones', valor: 2, completo: true },
      ],
    });
    expect(db.paqueteRubro.findMany).toHaveBeenCalledWith({
      where: {
        category: CATEGORIA_AVICOLA_POSTURA,
        OR: [{ userId: null }, { userId: USER }],
      },
    });
  });

  it('publica nombreProducto null sin fallar cuando el paquete no lo declara', async () => {
    db.paqueteRubro.findMany.mockResolvedValue([{
      category: 'RUBRO_SIN_NOMBRE',
      companyId: 'company-1', structureId: null, periodId: null, userId: USER,
      lexicon: {}, icons: {}, variants: [], seedParameters: [], alertRules: [], screens: {}, modulos: [], scale: null,
    }]);
    db.company.findFirst.mockResolvedValue({
      unidadGestion: { codigo: 'unidad', nombre: 'Unidad', factor: 1 },
      paquetesRubro: [{ category: 'RUBRO_SIN_NOMBRE' }],
    });

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    expect((JSON.parse(response.body) as { data: { rubro: unknown } }).data.rubro).toEqual({
      clave: 'RUBRO_SIN_NOMBRE', nombreProducto: null, icons: {}, kpisHome: [],
    });
  });

  it('mantiene el tablero en 200 y advierte cuando un KPI apunta a un campo inexistente', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    db.paqueteRubro.findMany.mockResolvedValue([{
      category: 'RUBRO_CAMPO_INVALIDO',
      companyId: 'company-1', structureId: null, periodId: null, userId: USER,
      lexicon: {}, icons: {}, variants: [], seedParameters: [], alertRules: [],
      screens: { home: { kpis: [{ clave: 'inexistente', etiqueta: 'Inexistente', unidad: 'unidad', campo: 'no.existe' }] } },
      modulos: [], scale: null,
    }]);
    db.company.findFirst.mockResolvedValue({
      unidadGestion: { codigo: 'unidad', nombre: 'Unidad', factor: 1 },
      paquetesRubro: [{ category: 'RUBRO_CAMPO_INVALIDO' }],
    });

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.rubro.kpisHome).toEqual([
      { clave: 'inexistente', etiqueta: 'Inexistente', unidad: 'unidad', valor: null, completo: false },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no.existe'));
    warn.mockRestore();
  });

  it('devuelve en una llamada el contrato de los seis indicadores', async () => {
    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: Record<string, unknown> };
    expect(body.data).toHaveProperty('costoPorCajon');
    expect(body.data).toHaveProperty('precioPromedioVenta');
    expect(body.data).toHaveProperty('contribucionMarginalPorCajon');
    expect(body.data).toHaveProperty('puntoEquilibrioCajones');
    expect(body.data).toHaveProperty('producidoCajones');
    expect(body.data).toHaveProperty('resultadoPeriodo');
    expect(body.data).toMatchObject({ pendientes: [], unidadGestion: { codigo: 'cajon', nombre: 'Cajón', factor: 12 } });
    expect(body.data.costoPorCajon).toMatchObject({
      variable: { parametrosSinConfirmar: false, parametrosSinConfirmarDetalle: [] },
    });
  });

  /**
   * MX-03 del plan de análisis marginal. La rama `fijo` llamaba a `completo(...)`
   * sin mirar la incompletitud de la contribución: con un rubro sin clasificar,
   * `.variable` salía «falta clasificar» y al lado `.fijo` mostraba un número
   * seguro que sumaba SOLO los rubros que sí se habían clasificado.
   *
   * Un dato parcial presentado como completo es peor que un dato faltante: el
   * dueño no tiene forma de saber que ese número le falta plata adentro. Regla
   * dura R13 del corpus — con costos sin clasificar se informa una zona, nunca
   * un punto falsamente preciso. (La zona en sí llega en M1-03; acá solamente
   * deja de mentir.)
   */
  it('no reporta el costo fijo como completo cuando la clasificación está incompleta (MX-03)', async () => {
    db.calculationRun.findFirst.mockResolvedValue({
      id: 'run-1', validated: true, executedAt: new Date('2026-09-02T00:00:00.000Z'),
      results: {
        grossMargin: 12, incompletitud: { incompleto: false, motivos: [] },
        detail: { unitCost: { unitFinishedGoodsCost: 5, basadoEn: 'producidas' } },
        contribucionMarginal: {
          incompleta: true,
          precioUnitario: 4,
          unidadesVendidas: 24,
          costoVariableUnitario: null,
          contribucionMarginalUnitaria: null,
          motivos: ['Falta clasificar frente al volumen el rubro Costos indirectos de producción.'],
          componentes: [
            { etiqueta: 'Materia prima', importeAbsorcion: 60, comportamientoVolumen: 'VARIABLE', parametroId: null },
            { etiqueta: 'Mano de obra directa', importeAbsorcion: 36, comportamientoVolumen: 'FIJO', parametroId: null },
            { etiqueta: 'Costos indirectos de producción', importeAbsorcion: 24, comportamientoVolumen: null, parametroId: null },
          ],
        },
        puntoEquilibrio: { incompleta: true, unidadesEquilibrio: null, fechaUltimoRecalculo: '2026-09-02T00:00:00.000Z' },
      },
    });

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: {
        costoPorCajon: Record<'variable' | 'fijo' | 'total', { valor: number | null; completo: boolean; motivos: string[] }>;
        pendientes: Array<{ area: string; dato: string }>;
      };
    };

    const motivo = 'Falta clasificar frente al volumen el rubro Costos indirectos de producción.';
    for (const clave of ['variable', 'fijo', 'total'] as const) {
      expect(body.data.costoPorCajon[clave], `costoPorCajon.${clave}`).toMatchObject({ valor: null, completo: false });
      expect(body.data.costoPorCajon[clave].motivos, `motivos de ${clave}`).toContain(motivo);
    }

    // La acción se ofrece una sola vez, aunque los tres indicadores dependan de ella.
    const declasificacion = body.data.pendientes.filter((p) => p.area === 'costeo' && p.dato.includes('Costos indirectos de producción'));
    expect(declasificacion).toHaveLength(1);

    // MX-02: con la clasificación incompleta, `fijo` sigue marcado como
    // unitario aunque el valor mismo sea null — el flag no depende de que
    // haya un número, es un rasgo del propio indicador.
    expect(body.data.costoPorCajon.fijo).toMatchObject({ esUnitarioDeFijo: true });
  });

  it('publica la zona completa sin fabricar un único punto (M1-03)', async () => {
    db.calculationRun.findFirst.mockResolvedValue({
      id: 'run-1', validated: true, executedAt: new Date('2026-09-02T00:00:00.000Z'),
      results: {
        grossMargin: 12, incompletitud: { incompleto: false, motivos: [] },
        detail: { unitCost: { unitFinishedGoodsCost: 5, basadoEn: 'producidas' } },
        contribucionMarginal: {
          incompleta: true,
          precioUnitario: 500,
          unidadesVendidas: 800,
          costoVariableUnitario: null,
          contribucionMarginalUnitaria: null,
          motivos: ['Falta clasificar frente al volumen el rubro Costos indirectos de producción.'],
          componentes: [
            { etiqueta: 'Costos indirectos de producción', importeAbsorcion: 90000, comportamientoVolumen: null, parametroId: null },
          ],
        },
        puntoEquilibrio: {
          incompleta: false,
          tipo: 'zona',
          unidadesEquilibrio: null,
          qMin: 709.09,
          qMax: 793.55,
          conceptosQueLaEnsanchan: [{
            clave: 'cip', etiqueta: 'Costos indirectos de producción', importe: 90000, aporteAlAncho: 84.46,
          }],
          fechaUltimoRecalculo: '2026-09-02T00:00:00.000Z',
        },
      },
    });

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.puntoEquilibrioCajones).toMatchObject({
      tipo: 'zona',
      valor: null,
      completo: true,
      qMin: 709.09 / 12,
      qMax: 793.55 / 12,
      conceptosQueLaEnsanchan: [{
        clave: 'cip',
        etiqueta: 'Costos indirectos de producción',
        importe: 90000,
        aporteAlAncho: 84.46 / 12,
      }],
    });
  });

  /**
   * MX-02 del plan de análisis marginal. `costoPorCajon.fijo` es un COSTO FIJO
   * UNITARIO — `AM4` (bóveda) lo llama "una entidad inexistente en la realidad,
   * porque establece una comparación entre dos magnitudes independientes entre
   * sí". Regla dura R10: los fijos se controlan en TOTALES, nunca por unidad.
   *
   * No se saca del contrato (hay consumidores), pero deja de ser el número
   * destacado: viaja marcado `esUnitarioDeFijo: true`. En su lugar el tablero
   * ofrece `costosFijosDelPeriodo` (el total, sin dividir) y
   * `cajonesQueTapanLosFijos = CF / cm`, que es la pregunta real que alguien
   * hace cuando mira "cuánto fijo hay por cajón".
   */
  it('el costo fijo unitario viaja marcado y el tablero ofrece los totales que sí son válidos (MX-02)', async () => {
    // Factor 1: la unidad de gestión coincide con la unidad base, para que la
    // aritmética del caso sea directa sin arrastrar el factor de conversión.
    db.company.findFirst.mockResolvedValue({
      unidadGestion: { codigo: 'cajon', nombre: 'Cajón', factor: 1 },
      paquetesRubro: [{ category: CATEGORIA_AVICOLA_POSTURA }],
    });
    db.calculationRun.findFirst.mockResolvedValue({
      id: 'run-1', validated: true, executedAt: new Date('2026-09-02T00:00:00.000Z'),
      results: {
        grossMargin: 12, incompletitud: { incompleto: false, motivos: [] },
        detail: { unitCost: { unitFinishedGoodsCost: 8, basadoEn: 'producidas' } },
        contribucionMarginal: {
          incompleta: false,
          precioUnitario: 10,
          unidadesVendidas: 20,
          costoVariableUnitario: 4,
          contribucionMarginalUnitaria: 6,
          componentes: [
            { etiqueta: 'Materia prima', importeAbsorcion: 48, comportamientoVolumen: 'VARIABLE', parametroId: null },
            { etiqueta: 'Mano de obra directa', importeAbsorcion: 60, comportamientoVolumen: 'FIJO', parametroId: null },
            { etiqueta: 'Costos indirectos de producción', importeAbsorcion: 60, comportamientoVolumen: 'FIJO', parametroId: null },
          ],
        },
        puntoEquilibrio: { incompleta: false, unidadesEquilibrio: 20, fechaUltimoRecalculo: '2026-09-02T00:00:00.000Z' },
      },
    });
    // period.productionQuantity = 24 (default del beforeEach); costoPorCajon.fijo
    // sigue calculándose igual que hoy: (60+60)/24 = 5.

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: {
        costoPorCajon: { fijo: { valor: number; esUnitarioDeFijo: boolean; motivos: string[] } };
        costosFijosDelPeriodo: { valor: number; completo: boolean };
        cajonesQueTapanLosFijos: { valor: number; completo: boolean };
      };
    };

    // El fijo unitario se conserva —mismo valor de siempre— pero marcado.
    expect(body.data.costoPorCajon.fijo).toMatchObject({ valor: 5, esUnitarioDeFijo: true });
    expect(body.data.costoPorCajon.fijo.motivos[0]).toMatch(/no es una magnitud económica|costo fijo unitario/i);

    // Los dos números nuevos: total sin dividir, y cuántos cajones lo tapan.
    expect(body.data.costosFijosDelPeriodo).toMatchObject({ valor: 120, completo: true });
    expect(body.data.cajonesQueTapanLosFijos).toMatchObject({ valor: 20, completo: true }); // 120 / 6
  });

  it('cajonesQueTapanLosFijos sale incompleto si la contribución marginal no es positiva', async () => {
    db.calculationRun.findFirst.mockResolvedValue({
      id: 'run-1', validated: true, executedAt: new Date('2026-09-02T00:00:00.000Z'),
      results: {
        grossMargin: -5, incompletitud: { incompleto: false, motivos: [] },
        detail: { unitCost: { unitFinishedGoodsCost: 8, basadoEn: 'producidas' } },
        contribucionMarginal: {
          incompleta: false,
          precioUnitario: 3,
          unidadesVendidas: 20,
          costoVariableUnitario: 4,
          contribucionMarginalUnitaria: -1,
          componentes: [
            { etiqueta: 'Materia prima', importeAbsorcion: 48, comportamientoVolumen: 'VARIABLE', parametroId: null },
            { etiqueta: 'Mano de obra directa', importeAbsorcion: 60, comportamientoVolumen: 'FIJO', parametroId: null },
          ],
        },
        puntoEquilibrio: { incompleta: true, unidadesEquilibrio: null, fechaUltimoRecalculo: '2026-09-02T00:00:00.000Z', motivoSinEquilibrio: 'La contribución marginal no es positiva.' },
      },
    });

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: { cajonesQueTapanLosFijos: { valor: number | null; completo: boolean; motivos: string[] } };
    };
    expect(body.data.cajonesQueTapanLosFijos).toMatchObject({ valor: null, completo: false });
    expect(body.data.cajonesQueTapanLosFijos.motivos.length).toBeGreaterThan(0);
  });

  /**
   * M0-03 del plan de análisis marginal. El sexto indicador (`resultadoPeriodo`)
   * se componía con `resultado.grossMargin`, que es el margen de ABSORCIÓN. El
   * tablero se presenta como la vista de costeo variable del negocio, y cuando
   * producción ≠ venta las dos cifras difieren — nada en pantalla lo avisaba.
   *
   * Doctrina (`AM4` nota CosteAR): "el costeo por absorción es una vista de
   * salida para cumplir la RT 17; el motor razona en costeo variable, y la
   * derivación es unidireccional". Las dos coinciden SOLO cuando se vende todo
   * lo producido.
   *
   * `resultadoPeriodoCosteoVariable = cm × vendidas − costos fijos del período`.
   * Con el fixture canónico del plan (`AM-01`): cm 256 × 800 vendidas − 192.000
   * de fijos = 12.800.
   */
  it('agrega el resultado por costeo variable junto al de absorción, con la diferencia explicada (M0-03)', async () => {
    db.costPeriod.findFirst.mockResolvedValue({
      id: PERIOD_ID, code: '2026-09', companyId: 'company-1', productionQuantity: 1000, salesQuantity: 800,
    });
    db.company.findFirst.mockResolvedValue({
      unidadGestion: { codigo: 'cajon', nombre: 'Cajón', factor: 1 },
      paquetesRubro: [{ category: CATEGORIA_AVICOLA_POSTURA }],
    });
    db.calculationRun.findFirst.mockResolvedValue({
      id: 'run-1', validated: true, executedAt: new Date('2026-09-02T00:00:00.000Z'),
      results: {
        // 51.200 de absorción: 12.800 (variable) + 200 unidades en stock final
        // x 192 de costo fijo unitario de absorción (192.000 / 1.000) = 38.400.
        grossMargin: 51200,
        incompletitud: { incompleto: false, motivos: [] },
        detail: { unitCost: { unitFinishedGoodsCost: 350, basadoEn: 'producidas' } },
        contribucionMarginal: {
          incompleta: false,
          precioUnitario: 500,
          unidadesVendidas: 800,
          costoVariableUnitario: 244,
          contribucionMarginalUnitaria: 256,
          componentes: [
            { etiqueta: 'Materia prima', importeAbsorcion: 150000, comportamientoVolumen: 'VARIABLE', parametroId: null },
            { etiqueta: 'Mano de obra directa', importeAbsorcion: 60000, comportamientoVolumen: 'FIJO', parametroId: null },
            { etiqueta: 'Costos indirectos de producción', importeAbsorcion: 132000, comportamientoVolumen: 'FIJO', parametroId: null },
          ],
        },
        puntoEquilibrio: { incompleta: false, unidadesEquilibrio: 750, fechaUltimoRecalculo: '2026-09-02T00:00:00.000Z' },
      },
    });

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: {
        resultadoPeriodo: { valor: number; completo: boolean };
        resultadoPeriodoCosteoVariable: { valor: number; completo: boolean };
        diferenciaPorVariacionDeInventarios: { valor: number; completo: boolean; explicacion: string | null };
      };
    };

    // Ninguno de los dos se esconde — se conservan los dos.
    expect(body.data.resultadoPeriodo).toMatchObject({ valor: 51200, completo: true });
    expect(body.data.resultadoPeriodoCosteoVariable).toMatchObject({ valor: 12800, completo: true });
    expect(body.data.diferenciaPorVariacionDeInventarios).toMatchObject({ valor: 38400, completo: true });
    expect(body.data.diferenciaPorVariacionDeInventarios.explicacion).toMatch(/producción|producidas/i);
  });

  it('con producción igual a venta, las dos cifras coinciden y la diferencia da 0', async () => {
    db.costPeriod.findFirst.mockResolvedValue({
      id: PERIOD_ID, code: '2026-09', companyId: 'company-1', productionQuantity: 800, salesQuantity: 800,
    });
    db.company.findFirst.mockResolvedValue({
      unidadGestion: { codigo: 'cajon', nombre: 'Cajón', factor: 1 },
      paquetesRubro: [{ category: CATEGORIA_AVICOLA_POSTURA }],
    });
    db.calculationRun.findFirst.mockResolvedValue({
      id: 'run-1', validated: true, executedAt: new Date('2026-09-02T00:00:00.000Z'),
      results: {
        grossMargin: 12800, // sin stock final, absorción y variable coinciden
        incompletitud: { incompleto: false, motivos: [] },
        detail: { unitCost: { unitFinishedGoodsCost: 350, basadoEn: 'producidas' } },
        contribucionMarginal: {
          incompleta: false, precioUnitario: 500, unidadesVendidas: 800,
          costoVariableUnitario: 244, contribucionMarginalUnitaria: 256,
          componentes: [
            { etiqueta: 'Materia prima', importeAbsorcion: 150000, comportamientoVolumen: 'VARIABLE', parametroId: null },
            { etiqueta: 'Mano de obra directa', importeAbsorcion: 60000, comportamientoVolumen: 'FIJO', parametroId: null },
            { etiqueta: 'Costos indirectos de producción', importeAbsorcion: 132000, comportamientoVolumen: 'FIJO', parametroId: null },
          ],
        },
        puntoEquilibrio: { incompleta: false, unidadesEquilibrio: 750, fechaUltimoRecalculo: '2026-09-02T00:00:00.000Z' },
      },
    });

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    const body = JSON.parse(response.body) as {
      data: { diferenciaPorVariacionDeInventarios: { valor: number; completo: boolean; explicacion: string | null } };
    };
    expect(body.data.diferenciaPorVariacionDeInventarios).toMatchObject({ valor: 0, completo: true });
    expect(body.data.diferenciaPorVariacionDeInventarios.explicacion).toBeNull();
  });

  it('enumera los parámetros sin confirmar sin consultas por indicador', async () => {
    db.calculationRun.findFirst.mockResolvedValue({
      id: 'run-1', validated: true, executedAt: new Date('2026-09-02T00:00:00.000Z'),
      results: {
        grossMargin: 12, incompletitud: { incompleto: false, motivos: [] },
        detail: { unitCost: { unitFinishedGoodsCost: 5, basadoEn: 'producidas' } },
        contribucionMarginal: {
          incompleta: false, precioUnitario: 4, unidadesVendidas: 24, costoVariableUnitario: 2, contribucionMarginalUnitaria: 2,
          componentes: [{ importeAbsorcion: 36, comportamientoVolumen: 'FIJO', parametroId: 'parametro-1' }],
        },
        puntoEquilibrio: { incompleta: false, unidadesEquilibrio: 24, fechaUltimoRecalculo: '2026-09-02T00:00:00.000Z' },
      },
    });
    db.parametroCosteo.findMany.mockResolvedValue([{ id: 'parametro-1', clave: 'rendimiento_operativo', descripcion: 'Rendimiento operativo' }]);

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { costoPorCajon: { variable: Record<string, unknown> } } };
    expect(body.data.costoPorCajon.variable).toMatchObject({
      parametrosSinConfirmar: true,
      parametrosSinConfirmarDetalle: [{ id: 'parametro-1', nombre: 'Rendimiento operativo' }],
    });
    expect(db.parametroCosteo.findMany).toHaveBeenCalledTimes(1);
  });

  it('devuelve los pendientes estructurados sin alterar los motivos de cada indicador', async () => {
    db.costPeriod.findFirst.mockResolvedValue({ id: PERIOD_ID, code: '2026-09', companyId: 'company-1', productionQuantity: 0, salesQuantity: 0 });
    db.company.findFirst.mockResolvedValue({ unidadGestion: null });
    db.calculationRun.findFirst.mockResolvedValue({
      id: 'run-1', validated: true, executedAt: new Date('2026-09-02T00:00:00.000Z'),
      results: {
        grossMargin: null,
        incompletitud: {
          incompleto: true,
          motivos: ['Hay un dato sin imputar.'],
          datosPendientes: [{ id: 'dato-1', nombre: 'Compra de prueba' }],
        },
        detail: { unitCost: { unitFinishedGoodsCost: null, basadoEn: 'producidas' } },
        contribucionMarginal: {
          incompleta: true, precioUnitario: 0, unidadesVendidas: 0, costoVariableUnitario: null, contribucionMarginalUnitaria: null,
          componentes: [{ etiqueta: 'Materia prima', importeAbsorcion: 0, comportamientoVolumen: null, parametroId: null }],
          motivos: [
            'Falta clasificar frente al volumen el rubro Materia prima.',
            'Falta una cantidad vendida mayor a cero para obtener el costo variable unitario.',
          ],
        },
        puntoEquilibrio: {
          incompleta: false, unidadesEquilibrio: null, fechaUltimoRecalculo: '2026-09-02T00:00:00.000Z',
          motivos: [
            'Falta clasificar frente al volumen el rubro Materia prima.',
            'Falta una cantidad vendida mayor a cero para obtener el costo variable unitario.',
          ],
          motivoSinEquilibrio: 'La contribución marginal unitaria es cero o negativa; no existe punto de equilibrio.',
        },
      },
    });

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { pendientes: Array<{ area: string; dato: string; periodo: { id: string; codigo: string } }>; precioPromedioVenta: { motivos: string[] }; unidadGestion: unknown } };
    expect(body.data.unidadGestion).toBeNull();
    expect(body.data.pendientes).toEqual(expect.arrayContaining([
      { area: 'imputacion', dato: 'Compra de prueba', periodo: { id: PERIOD_ID, codigo: '2026-09' } },
      { area: 'configuracion', dato: 'unidad de gestión de la empresa', periodo: { id: PERIOD_ID, codigo: '2026-09' } },
      { area: 'produccion', dato: 'cantidad producida mayor a cero', periodo: { id: PERIOD_ID, codigo: '2026-09' } },
      { area: 'ventas', dato: 'ventas del período', periodo: { id: PERIOD_ID, codigo: '2026-09' } },
      { area: 'costeo', dato: 'clasificación frente al volumen del rubro Materia prima', periodo: { id: PERIOD_ID, codigo: '2026-09' } },
      { area: 'costeo', dato: 'contribución marginal unitaria positiva', periodo: { id: PERIOD_ID, codigo: '2026-09' } },
      { area: 'costeo', dato: 'resultado de costos de la corrida', periodo: { id: PERIOD_ID, codigo: '2026-09' } },
    ]));
    expect(body.data.pendientes.filter((pendiente) => pendiente.area === 'ventas')).toHaveLength(1);
    expect(body.data.precioPromedioVenta.motivos).toContain('Falta cargar ventas del período para obtener este indicador.');
  });

  it('expone la falta de corrida como pendiente de cálculo', async () => {
    db.calculationRun.findFirst.mockResolvedValue(null);

    const server = await app();
    const response = await server.inject({ method: 'GET', url: `/periods/${PERIOD_ID}/tablero-dueno` });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { pendientes: unknown[]; resultadoPeriodo: { motivos: string[] }; unidadGestion: unknown } };
    expect(body.data.pendientes).toEqual([
      { area: 'calculo', dato: 'corrida de cálculo', periodo: { id: PERIOD_ID, codigo: '2026-09' } },
    ]);
    expect(body.data.resultadoPeriodo.motivos).toEqual(['No hay una corrida de cálculo para este período.']);
    expect(body.data.unidadGestion).toEqual({ codigo: 'cajon', nombre: 'Cajón', factor: 12 });
  });
});
