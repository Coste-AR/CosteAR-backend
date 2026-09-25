import { describe, expect, it } from 'vitest';
import {
  CATEGORIA_CONSTRUCCION_MODULAR,
  PAQUETE_CONSTRUCCION_MODULAR,
} from '@/application/operacion/paquete-construccion-modular.js';

describe('paquete de construcción modular', () => {
  it('declara los permisos mínimos de órdenes, inventario y horas', () => {
    expect(PAQUETE_CONSTRUCCION_MODULAR.access.permissions).toEqual([
      'ordenes.ver', 'ordenes.editar', 'ordenes.ver_margen', 'ordenes.aprobar_presupuesto',
      'ordenes.cerrar', 'inventario.mover', 'horas.cargar', 'horas.aprobar',
    ]);
    expect(PAQUETE_CONSTRUCCION_MODULAR.access.entities).toEqual(['OrdenTrabajo', 'Deposito']);
  });

  it('camino de falla: un parámetro sin valor declarado queda ausente y sin confirmar', () => {
    const parametro = PAQUETE_CONSTRUCCION_MODULAR.seedParameters
      .find((item) => item.clave === 'umbral_desvio_margen_pp');

    expect(parametro).toEqual(expect.objectContaining({ confirmado: false }));
    expect(parametro).not.toHaveProperty('valor');
  });

  it('declara el léxico, los modelos y las etapas del rubro como datos configurables', () => {
    expect(CATEGORIA_CONSTRUCCION_MODULAR).toBe('CONSTRUCCION_MODULAR');
    expect(PAQUETE_CONSTRUCCION_MODULAR.lexicon).toMatchObject({
      OrdenTrabajo: 'Obra',
      EtapaOrden: 'Etapa',
      Deposito: 'Depósito',
      VersionPresupuesto: 'Adicional',
      PlantillaOrden: 'Modelo',
    });
    expect(PAQUETE_CONSTRUCCION_MODULAR.variants.map((modelo) => modelo.etiqueta)).toEqual([
      'Módulo de 20 pies', 'Módulo de 40 pies', 'Vivienda base', 'Oficina base',
    ]);
    expect(PAQUETE_CONSTRUCCION_MODULAR.variants.every((modelo) => !modelo.confirmado)).toBe(true);
    expect(PAQUETE_CONSTRUCCION_MODULAR.screens.etapasPorDefecto).toHaveLength(7);
    expect(PAQUETE_CONSTRUCCION_MODULAR.screens.etapasPorDefecto.filter((etapa) => etapa.entrega))
      .toHaveLength(2);
  });

  it('mantiene provisionales sin confirmar nombre, parámetros y KPI', () => {
    expect(PAQUETE_CONSTRUCCION_MODULAR.nombreProducto).toBe('Construcción Modular');
    expect(PAQUETE_CONSTRUCCION_MODULAR.nombreProductoConfirmado).toBe(false);
    expect(PAQUETE_CONSTRUCCION_MODULAR.seedParameters.every((parametro) => !parametro.confirmado))
      .toBe(true);
    expect(PAQUETE_CONSTRUCCION_MODULAR.screens.home.kpis.every((kpi) => !kpi.confirmado))
      .toBe(true);
    expect(PAQUETE_CONSTRUCCION_MODULAR.screens.indicadoresMacro).toEqual([]);
  });
});
