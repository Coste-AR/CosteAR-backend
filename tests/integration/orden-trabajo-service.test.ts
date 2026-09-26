import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrdenTrabajoService } from '@/application/ordenes/orden-trabajo-service.js';
import { ParteHorasService } from '@/application/ordenes/parte-horas-service.js';
import { prisma, withTenant } from '@/infrastructure/database/prisma.js';
import { randomUUID } from 'node:crypto';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let A: Tenant;
let B: Tenant;
const actor = (userId: string) => ({ id: userId, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' });

beforeAll(async () => { A = await createTenant('orden-a'); B = await createTenant('orden-b'); });
afterAll(disconnect);

describe('FX-OT — orden de trabajo con RLS real', () => {
  it('aprueba 675.000 de MOD con prima causada y excluye entrega de la base del taller', async () => {
    const orders = new OrdenTrabajoService();
    const parts = new ParteHorasService();
    await withTenant(A.userId, (tx) => tx.company.update({ where: { id: A.companyId }, data: { industry: 'CONSTRUCCION_MODULAR' } }));
    const order = await orders.create(A.userId, A.companyId, {
      codigo: `OT-HH-${randomUUID().slice(0, 8)}`, descripcion: 'Obra X', cliente: 'Cliente ficticio', plantillaId: null, fechaInicio: null,
    }, actor(A.userId));
    const stages = await orders.listStages(A.userId, order.id);
    const stage = stages.find((row) => !row.esEntrega)!;
    const rate = await withTenant(A.userId, (tx) => tx.tarifaManoObra.create({ data: {
      companyId: A.companyId, userId: A.userId, nombre: 'Taller', basicRemuneration: 650000,
      hoursWorked: 130, itcsPct: 0, primaExtraPct: 50, vigenteDesde: new Date('2026-09-01T00:00:00Z'),
    } }));
    const additional = await withTenant(A.userId, (tx) => tx.versionPresupuesto.create({ data: {
      companyId: A.companyId, ordenId: order.id, userId: A.userId, tipo: 'ADICIONAL', numero: 1,
      vigenteDesde: new Date('2026-09-01T00:00:00Z'), vigenciaDias: 30, estado: 'APROBADO',
      costoPrevisto: 100000, precio: 150000, plazoDias: 0, causaAdicional: 'Cambio ficticio',
    } }));
    await withTenant(A.userId, (tx) => tx.company.update({ where: { id: A.companyId }, data: { politicaPrimaExtra: 'DIRECTA_CON_CAUSA' } }));
    const loaded = await parts.create(A.userId, order.id, {
      personaId: A.userId, etapaId: stage.id, fecha: '2026-09-25', horasNormales: 120, horasExtra: 10,
      tarifaId: rate.id, causaExtra: { texto: 'Cambio ficticio', versionPresupuestoId: additional.id },
    }, actor(A.userId));
    const approved = await parts.approve(A.userId, loaded.id, actor(A.userId));
    expect(approved).toMatchObject({ importeMod: 675000, incluyeBaseHorasTaller: true, estado: 'APROBADO' });
    expect(await withTenant(B.userId, (tx) => tx.parteHoras.findMany({ where: { id: loaded.id } }))).toEqual([]);
  });
  it('copia las siete etapas del modelo de 40 pies y no cambia si se edita el modelo', async () => {
    const service = new OrdenTrabajoService();
    await withTenant(A.userId, (tx) => tx.company.update({
      where: { id: A.companyId }, data: { industry: 'CONSTRUCCION_MODULAR' },
    }));
    const etapas = [
      ['metalurgica', 'Metalúrgica', false], ['aislacion', 'Aislación', false],
      ['aberturas', 'Aberturas', false], ['instalaciones', 'Instalaciones', false],
      ['terminaciones', 'Terminaciones', false], ['transporte', 'Transporte', true],
      ['montaje', 'Montaje', true],
    ] as const;
    const modelo = await withTenant(A.userId, (tx) => tx.plantillaOrden.create({
      data: {
        companyId: A.companyId, userId: A.userId, nombre: 'Módulo de 40 pies',
        renglonesBase: [{ clave: 'estructura_base', descripcion: 'Estructura base' }],
        etapas: { create: etapas.map(([clave, nombre, esEntrega], index) => ({
          userId: A.userId, clave, nombre, orden: index + 1, esEntrega,
        })) },
      },
    }));
    expect(await service.listTemplates(A.userId, A.companyId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ nombre: 'Módulo de 40 pies' }),
    ]));
    const order = await service.create(A.userId, A.companyId, {
      codigo: 'OT-MODELO', descripcion: 'Obra X', cliente: 'Cliente ficticio',
      plantillaId: modelo.id, fechaInicio: null,
    }, actor(A.userId));

    const originales = await service.listStages(A.userId, order.id);
    expect(originales).toHaveLength(7);
    expect(originales.filter((etapa) => etapa.esEntrega)).toHaveLength(2);
    expect(order.renglonesBase).toEqual([{ clave: 'estructura_base', descripcion: 'Estructura base' }]);

    await withTenant(A.userId, (tx) => tx.plantillaOrden.update({
      where: { id: modelo.id }, data: { nombre: 'Modelo editado' },
    }));
    expect(await service.listStages(A.userId, order.id)).toEqual(originales);
  });

  it('rechaza con 404 una plantilla de otra empresa', async () => {
    const service = new OrdenTrabajoService();
    const plantillaAjena = await withTenant(B.userId, (tx) => tx.plantillaOrden.create({
      data: { companyId: B.companyId, userId: B.userId, nombre: 'Modelo privado', renglonesBase: [] },
    }));

    await expect(service.create(A.userId, A.companyId, {
      codigo: 'OT-AJENA', descripcion: 'Obra X', cliente: 'Cliente ficticio',
      plantillaId: plantillaAjena.id, fechaInicio: null,
    }, actor(A.userId))).rejects.toMatchObject({ statusCode: 404 });
  });

  it('recorre el ciclo hasta pendiente de cierre y audita cada paso', async () => {
    const service = new OrdenTrabajoService();
    const order = await service.create(A.userId, A.companyId, {
      codigo: 'OT-001', descripcion: 'Obra X', cliente: 'Cliente ficticio', plantillaId: null, fechaInicio: '2026-09-25',
    }, actor(A.userId));
    for (const estado of ['COTIZADA', 'APROBADA', 'EN_PRODUCCION', 'TERMINADA_TECNICA', 'PENDIENTE_CIERRE'] as const) {
      await service.transition(A.userId, order.id, { estado }, actor(A.userId));
    }
    expect((await service.get(A.userId, order.id)).estado).toBe('PENDIENTE_CIERRE');
    expect(await withTenant(A.userId, (tx) => tx.traceAuditLog.count({ where: { entityType: 'OrdenTrabajo', entityId: order.id } }))).toBe(6);
    await expect(service.get(B.userId, order.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await withTenant(B.userId, (tx) => tx.ordenTrabajo.findMany({ where: { id: order.id } }))).toEqual([]);
  });

  it('limita el código a la empresa', async () => {
    const service = new OrdenTrabajoService();
    await expect(service.create(A.userId, A.companyId, {
      codigo: 'OT-001', descripcion: 'Duplicada', cliente: 'Cliente ficticio', plantillaId: null, fechaInicio: null,
    }, actor(A.userId))).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.create(B.userId, B.companyId, {
      codigo: 'OT-001', descripcion: 'Otra empresa', cliente: 'Cliente ficticio', plantillaId: null, fechaInicio: null,
    }, actor(B.userId))).resolves.toMatchObject({ codigo: 'OT-001' });
  });

  it('RLS niega por defecto y sólo expone una orden con entidad y permiso explícitos', async () => {
    const service = new OrdenTrabajoService();
    const order = await service.create(A.userId, A.companyId, {
      codigo: `OT-RLS-${randomUUID().slice(0, 8)}`, descripcion: 'Obra X', cliente: 'Cliente ficticio',
      plantillaId: null, fechaInicio: null,
    }, actor(A.userId));
    const operator = await prisma.user.create({ data: {
      email: `planta-${randomUUID()}@test.local`, name: 'Personal de planta',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$0000000000000000$0000000000000000000000000000000',
      role: 'EMPRESA_OPERATOR',
    } });
    const membership = await withTenant(A.userId, async (tx) => {
      const connection = await tx.empresaConnection.upsert({
        where: { companyId_costistId: { companyId: A.companyId, costistId: A.userId } },
        create: { companyId: A.companyId, costistId: A.userId }, update: {},
      });
      return tx.operatorMembership.create({ data: {
        operatorId: operator.id, connectionId: connection.id, permisos: ['ordenes.ver'],
        ordenesAutorizadas: { create: { ordenId: order.id } },
      } });
    });

    expect(await withTenant(operator.id, (tx) => tx.ordenTrabajo.findMany({ where: { id: order.id } })))
      .toHaveLength(1);
    await withTenant(A.userId, (tx) => tx.operatorMembership.update({
      where: { id: membership.id }, data: { permisos: [] },
    }));
    expect(await withTenant(operator.id, (tx) => tx.ordenTrabajo.findMany({ where: { id: order.id } })))
      .toEqual([]);
  });
});
