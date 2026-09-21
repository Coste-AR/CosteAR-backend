import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { recordAudit, type AuditContext } from '../audit/audit-logger.js';
import { ModulosRubroService, type ModuloRubroListado } from '../operacion/modulos-rubro-service.js';
import { userPreferencesSchema, type UserPreferences } from '../../shared/schemas/user-preferences.schema.js';

export interface WidgetCatalogItem {
  clave: string;
  etiqueta: string;
  modulo: string;
  porDefecto: boolean;
}

function widgetsDe(modulos: ModuloRubroListado[], soloActivos: boolean): WidgetCatalogItem[] {
  return modulos.flatMap((modulo) => {
    if (soloActivos && modulo.estado !== 'prendido') return [];
    return modulo.superficies.map((superficie) => ({
      clave: superficie,
      etiqueta: modulo.nombre,
      modulo: modulo.clave,
      porDefecto: modulo.porDefecto,
    }));
  });
}

/** Preferencias de interfaz del usuario, validadas contra el paquete de su empresa. */
export class UserPreferencesService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async modulos(userId: string): Promise<ModuloRubroListado[]> {
    // Compatibilidad hasta #401: el modelo vigente todavía representa al dueño
    // con Company.userId. La primera empresa activa es determinista y coincide
    // con el contexto único que hoy consume el home.
    const company = await this.db.company.findFirst({
      where: { userId, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!company) throw new NotFoundError('No hay una empresa activa para resolver los accesos rápidos');
    return new ModulosRubroService(this.db).listar(userId, company.id);
  }

  async catalogo(userId: string): Promise<WidgetCatalogItem[]> {
    return widgetsDe(await this.modulos(userId), true);
  }

  async get(userId: string): Promise<UserPreferences> {
    const [row, catalogo] = await Promise.all([
      this.db.userPreference.findUnique({ where: { userId } }),
      this.catalogo(userId),
    ]);
    if (!row) {
      return { home: { accesosRapidos: catalogo.filter((widget) => widget.porDefecto).map((widget) => widget.clave) } };
    }
    return userPreferencesSchema.parse(row.preferences);
  }

  async save(userId: string, preferences: UserPreferences, ctx: AuditContext): Promise<UserPreferences> {
    const modulos = await this.modulos(userId);
    const todos = new Map(widgetsDe(modulos, false).map((widget) => [widget.clave, widget]));
    const activos = new Set(widgetsDe(modulos, true).map((widget) => widget.clave));
    for (const clave of preferences.home.accesosRapidos) {
      if (!todos.has(clave)) {
        throw new UnprocessableEntityError(`El acceso rápido "${clave}" no existe en el catálogo.`, { field: 'home.accesosRapidos', clave });
      }
      if (!activos.has(clave)) {
        throw new UnprocessableEntityError(`El acceso rápido "${clave}" pertenece a un módulo apagado.`, { field: 'home.accesosRapidos', clave });
      }
    }

    return withTenant(userId, async (tx) => {
      const anterior = await tx.userPreference.findUnique({ where: { userId } });
      await tx.userPreference.upsert({
        where: { userId },
        create: { userId, preferences },
        update: { preferences },
      });
      await recordAudit({
        ...ctx,
        userId,
        action: 'user.preferences.update',
        entityType: 'UserPreference',
        entityId: userId,
        oldValue: anterior?.preferences,
        newValue: preferences,
      }, tx);
      return preferences;
    });
  }
}
