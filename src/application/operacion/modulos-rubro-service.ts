import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import { CATEGORY_BY_INDUSTRY } from './paquete-avicola.js';
import { PaqueteRubroService } from './paquete-rubro-service.js';

export interface ModuloRubro {
  clave: string;
  nombre: string;
  descripcion: string;
  parametros: string[];
  alertas: string[];
  dependeDe: string[];
  activoPorDefecto: boolean;
}

export interface ModuloRubroResuelto {
  clave: string;
  nombre: string;
  descripcion: string;
  estado: 'prendido' | 'apagado';
  porDefecto: boolean;
  dependeDe: string[];
  parametros: string[];
  alertas: string[];
}

function esModuloRubro(value: unknown): value is ModuloRubro {
  if (!value || typeof value !== 'object') return false;
  const modulo = value as Partial<ModuloRubro>;
  return typeof modulo.clave === 'string' && typeof modulo.nombre === 'string' &&
    typeof modulo.descripcion === 'string' && typeof modulo.activoPorDefecto === 'boolean' &&
    ['parametros', 'alertas', 'dependeDe']
      .every((campo) => Array.isArray(modulo[campo as keyof ModuloRubro]));
}

/** Configuración declarativa de módulos: la empresa guarda estado, el paquete contenido. */
export class ModulosRubroService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Empresa no encontrada');
    return company;
  }

  private async modulosDe(userId: string, companyId: string, industry: string | null): Promise<ModuloRubro[]> {
    const category = industry ? CATEGORY_BY_INDUSTRY[industry as keyof typeof CATEGORY_BY_INDUSTRY] : undefined;
    if (!category) return [];
    const paquete = await new PaqueteRubroService(this.db).resolve(userId, category, { companyId });
    const modulos = paquete.modulos;
    return Array.isArray(modulos) ? modulos.filter(esModuloRubro) : [];
  }

  async listar(userId: string, companyId: string): Promise<ModuloRubroResuelto[]> {
    const company = await this.companyDe(userId, companyId);
    const [modulos, configurados] = await Promise.all([
      this.modulosDe(userId, companyId, company.industry),
      this.db.configuracionModuloRubro.findMany({ where: { companyId } }),
    ]);
    const estados = new Map(configurados.map((configuracion) => [configuracion.moduleId, configuracion.activo]));
    return modulos.map((modulo) => {
      const activo = estados.get(modulo.clave) ?? modulo.activoPorDefecto;
      return {
        clave: modulo.clave,
        nombre: modulo.nombre,
        descripcion: modulo.descripcion,
        estado: activo ? 'prendido' : 'apagado',
        porDefecto: modulo.activoPorDefecto,
        dependeDe: modulo.dependeDe,
        parametros: modulo.parametros,
        alertas: modulo.alertas,
      };
    });
  }

  async set(userId: string, companyId: string, moduleId: string, activo: boolean, actor: TraceActor) {
    const company = await this.companyDe(userId, companyId);
    const modulos = await this.modulosDe(userId, companyId, company.industry);
    const modulo = modulos.find((item) => item.clave === moduleId);
    if (!modulo) throw new NotFoundError('Módulo de rubro no encontrado');
    const actuales = await this.listar(userId, companyId);
    if (!activo) {
      const dependiente = actuales.find((item) => item.estado === 'prendido' && item.dependeDe.includes(moduleId));
      if (dependiente) {
        throw new UnprocessableEntityError(`No podés apagar "${modulo.nombre}" porque "${dependiente.nombre}" depende de este módulo.`, { field: 'moduleId' });
      }
    }
    return withTenant(userId, async (tx) => {
      const anterior = await tx.configuracionModuloRubro.findUnique({ where: { companyId_moduleId: { companyId, moduleId } } });
      const guardado = await tx.configuracionModuloRubro.upsert({
        where: { companyId_moduleId: { companyId, moduleId } },
        create: { companyId, userId, moduleId, activo },
        update: { activo },
      });
      await recordTraceAudit({ entityType: 'ConfiguracionModuloRubro', entityId: guardado.id, action: anterior ? 'update' : 'create', actor, before: anterior ?? undefined, after: guardado, comment: `Módulo "${modulo.nombre}" ${activo ? 'prendido' : 'apagado'}.` }, tx);
      return {
        clave: modulo.clave,
        nombre: modulo.nombre,
        descripcion: modulo.descripcion,
        estado: guardado.activo ? 'prendido' : 'apagado',
        porDefecto: modulo.activoPorDefecto,
        dependeDe: modulo.dependeDe,
        parametros: modulo.parametros,
        alertas: modulo.alertas,
      } satisfies ModuloRubroResuelto;
    });
  }
}
