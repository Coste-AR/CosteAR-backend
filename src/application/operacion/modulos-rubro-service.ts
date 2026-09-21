import type { PrismaClient } from '@prisma/client';
import { prisma, withTenant } from '../../infrastructure/database/prisma.js';
import { recordTraceAudit, type TraceActor } from '../audit/trace-audit.js';
import { NotFoundError, UnprocessableEntityError } from '../../domain/errors/domain-error.js';
import {
  CATEGORY_BY_INDUSTRY,
  CATEGORIA_AVICOLA_POSTURA,
  PAQUETE_AVICOLA_POSTURA,
} from './paquete-avicola.js';
import { PaqueteRubroService } from './paquete-rubro-service.js';

export interface ModuloRubro {
  clave: string;
  nombre: string;
  descripcion: string;
  superficies?: string[];
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

interface OpcionParametro { valor: string; etiqueta: string }
interface ParametroPaquete {
  clave: string;
  descripcion: string;
  opciones?: OpcionParametro[];
}

export interface ModuloRubroListado extends Omit<ModuloRubroResuelto, 'parametros'> {
  superficies: string[];
  parametros: Array<ParametroPaquete>;
}

function esModuloRubro(value: unknown): value is ModuloRubro {
  if (!value || typeof value !== 'object') return false;
  const modulo = value as Partial<ModuloRubro>;
  return typeof modulo.clave === 'string' && typeof modulo.nombre === 'string' &&
    typeof modulo.descripcion === 'string' && typeof modulo.activoPorDefecto === 'boolean' &&
    ['parametros', 'alertas', 'dependeDe']
      .every((campo) => Array.isArray(modulo[campo as keyof ModuloRubro]));
}

function esParametroPaquete(value: unknown): value is ParametroPaquete {
  if (!value || typeof value !== 'object') return false;
  const parametro = value as Partial<ParametroPaquete>;
  return typeof parametro.clave === 'string' && typeof parametro.descripcion === 'string' &&
    (parametro.opciones === undefined || parametro.opciones.every((opcion) =>
      typeof opcion?.valor === 'string' && typeof opcion?.etiqueta === 'string'));
}

/** Configuración declarativa de módulos: la empresa guarda estado, el paquete contenido. */
export class ModulosRubroService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async companyDe(userId: string, companyId: string) {
    const company = await this.db.company.findFirst({ where: { id: companyId, userId } });
    if (!company) throw new NotFoundError('Empresa no encontrada');
    return company;
  }

  private async contenidoDe(userId: string, companyId: string, industry: string | null) {
    const category = industry ? CATEGORY_BY_INDUSTRY[industry as keyof typeof CATEGORY_BY_INDUSTRY] : undefined;
    if (!category) return { modulos: [] as ModuloRubro[], parametros: [] as ParametroPaquete[] };
    const paquete = await new PaqueteRubroService(this.db).resolve(userId, category, { companyId });
    const superficiesBase = category === CATEGORIA_AVICOLA_POSTURA
      ? new Map(PAQUETE_AVICOLA_POSTURA.modulos.map((modulo) => [modulo.clave, [...modulo.superficies]]))
      : new Map<string, string[]>();
    const modulos = Array.isArray(paquete.modulos) ? paquete.modulos.filter(esModuloRubro) : [];
    return {
      // Compatibilidad con filas sembradas antes de #384: el paquete canónico
      // completa sólo el campo nuevo, sin reescribir el JSON persistido ni los
      // estados que cada empresa guarda por separado.
      modulos: modulos.map((modulo) => ({
        ...modulo,
        superficies: modulo.superficies ?? superficiesBase.get(modulo.clave) ?? [],
      })),
      parametros: Array.isArray(paquete.seedParameters) ? paquete.seedParameters.filter(esParametroPaquete) : [],
    };
  }

  async listar(userId: string, companyId: string): Promise<ModuloRubroListado[]> {
    const company = await this.companyDe(userId, companyId);
    const [contenido, configurados] = await Promise.all([
      this.contenidoDe(userId, companyId, company.industry),
      this.db.configuracionModuloRubro.findMany({ where: { companyId } }),
    ]);
    const { modulos, parametros } = contenido;
    const catalogo = new Map(parametros.map((parametro) => [parametro.clave, parametro]));
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
        superficies: modulo.superficies ?? [],
        parametros: modulo.parametros.flatMap((clave) => {
          const parametro = catalogo.get(clave);
          return parametro ? [parametro] : [];
        }),
        alertas: modulo.alertas,
      };
    });
  }

  async set(userId: string, companyId: string, moduleId: string, activo: boolean, actor: TraceActor) {
    const company = await this.companyDe(userId, companyId);
    const { modulos } = await this.contenidoDe(userId, companyId, company.industry);
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
