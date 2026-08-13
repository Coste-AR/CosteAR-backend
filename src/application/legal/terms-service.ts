import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PrismaClient, TermsVersion } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma.js';
import { NotFoundError, ValidationError } from '../../domain/errors/domain-error.js';

// Sube tres niveles hasta la raíz del proyecto. Da lo mismo desde `src/` que
// desde `dist/`: las dos viven a la misma profundidad, y el Dockerfile copia
// `prisma/` a la imagen de runtime.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const INITIAL_TERMS_PATH = join(ROOT, 'prisma', 'initial-terms.md');

/**
 * TÉRMINOS Y CONDICIONES — versionado explícito.
 *
 * Nunca se edita el contenido de una versión ya publicada — "editar" desde
 * admin en realidad PUBLICA una versión nueva y desactiva la anterior. Eso
 * mantiene fija para siempre la prueba de "qué aceptó cada usuario, cuándo"
 * (TermsAcceptance apunta a un termsVersionId concreto e inmutable), y de
 * paso resuelve solo el caso "cambiaron los términos, hay que re-aceptar":
 * cualquier usuario cuya última aceptación no sea de la versión activa
 * necesita volver a aceptar, sin ningún job ni flag adicional.
 *
 * Solo aplica a costistas (COSTISTA). El registro de operadores de empresa
 * (EMPRESA_OPERATOR) es por invitación, no por /auth/register, y el personal
 * interno (ADMIN) nunca pasa por el frontend de costistas.
 */
export class TermsService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getCurrentVersion(): Promise<TermsVersion | null> {
    return this.db.termsVersion.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } });
  }

  async requireCurrentVersion(): Promise<TermsVersion> {
    const current = await this.getCurrentVersion();
    if (!current) {
      // No debería pasar nunca en un ambiente correctamente booteado — lo
      // siembra `ensureInitialVersion()` antes de aceptar tráfico.
      // Si pasa, es mejor un 500 ruidoso que dejar registrar gente sin
      // términos vigentes.
      throw new ValidationError('No hay una versión vigente de los Términos y Condiciones. Contactá a soporte.');
    }
    return current;
  }

  /**
   * Siembra la versión 1 si no hay ninguna activa. Idempotente: corre en cada
   * boot (mismo patrón que apply-rls) porque es la única forma de garantizar,
   * sin que nadie ejecute nada a mano, que un ambiente nuevo o resetado no
   * quede con `requireCurrentVersion()` tirando error y el registro bloqueado.
   *
   * Devuelve la versión creada, o `null` si ya había una y no hizo falta.
   */
  async ensureInitialVersion(): Promise<TermsVersion | null> {
    if (await this.getCurrentVersion()) return null;

    const content = await readFile(INITIAL_TERMS_PATH, 'utf8');
    return this.db.termsVersion.create({ data: { version: 1, content, isActive: true } });
  }

  /**
   * Para el gate post-login/registro: ¿este usuario tiene que (re)aceptar?
   * Se le pide a costistas Y a operarios de empresa (EMPRESA_OPERATOR) —
   * cualquiera que use la plataforma como cliente. Al personal interno
   * (ADMIN) no: nunca pasa por el frontend de costistas (login lo manda
   * directo al panel de admin), y el contrato es con quien usa el producto.
   */
  async needsAcceptance(userId: string, role: string): Promise<{ needs: boolean; current: TermsVersion | null }> {
    if (role === 'ADMIN') return { needs: false, current: null };

    const current = await this.getCurrentVersion();
    if (!current) return { needs: false, current: null };

    const accepted = await this.db.termsAcceptance.findUnique({
      where: { userId_termsVersionId: { userId, termsVersionId: current.id } },
    });
    return { needs: !accepted, current };
  }

  /**
   * Registra la aceptación de la versión indicada. Rechaza si `termsVersionId`
   * no es la versión ACTIVA en este momento — nunca se acepta "a ciegas" una
   * versión vieja que el cliente tenía cacheada.
   */
  async accept(
    userId: string,
    termsVersionId: string,
    meta: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<void> {
    const current = await this.requireCurrentVersion();
    if (termsVersionId !== current.id) {
      throw new ValidationError('La versión de los Términos que intentás aceptar ya no está vigente. Recargá la página.');
    }

    // Idempotente: si ya la había aceptado (doble click, reintento), no falla.
    await this.db.termsAcceptance.upsert({
      where: { userId_termsVersionId: { userId, termsVersionId: current.id } },
      create: { userId, termsVersionId: current.id, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null },
      update: {},
    });
  }

  // ── Admin ──────────────────────────────────────────────────────────────

  async listVersions(): Promise<TermsVersion[]> {
    return this.db.termsVersion.findMany({ orderBy: { version: 'desc' } });
  }

  /**
   * Publica una versión nueva y la vuelve la activa. Desactivar la anterior y
   * crear la nueva van en una transacción: nunca queda un instante con dos
   * versiones activas ni con ninguna.
   */
  async publish(content: string, adminUserId: string): Promise<TermsVersion> {
    return this.db.$transaction(async (tx) => {
      const last = await tx.termsVersion.findFirst({ orderBy: { version: 'desc' } });
      const nextVersion = (last?.version ?? 0) + 1;

      await tx.termsVersion.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return tx.termsVersion.create({
        data: { version: nextVersion, content, isActive: true, createdBy: adminUserId },
      });
    });
  }

  async getVersion(id: string): Promise<TermsVersion> {
    const version = await this.db.termsVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundError('Versión de Términos y Condiciones no encontrada');
    return version;
  }
}
