import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SegmentoAnalisisService } from '@/application/parametros/segmento-analisis-service.js';
import { RelacionReemplazoService } from '@/application/parametros/relacion-reemplazo-service.js';
import { MezclaOptimaService } from '@/application/parametros/mezcla-optima-service.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, db, type Tenant } from './helpers/tenants.js';

const actor = (userId: string) => ({ id: userId, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' }) as const;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  A = await createTenant('segmentos-a');
  B = await createTenant('segmentos-b');
});
afterAll(disconnect);

describe('SegmentoAnalisis con RLS real', () => {
  it('crea una jerarquía, calcula AM-02 y aísla empresas', async () => {
    const service = new SegmentoAnalisisService(db);
    const datos = [
      { nombre: 'A', participacion: 0.2, precioUnitario: 100, costoVariableUnitario: 60, costoFijoDirecto: 20_000, prorrateoIndirectos: 2_400 },
      { nombre: 'B', participacion: 0.3, precioUnitario: 60, costoVariableUnitario: 40, costoFijoDirecto: 6_000, prorrateoIndirectos: 3_600 },
      { nombre: 'C', participacion: 0.5, precioUnitario: 40, costoVariableUnitario: 28, costoFijoDirecto: 2_000, prorrateoIndirectos: 6_000 },
    ];
    const ids: string[] = [];
    for (const fila of datos) {
      const creado = await withTenantContext(A.userId, () => service.crear(A.userId, A.companyId, {
        ...fila, nivel: 'linea', parentId: null, produccionConjunta: false, coproductos: [],
      }, actor(A.userId)));
      ids.push(creado.id);
    }
    const unidad = await withTenant(A.userId, (tx) => tx.unidadMedida.create({ data: {
      companyId: A.companyId, userId: A.userId, codigo: 'hora-maquina', nombre: 'Horas máquina', factor: 1,
    } }));
    await withTenant(A.userId, async (tx) => {
      const recurso = await tx.recursoEscaso.create({ data: {
        companyId: A.companyId, userId: A.userId, clave: 'horas-maquina', unidadId: unidad.id,
        disponibleEnPeriodo: 1_000, esCuelloDeBotellaActivo: true,
      } });
      for (const [indice, valores] of [[3, 200], [1, 400], [8, 100]].entries()) {
        await tx.consumoRecursoPorUnidad.create({ data: {
          companyId: A.companyId, userId: A.userId, recursoId: recurso.id, segmentoId: ids[indice]!,
          consumoPorUnidad: valores[0]!, demandaMaxima: valores[1]!,
        } });
      }
    });
    const resultado = await withTenantContext(A.userId, () => service.calcular(A.userId, A.companyId));
    expect(resultado.equilibrioGeneral).toBe(2_000);
    expect(resultado.controlIndirectos.diferencia).toBe(0);
    const reemplazo = await withTenantContext(A.userId, () => new RelacionReemplazoService().calcular(A.userId, A.companyId, {
      segmentoOrigenId: ids[0]!, segmentoDestinoId: ids[1]!, cantidadOrigen: 50,
      resultadoObjetivo: 0, unidadCantidad: 'unidades',
    }));
    expect(reemplazo).toMatchObject({
      relacionReemplazo: 2, cantidadDestino: 100,
      resultadoCortoPlazo: 1_900, resultadoLargoPlazo: 900,
    });
    const mezcla = await withTenantContext(A.userId, () => new MezclaOptimaService().calcular(A.userId, A.companyId));
    expect(mezcla).toMatchObject({ contribucionMarginalTotal: 16_000 });
    expect(mezcla.ranking[0]).toMatchObject({ producto: 'B', cme: 20 });
    const mezclaB = await withTenantContext(B.userId, () => new MezclaOptimaService().calcular(B.userId, B.companyId));
    expect(mezclaB).toMatchObject({ recurso: null, ranking: [], contribucionMarginalTotal: null });
    await expect(withTenantContext(B.userId, () => new RelacionReemplazoService().calcular(B.userId, B.companyId, {
      segmentoOrigenId: ids[0]!, segmentoDestinoId: ids[1]!, cantidadOrigen: 50,
      resultadoObjetivo: 0, unidadCantidad: 'unidades',
    }))).rejects.toThrow(/segmento.*no encontrado/i);
    const vistoPorB = await withTenantContext(B.userId, () => service.listar(B.userId, B.companyId));
    expect(vistoPorB).toEqual([]);
    await expect(withTenantContext(B.userId, () => service.listar(B.userId, A.companyId)))
      .rejects.toThrow(/negocio no encontrado/i);
  });
});
