import { describe, it, expect } from 'vitest';
import { runLayer4 } from '@/infrastructure/classifier/layers/layer4-business-routing.js';

describe('runLayer4', () => {
  it('routes LIQUIDACION_MOD to MANO_DE_OBRA at 99', () => {
    const result = runLayer4('LIQUIDACION_MOD', '');
    expect(result.costSection).toBe('MANO_DE_OBRA');
    expect(result.confidence).toBe(99);
    expect(result.requiresAI).toBe(false);
  });

  it('routes PLANILLA_HORAS to MANO_DE_OBRA at 99', () => {
    const result = runLayer4('PLANILLA_HORAS', '');
    expect(result.costSection).toBe('MANO_DE_OBRA');
    expect(result.confidence).toBe(99);
  });

  describe('nota de débito/crédito routing (inherits the corrected document\'s section)', () => {
    // (a) Nota de crédito sobre una VENTA (devolución de cliente) → VENTAS.
    it('routes a credit note on a sale (customer return) to VENTAS', () => {
      const result = runLayer4(
        'NOTA_CREDITO',
        'Nota de crédito por devolución de mercadería vendida — el cliente devolvió 10 unidades',
      );
      expect(result.costSection).toBe('VENTAS');
      expect(result.requiresAI).toBe(false);
    });

    it('routes a credit note with explicit "venta a cliente" context to VENTAS', () => {
      const result = runLayer4('NOTA_CREDITO', 'Nota de crédito A - ajuste por venta a cliente ACME SA');
      expect(result.costSection).toBe('VENTAS');
    });

    // (b) Nota sobre una COMPRA con señales de MP → MATERIA_PRIMA.
    it('routes a debit note on a purchase with MP signals to MATERIA_PRIMA', () => {
      const result = runLayer4('NOTA_DEBITO', 'Nota de débito por bobina de acero kg materia prima adicional');
      expect(result.costSection).toBe('MATERIA_PRIMA');
      expect(result.requiresAI).toBe(false);
    });

    // (c) Nota sobre una COMPRA con señales de CIP → COSTOS_INDIRECTOS,
    //     incluyendo el override incondicional (fuerza motriz).
    it('routes a note on a purchase with CIP signals to COSTOS_INDIRECTOS', () => {
      const result = runLayer4('NOTA_DEBITO', 'Nota de débito por alquiler mensual del galpón y electricidad');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });

    it('applies the unconditional CIP override to notes (fuerza motriz)', () => {
      const result = runLayer4('NOTA_CREDITO', 'Nota de crédito: fuerza motriz comprada para el molino');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });

    // (d) Nota sobre una COMPRA con señales de GASTO → subtipo GASTO_* correcto.
    it('routes a note on a purchase with GASTO signals to the right GASTO subtype', () => {
      const result = runLayer4('NOTA_DEBITO', 'Nota de débito por campaña publicitaria y comisiones de venta', 'TEXTIL');
      expect(result.costSection).toBe('GASTO_COMERCIALIZACION');
      expect(result.requiresAI).toBe(false);
    });

    // (e) Nota genuinamente ambigua (sin señal venta/compra ni MP/CIP/GASTO) →
    //     requiresAI, no se auto-clasifica.
    it('escalates a genuinely ambiguous note to requiresAI instead of guessing', () => {
      const result = runLayer4('NOTA_CREDITO', 'Nota de crédito por ajuste varios sin detalle');
      expect(result.requiresAI).toBe(true);
      expect(result.costSection).not.toBe('COSTOS_INDIRECTOS');
    });
  });

  it('routes FACTURA_COMPRA with MP keywords to MATERIA_PRIMA', () => {
    const result = runLayer4('FACTURA_COMPRA', 'Insumo bobina de acero kg materia prima');
    expect(result.costSection).toBe('MATERIA_PRIMA');
    expect(result.requiresAI).toBe(false);
  });

  it('routes FACTURA_COMPRA with CIP keywords to COSTOS_INDIRECTOS', () => {
    const result = runLayer4('FACTURA_COMPRA', 'Alquiler mensual del galpón - Servicio de electricidad');
    expect(result.costSection).toBe('COSTOS_INDIRECTOS');
    expect(result.requiresAI).toBe(false);
  });

  it('marks FACTURA_COMPRA without keywords as requiresAI', () => {
    const result = runLayer4('FACTURA_COMPRA', 'Proveedor desconocido sin descripción clara');
    expect(result.requiresAI).toBe(true);
  });

  it('routes FACTURA_VENTA to VENTAS at 99', () => {
    const result = runLayer4('FACTURA_VENTA', '');
    expect(result.costSection).toBe('VENTAS');
    expect(result.confidence).toBe(99);
  });

  it('routes DESCONOCIDO to DESCONOCIDO and requiresAI', () => {
    const result = runLayer4('DESCONOCIDO', '');
    expect(result.costSection).toBe('DESCONOCIDO');
    expect(result.requiresAI).toBe(true);
  });

  // ── Gastos (no-costo) transversales ────────────────────────────────────────
  describe('gasto routing', () => {
    it('routes a strong comercialización match to GASTO_COMERCIALIZACION (no AI)', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Factura por publicidad y campaña publicitaria en redes sociales',
      );
      expect(result.costSection).toBe('GASTO_COMERCIALIZACION');
      expect(result.requiresAI).toBe(false);
    });

    it('routes a strong administración match to GASTO_ADMINISTRACION (no AI)', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Honorarios contador y papelería oficina del mes',
      );
      expect(result.costSection).toBe('GASTO_ADMINISTRACION');
      expect(result.requiresAI).toBe(false);
    });

    it('routes a strong financiero match to GASTO_FINANCIERO (no AI)', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Resumen: gastos bancarios y comisión bancaria del período',
      );
      expect(result.costSection).toBe('GASTO_FINANCIERO');
      expect(result.requiresAI).toBe(false);
    });

    it('escalates to AI when MP and gasto signals are tied (ambiguous)', () => {
      // TEXTIL: 1 MP (tela) vs 1 gasto (campaña publicitaria) → ambiguo costo/gasto
      const result = runLayer4('FACTURA_COMPRA', 'compra de tela y campaña publicitaria', 'TEXTIL');
      expect(result.requiresAI).toBe(true);
      expect(result.costSection).toBe('DESCONOCIDO');
    });

    it('does not misfire on a pure CIP invoice (no gasto keywords)', () => {
      const result = runLayer4('FACTURA_COMPRA', 'Alquiler mensual del galpón - Servicio de electricidad');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });
  });

  // ── Conceptos "siempre variables" → CIP incondicional (cátedra) ────────────
  // Materiales indirectos, fuerza motriz comprada, reproceso y energía de
  // máquinas son SIEMPRE Costos Indirectos de Producción, sin la excepción de
  // contexto-de-compra-de-MP que tienen flete/seguro.
  describe('always-variable CIP keywords (indirect materials, motive power, rework, machine energy)', () => {
    it('routes an "fuerza motriz comprada" invoice to COSTOS_INDIRECTOS', () => {
      const result = runLayer4('FACTURA_COMPRA', 'Factura de compra: fuerza motriz comprada para el molino');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });

    it('routes a bare "fuerza motriz" invoice to COSTOS_INDIRECTOS', () => {
      const result = runLayer4('FACTURA_COMPRA', 'Provisión de fuerza motriz del período');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });

    it('routes an "energía de máquinas" invoice to COSTOS_INDIRECTOS', () => {
      const result = runLayer4('FACTURA_COMPRA', 'Factura por energía de máquinas de la línea de producción');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });

    it('routes an "energía eléctrica de planta" invoice to COSTOS_INDIRECTOS', () => {
      const result = runLayer4('FACTURA_COMPRA', 'Consumo: energía eléctrica de planta del mes');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });

    it.each(['reproceso', 'costos de reproceso', 'costo de reproceso', 'retrabajo'])(
      'routes a "%s" invoice to COSTOS_INDIRECTOS',
      (term) => {
        const result = runLayer4('FACTURA_COMPRA', `Factura de servicio: ${term} de unidades defectuosas`);
        expect(result.costSection).toBe('COSTOS_INDIRECTOS');
        expect(result.requiresAI).toBe(false);
      },
    );

    // Aislado: aunque "materiales indirectos" arrastre el substring 'material'
    // (mpKeyword de DEFAULT), el HARD-OVERRIDE lo manda a CIP igual.
    it('routes a bare "materiales indirectos" invoice to COSTOS_INDIRECTOS', () => {
      const result = runLayer4('FACTURA_COMPRA', 'Factura de compra: materiales indirectos de fabricación');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });

    // HARD-OVERRIDE: una factura MAYORMENTE de MP (chapa, kg, bobina) que también
    // menciona "materiales indirectos" ya NO se rutea a MP → gana CIP sí o sí.
    it('hard-overrides an MP-dominant invoice to CIP when "materiales indirectos" appears', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Factura: 2000 kg de chapa de acero y bobina (materia prima) + materiales indirectos de fabricación',
      );
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
      expect(result.reasoning).toMatch(/siempre variable/i);
    });

    // El override también aplica a fuerza motriz / reproceso sobre una compra de MP,
    // y NO pasa por el rescate de adquisición (flete/seguro).
    it('hard-overrides an MP purchase to CIP when motive power / rework appears', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Compra de chapa de acero (materia prima) con fuerza motriz comprada y reproceso de piezas',
      );
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
      expect(result.reasoning).not.toMatch(/flete\/seguro/i);
    });
  });

  // ── Flete/seguro inherentes a la compra de MP (costo de adquisición) ───────
  describe('freight/insurance on a raw-material purchase (acquisition cost)', () => {
    // (a) Compra de MP con flete/seguro en la MISMA factura → se mantiene en
    //     MATERIA_PRIMA; el flete NO se desvía a Costos Indirectos.
    it('keeps an MP purchase invoice with a freight/insurance line in MATERIA_PRIMA', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Factura de compra: bobina de acero 500 kg (materia prima) + flete y seguro de transporte',
      );
      expect(result.costSection).toBe('MATERIA_PRIMA');
      expect(result.requiresAI).toBe(false);
      expect(result.reasoning).toMatch(/flete\/seguro/i);
    });

    it('bundles freight into MP for a TEXTIL fabric purchase', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Compra de tela y hilo para producción, incluye flete del proveedor',
        'TEXTIL',
      );
      expect(result.costSection).toBe('MATERIA_PRIMA');
      expect(result.requiresAI).toBe(false);
    });

    // (b) Flete/seguro SUELTO, sin compra de MP → sigue ruteando a CIP (sin regresión).
    it('routes a standalone freight/logistics invoice (no MP context) to COSTOS_INDIRECTOS', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Factura de flete y logística: servicio de transporte y acarreo de la planta',
      );
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });

    it('keeps a machinery-insurance invoice (no MP purchase) in COSTOS_INDIRECTOS', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Póliza de seguro de maquinaria y mantenimiento de equipos de planta',
      );
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
      expect(result.requiresAI).toBe(false);
    });

    // (c) MP + flete + otros CIP fuertes → genuinamente ambiguo → escala a IA
    //     con MATERIA_PRIMA como prior.
    it('escalates to AI when MP + freight compete with other strong CIP signals', () => {
      const result = runLayer4(
        'FACTURA_COMPRA',
        'Compra: chapa de acero (materia prima) con flete, más alquiler del galpón y servicio de electricidad',
      );
      expect(result.requiresAI).toBe(true);
      expect(result.costSection).toBe('DESCONOCIDO');
      expect(result.suggestedSection).toBe('MATERIA_PRIMA');
    });
  });

  // ── MOD vs mano de obra indirecta (MOI) en liquidaciones ───────────────────
  describe('payroll role routing (MOD vs indirect labor)', () => {
    // (a) Puesto directo de producción → MOD auto-clasificado como hoy.
    it.each(['jornalero', 'operario', 'operador de máquina', 'peón de producción', 'obrero'])(
      'routes a direct-labor role (%s) to MANO_DE_OBRA at 99, no AI',
      (role) => {
        const result = runLayer4('LIQUIDACION_MOD', '', 'DEFAULT', role);
        expect(result.costSection).toBe('MANO_DE_OBRA');
        expect(result.confidence).toBe(99);
        expect(result.requiresAI).toBe(false);
      },
    );

    // (b) Mano de obra indirecta de producción → requiresAI con CIP sugerido.
    it.each([
      'capataz', 'supervisor', 'encargado', 'limpieza', 'vigilancia',
      'mantenimiento', 'sereno', 'gerente de producción', 'jefe de planta',
    ])('escalates an indirect-labor role (%s) with COSTOS_INDIRECTOS as suggestion', (role) => {
      const result = runLayer4('LIQUIDACION_MOD', '', 'DEFAULT', role);
      expect(result.requiresAI).toBe(true);
      expect(result.suggestedSection).toBe('COSTOS_INDIRECTOS');
      expect(result.costSection).toBe('COSTOS_INDIRECTOS');
    });

    // (c) Administrativo / conducción general → requiresAI con GASTO_ADMINISTRACION.
    it.each([
      'administrativo', 'personal administrativo', 'gerente general',
      'gerente de administración', 'gerente comercial', 'recepcionista', 'gerente',
    ])('escalates an admin role (%s) with GASTO_ADMINISTRACION as suggestion', (role) => {
      const result = runLayer4('PLANILLA_HORAS', '', 'DEFAULT', role);
      expect(result.requiresAI).toBe(true);
      expect(result.suggestedSection).toBe('GASTO_ADMINISTRACION');
      expect(result.costSection).toBe('GASTO_ADMINISTRACION');
    });

    it('routes "gerente de producción" to CIP, not admin (production qualifier wins)', () => {
      const result = runLayer4('LIQUIDACION_MOD', '', 'DEFAULT', 'Gerente de Producción');
      expect(result.suggestedSection).toBe('COSTOS_INDIRECTOS');
    });

    // (d) Sin puesto extraído → cae al default MOD actual.
    // LIMITACIÓN CONOCIDA: sin señal de rol no se puede distinguir MOD de MOI;
    // se mantiene el comportamiento histórico (MOD) y se documenta en el reasoning.
    it('falls back to MANO_DE_OBRA when no role is available (known limitation)', () => {
      const result = runLayer4('LIQUIDACION_MOD', '', 'DEFAULT', null);
      expect(result.costSection).toBe('MANO_DE_OBRA');
      expect(result.confidence).toBe(99);
      expect(result.requiresAI).toBe(false);
      expect(result.reasoning).toMatch(/LIMITACIÓN CONOCIDA/);
    });

    it('keeps MOD default for an unrecognized role (does not contradict direct labor)', () => {
      const result = runLayer4('LIQUIDACION_MOD', '', 'DEFAULT', 'coordinador de logística externa');
      expect(result.costSection).toBe('MANO_DE_OBRA');
      expect(result.requiresAI).toBe(false);
    });

    // Fallback por texto: el enrichedText trae "Puesto/Cargo: X".
    it('reads the role from a labeled "Puesto/Cargo:" line in the text', () => {
      const result = runLayer4('LIQUIDACION_MOD', 'Recibo de sueldo\nPuesto/Cargo: capataz\nSeguridad Social');
      expect(result.requiresAI).toBe(true);
      expect(result.suggestedSection).toBe('COSTOS_INDIRECTOS');
    });

    // Recibo argentino típico: el puesto va en la línea del empleado.
    it('reads an indirect role from the "Empleado:" line of a recibo', () => {
      const result = runLayer4(
        'LIQUIDACION_MOD',
        'RECIBO DE SUELDO\nEmpleado: capataz de planta (supervisión)\nSUELDO BÁSICO\nANSES',
      );
      expect(result.requiresAI).toBe(true);
      expect(result.suggestedSection).toBe('COSTOS_INDIRECTOS');
    });

    it('keeps a direct-labor "Empleado:" line as MOD', () => {
      const result = runLayer4(
        'LIQUIDACION_MOD',
        'RECIBO DE SUELDO\nEmpleado: Juan Pérez — operario de planta\nSUELDO BÁSICO',
      );
      expect(result.costSection).toBe('MANO_DE_OBRA');
      expect(result.requiresAI).toBe(false);
    });

    // No debe romper con el cuerpo ruidoso de un recibo (Seguridad Social, etc.)
    // cuando el puesto SÍ es directo.
    it('does not misroute a jornalero payroll that mentions "Seguridad Social"', () => {
      const result = runLayer4(
        'LIQUIDACION_MOD',
        'Recibo\nAportes Seguridad Social\nObra Social\nContribución mantenimiento',
        'DEFAULT',
        'jornalero',
      );
      expect(result.costSection).toBe('MANO_DE_OBRA');
      expect(result.requiresAI).toBe(false);
    });
  });
});
