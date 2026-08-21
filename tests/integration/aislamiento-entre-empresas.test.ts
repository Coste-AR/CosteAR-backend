import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, createTenant, disconnect, type Tenant } from './helpers/tenants.js';
import { withTenantContext } from '@/infrastructure/database/tenant-context.js';
import { CostStructureService } from '@/application/cost-structures/cost-structure-service.js';
import { AllocationBaseService } from '@/application/cost-structures/allocation-base-service.js';
import { DataPointService } from '@/application/trazabilidad/data-point-service.js';
import { NotFoundError } from '@/domain/errors/domain-error.js';

/**
 * AISLAMIENTO ENTRE EMPRESAS.
 *
 * Es la única categoría de falla que no se arregla pidiendo disculpas. CosteAR
 * maneja la estructura de costos de empresas argentinas: que una vea la de otra
 * no es un bug, es el fin de la confianza en el producto.
 *
 * Ya se rompió una vez —julio de 2026, el catálogo de bases de asignación— y lo
 * encontró una auditoría de seguridad, no el uso normal. Desde entonces ninguna
 * de las cuatro auditorías volvió a probarlo: las cuatro trabajaron con una
 * sola empresa.
 *
 * POR QUÉ ESTO NO PUEDE SER UN TEST UNITARIO. La protección tiene dos capas y
 * ninguna se puede verificar con Prisma mockeado:
 *
 *   1. RLS, que vive en Postgres (13 tablas de 43). Un mock no ejecuta políticas.
 *   2. El filtro por `userId` de la capa de aplicación, que cubre el resto. Un
 *      mock confirma que se llamó a `findFirst` con cierto `where`, no que la
 *      base no devuelva las filas del otro.
 *
 * Se empieza por las rutas que devuelven plata.
 */

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  A = await createTenant('A');
  B = await createTenant('B');
});

// No se borra nada: la base de integración es desechable (ver el helper).
afterAll(disconnect);

describe('La empresa A no puede leer nada de la B', () => {
  it('🔒 no ve su estructura de costos', async () => {
    const svc = new CostStructureService(db);
    await expect(svc.requireStructure(A.userId, B.structureId)).rejects.toThrow(NotFoundError);
  });

  it('🔒 no ve sus estructuras al listar por empresa', async () => {
    const svc = new CostStructureService(db);
    // Ni siquiera puede nombrar la empresa ajena: el listado exige que la
    // empresa sea suya antes de mirar las estructuras.
    await expect(svc.listByCompany(A.userId, B.companyId)).rejects.toThrow(NotFoundError);
  });

  /**
   * 🚨 HALLAZGO, y es el más importante de esta suite.
   *
   * Con RLS efectivamente aplicado, el costista tampoco puede leer LO SUYO.
   *
   * `requireCompany` hace `company.findFirst({ where: { id, userId } })`: una
   * lectura simple, fuera de `withTenant`. Y `withTenant` es lo único que setea
   * `app.user_id`, del que dependen las políticas. Sin ese valor,
   * `current_app_user_id()` es NULL, la política no matchea ninguna fila y la
   * consulta vuelve vacía. El servicio lo interpreta como "no existe".
   *
   * `withTenant` solo se usa en 10 servicios y siempre en transacciones de
   * ESCRITURA. Todas las lecturas del producto están en esta situación.
   *
   * Qué significa en la práctica: hoy producción sólo funciona porque el rol de
   * conexión ignora RLS —o sea, superusuario o con BYPASSRLS—, que es
   * exactamente contra lo que advierte `prisma/rls.sql` en su encabezado. El día
   * que alguien cree el rol dedicado que ese archivo pide, la app deja de leer
   * absolutamente todo.
   *
   * Este caso NO describe el comportamiento deseado: lo fija para que el
   * problema no se pueda perder de vista, y para que el día que se resuelva
   * —seteando el tenant también en las lecturas— este test falle y haya que
   * darlo vuelta a propósito.
   *
   * ── DADO VUELTA el 09/08/2026 ──────────────────────────────────────────────
   * Ese día llegó. Las lecturas ahora setean el inquilino vía la extensión de
   * Prisma (`infrastructure/database/prisma.ts`), así que lo propio se lee. Los
   * dos casos de abajo prueban las dos mitades: que lo suyo aparece, y que
   * setear el inquilino no se convirtió en una llave maestra.
   */
  it('🔑 el costista SÍ lee lo suyo, con las políticas aplicadas', async () => {
    const { items: propias } = await withTenantContext(A.userId, () =>
      new CostStructureService(db).listByCompany(A.userId, A.companyId),
    );
    expect(propias.map((s) => s.id)).toEqual([A.structureId]);
  });

  it('🔒 con su inquilino seteado, sigue sin ver la empresa de B', async () => {
    const svc = new CostStructureService(db);
    await expect(
      withTenantContext(A.userId, () => svc.listByCompany(A.userId, B.companyId)),
    ).rejects.toThrow(NotFoundError);
  });

  it('🔒 no ve sus datos trazables, que son los que tienen la plata', async () => {
    const svc = new DataPointService(db);
    await expect(svc.requireDataPoint(A.userId, B.dataPointId)).rejects.toThrow(NotFoundError);
  });

  it('🔒 no ve su catálogo de bases de asignación (el agujero del 29/07/2026)', async () => {
    // Este es el bug real que se cerró: `listCatalog` tomaba un companyId
    // provisto por el cliente sin verificar que le perteneciera.
    const svc = new AllocationBaseService(db);
    await expect(svc.listCatalog(A.userId, B.companyId)).rejects.toThrow(NotFoundError);
  });

  it('🔒 NotFound y no Forbidden: no se filtra ni la existencia del id ajeno', async () => {
    // Un 403 confirmaría que ese id existe. Con un inexistente tiene que dar
    // exactamente lo mismo que con uno ajeno.
    const svc = new CostStructureService(db);
    const ajena = await svc.requireStructure(A.userId, B.structureId).catch((e: Error) => e);
    const inventada = await svc
      .requireStructure(A.userId, '00000000-0000-0000-0000-000000000000')
      .catch((e: Error) => e);

    expect((ajena as Error).constructor).toBe((inventada as Error).constructor);
    expect((ajena as Error).message).toBe((inventada as Error).message);
  });
});

describe('La protección de fondo, la que nadie mira hasta que falla', () => {
  it('🔒 el rol de conexión NO tiene BYPASSRLS ni es superusuario', async () => {
    // `prisma/rls.sql` lo advierte en su encabezado y ningún código lo verifica:
    // con BYPASSRLS todas las políticas se ignoran EN SILENCIO. La base seguiría
    // teniendo sus 13 políticas, `apply-rls.mjs` seguiría saliendo con código 0,
    // y el aislamiento no existiría.
    const [rol] = await db.$queryRawUnsafe<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );

    expect(rol).toBeDefined();
    expect(rol!.rolsuper, 'el rol de la app es superusuario: RLS no se aplica').toBe(false);
    expect(rol!.rolbypassrls, 'el rol de la app tiene BYPASSRLS: RLS no se aplica').toBe(false);
  });

  it('🔒 las tablas con plata tienen RLS habilitado y su política de inquilino', async () => {
    // Si alguien agrega una tabla nueva y se olvida de `rls.sql`, esto lo dice
    // acá y no seis meses después en una auditoría.
    const conRls = await db.$queryRawUnsafe<Array<{ tablename: string; policies: bigint }>>(`
      SELECT c.relname AS tablename, COUNT(p.polname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relrowsecurity
        AND c.relname IN ('companies', 'cost_structures', 'cost_calculations', 'data_points', 'data_point_versions')
      GROUP BY c.relname
    `);

    const nombres = conRls.map((r) => r.tablename).sort();
    expect(nombres).toEqual([
      'companies',
      'cost_calculations',
      'cost_structures',
      'data_point_versions',
      'data_points',
    ]);
    for (const t of conRls) {
      expect(Number(t.policies), `${t.tablename} tiene RLS activo pero ninguna política`).toBeGreaterThan(0);
    }
  });
});
