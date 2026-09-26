import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventarioService } from '@/application/inventario/inventario-service.js';
import { withTenant } from '@/infrastructure/database/prisma.js';
import { createTenant, disconnect, type Tenant } from './helpers/tenants.js';

let tenant: Tenant;
const actor = (id: string) => ({ id, role: 'EMPRESA_ADMIN', area: 'costista', method: 'manual' });
beforeAll(async () => { tenant = await createTenant('inventario-ppp'); });
afterAll(disconnect);

describe('FX-OT — inventario PPP con RLS real', () => {
  it('MOVIL valúa chapa, perfiles y abertura con flete y conserva 70 unidades', async () => {
    const service = new InventarioService();
    const unidad = await withTenant(tenant.userId, (tx) => tx.unidadMedida.create({ data: {
      companyId: tenant.companyId, userId: tenant.userId, codigo: 'u-fx', nombre: 'Unidad', factor: 1,
    } }));
    const order = await withTenant(tenant.userId, (tx) => tx.ordenTrabajo.create({ data: {
      companyId: tenant.companyId, userId: tenant.userId, codigo: 'OT-FX-INV', descripcion: 'Obra ficticia', cliente: 'Cliente ficticio',
    } }));
    const destinationOrder = await withTenant(tenant.userId, (tx) => tx.ordenTrabajo.create({ data: {
      companyId: tenant.companyId, userId: tenant.userId, codigo: 'OT-FX-DEST', descripcion: 'Destino ficticio', cliente: 'Cliente ficticio',
    } }));
    const create = (codigo: string) => service.crearArticulo(tenant.userId, tenant.companyId, { codigo, descripcion: codigo, unidadId: unidad.id, almacenable: true }, actor(tenant.userId));
    const chapa = await create('CHAPA'); const perfiles = await create('PERFILES'); const abertura = await create('ABERTURA');
    const move = (input: Parameters<InventarioService['registrar']>[2]) => service.registrar(tenant.userId, tenant.companyId, input, actor(tenant.userId));
    const common = { fecha: '2026-09-25', periodoImputado: '2026-09-01' };
    await move({ ...common, articuloId: chapa.id, tipo: 'INGRESO', cantidad: 100, costoUnitario: 1000, documento: 'Compra 1' });
    const salida1 = await move({ ...common, articuloId: chapa.id, tipo: 'SALIDA', cantidad: 60, ordenId: order.id, documento: 'Vale 1' });
    await move({ ...common, articuloId: chapa.id, tipo: 'INGRESO', cantidad: 60, costoUnitario: 1300, documento: 'Compra 2' });
    const salida2 = await move({ ...common, articuloId: chapa.id, tipo: 'SALIDA', cantidad: 30, ordenId: order.id, documento: 'Vale 2' });
    const devolucion = await move({ ...common, articuloId: chapa.id, tipo: 'DEVOLUCION', cantidad: 5, movimientoOrigenId: salida2.id, documento: 'Devolución 1' });
    await move({ ...common, articuloId: perfiles.id, tipo: 'INGRESO', cantidad: 100, costoUnitario: 400, documento: 'Compra perfiles' });
    const salidaPerfiles = await move({ ...common, articuloId: perfiles.id, tipo: 'SALIDA', cantidad: 60, ordenId: order.id, documento: 'Vale perfiles' });
    await move({ ...common, articuloId: abertura.id, tipo: 'INGRESO', cantidad: 1, costoUnitario: 150000, gastosCompra: 10000, documento: 'Compra abertura' });
    const salidaAbertura = await move({ ...common, articuloId: abertura.id, tipo: 'SALIDA', cantidad: 1, ordenId: order.id, documento: 'Vale abertura' });

    expect(Number(devolucion.costoUnitario) * -5).toBe(-5900);
    expect(Number(salida1.costoUnitario) * 60 + Number(salida2.costoUnitario) * 30 - Number(devolucion.costoUnitario) * 5).toBe(89500);
    expect(Number(salidaPerfiles.costoUnitario) * 60).toBe(24000);
    expect(Number(salidaAbertura.costoUnitario)).toBe(160000);
    expect(await service.listar(tenant.userId, tenant.companyId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ codigo: 'CHAPA', saldoCantidad: 75, saldoValor: 88500, ppp: 1180 }),
    ]));
    expect(await withTenant(tenant.userId, (tx) => tx.traceAuditLog.count({ where: {
      entityType: 'MovimientoInventario', entityId: { in: [salida1.id, salida2.id, salidaPerfiles.id, salidaAbertura.id] },
    } }))).toBe(4);

    const transferencia = await move({
      ...common, articuloId: chapa.id, tipo: 'TRANSFERENCIA', cantidad: 5,
      movimientoOrigenId: salida2.id, ordenDestinoId: destinationOrder.id, documento: 'Transferencia 1',
    });
    expect(transferencia).toMatchObject({ ordenId: order.id, ordenDestinoId: destinationOrder.id });
    expect(Number(transferencia.cantidad) * Number(transferencia.costoUnitario)).toBe(5900);
    expect(await service.listar(tenant.userId, tenant.companyId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ codigo: 'CHAPA', saldoCantidad: 75, saldoValor: 88500, ppp: 1180 }),
    ]));

    const importedInput = {
      ...common, articuloId: perfiles.id, tipo: 'INGRESO' as const, cantidad: 1, costoUnitario: 400,
      identidadExterna: 'erp:recepcion:fx-ot', documentoHash: 'b'.repeat(64),
    };
    const imported = await move(importedInput);
    const repeated = await move(importedInput);
    expect(repeated.id).toBe(imported.id);
    expect(await withTenant(tenant.userId, (tx) => tx.movimientoInventario.count({ where: {
      companyId: tenant.companyId, identidadExterna: importedInput.identidadExterna, documentoHash: importedInput.documentoHash,
    } }))).toBe(1);
  });
});
