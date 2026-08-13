import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * DE QUIÉN SON LOS DATOS QUE ESTÁ TOCANDO ESTA REQUEST.
 *
 * Las políticas RLS de Postgres leen `app.user_id` de la sesión. Hasta acá ese
 * valor solo se seteaba dentro de `withTenant`, que se usa en 10 servicios y
 * SIEMPRE en transacciones de escritura. Las 86 lecturas del producto corrían
 * sin él, así que las políticas no matcheaban ninguna fila.
 *
 * Eso no se notaba porque el rol de conexión ignora RLS —superusuario o
 * `BYPASSRLS`—, que es exactamente contra lo que advierte `prisma/rls.sql`. Las
 * 13 tablas tienen `FORCE ROW LEVEL SECURITY`, así que ni siquiera alcanza con
 * ser dueño de la tabla: el día que se creara el rol dedicado que ese archivo
 * pide, la app dejaba de leer absolutamente todo.
 *
 * Este almacén lleva el usuario a lo largo de toda la request sin tener que
 * pasarlo por parámetro por 22 archivos de servicios. Lo puebla el pre-handler
 * de autenticación y lo consume la extensión de Prisma (`prisma.ts`).
 */
export interface TenantContext {
  /** El dueño de los datos. `null` = alcance de sistema (ver `asSystem`). */
  userId: string | null;
  /**
   * Ya estamos dentro de una transacción que seteó `app.user_id` a mano
   * (`withTenant`). La extensión de Prisma tiene que quedarse quieta: el valor
   * ya está puesto, y abrir otra transacción por consulta fallaría.
   */
  enTransaccion?: boolean;
}

const store = new AsyncLocalStorage<TenantContext>();

/** Corre `fn` con todas sus consultas acotadas a este usuario. */
export function withTenantContext<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ userId }, fn);
}

/**
 * Acota al usuario TODO lo que siga en esta request.
 *
 * Va con `enterWith` y no con `run` porque lo llama un pre-handler de Fastify:
 * un `run(ctx, fn)` acota solo a `fn`, y cuando el hook retorna el handler
 * quedaría otra vez sin contexto. `enterWith` persiste en la cadena asincrónica
 * que sigue, que es exactamente el alcance de la request.
 */
export function enterTenantScope(userId: string): void {
  store.enterWith({ userId });
}

/**
 * Deja el resto de la request SIN acotar a ningún inquilino.
 *
 * Es la versión de `asSystem` para un pre-handler. El único uso hoy es el panel
 * de administración: mira todas las empresas a propósito, y el admin es personal
 * interno que no tiene datos propios. Sigue protegido por `requireRole('ADMIN')`.
 */
export function enterSystemScope(motivo: string): void {
  void motivo;
  store.enterWith({ userId: null });
}

/** Marca que ya hay una transacción con el inquilino seteado. Lo usa `withTenant`. */
export function enterExplicitTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const actual = store.getStore();
  return store.run({ userId: actual?.userId ?? null, enTransaccion: true }, fn);
}

export function inExplicitTransaction(): boolean {
  return store.getStore()?.enTransaccion === true;
}

/**
 * LA ESCOTILLA, y es a propósito que sea explícita y fácil de grepear.
 *
 * Hay código que cruza inquilinos porque tiene que hacerlo: el panel de admin
 * ve todas las empresas, y los workers (`daily-run`, `recalculate`,
 * `nightly-learning`, `macro-sync`) no corren dentro de ninguna request, así que
 * no hay un usuario de dónde sacar el contexto.
 *
 * Antes eso también funcionaba, pero por el mismo bypass silencioso que hacía
 * que nada estuviera protegido. Ahora hay que pedirlo, y queda escrito quién lo
 * pidió y por qué.
 *
 * Al usarlo, el filtro por `userId` de la capa de aplicación vuelve a ser la
 * única barrera. No lo uses para ahorrarte pasar el usuario.
 */
export function asSystem<T>(motivo: string, fn: () => Promise<T>): Promise<T> {
  void motivo; // documenta el llamador; no se usa en runtime
  return store.run({ userId: null }, fn);
}

/** El usuario de la request en curso, o `null` si no hay contexto o es sistema. */
export function currentTenantId(): string | null {
  return store.getStore()?.userId ?? null;
}
