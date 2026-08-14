/**
 * LA SEÑAL FISCAL DE LA IA YA NO SE PIERDE
 * ========================================
 *
 * El prompt de Groq le pide a la IA que marque en `qualityNote` los indicios de
 * que la empresa no es Responsable Inscripto ("Factura C", "Consumidor Final",
 * "Monotributista", "Responsable No Inscripto"). La IA cumplía; el sistema
 * tiraba la cadena a la basura. Este test cubre el módulo que la convierte en
 * un dato accionable.
 *
 * Las dos mitades importan igual: que DETECTE lo que tiene que detectar, y que
 * NO marque lo que no corresponde. Una bandera que se levanta de más se vuelve
 * ruido, el costista la ignora, y el día que importa tampoco la mira.
 */
import { describe, it, expect } from 'vitest';
import {
  detectarSenalCondicionIva,
  contradiceLaCondicionDeclarada,
  notaDeRevision,
} from '../../src/application/validaciones/condicion-iva-signal.js';

function nota(qualityNote: string | null): string {
  return JSON.stringify({ documentType: 'factura_compra', quality: 'legible', qualityNote });
}

describe('detección de la condición fiscal en la nota de calidad de la IA', () => {
  const CASOS: { texto: string; indicio: string; sugerida: string }[] = [
    { texto: 'El comprobante es una Factura C, revisar condición frente al IVA.', indicio: 'Factura C', sugerida: 'MONOTRIBUTO' },
    { texto: 'Figura "Consumidor Final" como condición del receptor.', indicio: 'Consumidor Final', sugerida: 'MONOTRIBUTO' },
    { texto: 'El proveedor es Monotributista, no discrimina IVA.', indicio: 'Monotributista', sugerida: 'MONOTRIBUTO' },
    { texto: 'Aparece la leyenda Responsable No Inscripto.', indicio: 'Responsable No Inscripto', sugerida: 'EXENTO' },
    { texto: 'La empresa figura como IVA Exento en el encabezado.', indicio: 'Exento', sugerida: 'EXENTO' },
    { texto: 'MONOTRIBUTO — no corresponde crédito fiscal.', indicio: 'Monotributista', sugerida: 'MONOTRIBUTO' },
  ];

  for (const caso of CASOS) {
    it(`detecta "${caso.indicio}" en: ${caso.texto.slice(0, 45)}…`, () => {
      const senal = detectarSenalCondicionIva({ aiReviewNote: nota(caso.texto) });
      expect(senal).not.toBeNull();
      expect(senal!.indicio).toBe(caso.indicio);
      expect(senal!.sugerida).toBe(caso.sugerida);
      expect(senal!.origen).toBe('qualityNote');
    });
  }

  it('si la IA no dijo nada, mira el texto crudo del comprobante', () => {
    const senal = detectarSenalCondicionIva({
      aiReviewNote: nota(null),
      rawContent: 'FACTURA C  Nro 0001-00000123 — Total $ 250.000',
    });
    expect(senal).toEqual({ sugerida: 'MONOTRIBUTO', indicio: 'Factura C', origen: 'documento' });
  });

  it('la nota de calidad gana sobre el texto crudo', () => {
    const senal = detectarSenalCondicionIva({
      aiReviewNote: nota('El emisor es Monotributista.'),
      rawContent: 'FACTURA C',
    });
    expect(senal!.origen).toBe('qualityNote');
    expect(senal!.indicio).toBe('Monotributista');
  });
});

describe('lo que NO tiene que marcar', () => {
  it('una nota de calidad sin nada fiscal', () => {
    expect(detectarSenalCondicionIva({ aiReviewNote: nota('La imagen está algo borrosa en el margen inferior.') })).toBeNull();
  });

  it('sin análisis, con análisis roto, o con qualityNote en null', () => {
    expect(detectarSenalCondicionIva({ aiReviewNote: null })).toBeNull();
    expect(detectarSenalCondicionIva({ aiReviewNote: 'esto no es json {' })).toBeNull();
    expect(detectarSenalCondicionIva({ aiReviewNote: nota(null) })).toBeNull();
    expect(detectarSenalCondicionIva({ aiReviewNote: nota('   ') })).toBeNull();
  });

  it('un comprobante de un RI que además menciona un ítem exento NO levanta bandera', () => {
    // Falso positivo clásico: "Responsable Inscripto" declarado y la palabra
    // "exento" suelta en un renglón. La condición del emisor manda.
    const senal = detectarSenalCondicionIva({
      aiReviewNote: nota('Emisor Responsable Inscripto; un renglón figura como exento de IVA.'),
    });
    expect(senal).toBeNull();
  });

  it('pero un RI declarado que igual dice "Factura C" SÍ levanta bandera', () => {
    // Ese indicio es demasiado fuerte para tragárselo: una Factura C no la
    // emite un Responsable Inscripto.
    const senal = detectarSenalCondicionIva({
      aiReviewNote: nota('Dice Responsable Inscripto pero el comprobante es una Factura C.'),
    });
    expect(senal!.indicio).toBe('Factura C');
  });
});

describe('cuándo contradice a la condición declarada', () => {
  it('indicio de Monotributo sobre una empresa declarada RI: contradice', () => {
    const senal = detectarSenalCondicionIva({ aiReviewNote: nota('Es Monotributista.') })!;
    expect(contradiceLaCondicionDeclarada(senal, 'RESPONSABLE_INSCRIPTO')).toBe(true);
  });

  it('indicio de Monotributo sobre una empresa ya declarada EXENTO: NO contradice', () => {
    // Las dos cuentan el IVA como costo: el importe del libro mayor es el
    // mismo. Marcarlo sería ruido.
    const senal = detectarSenalCondicionIva({ aiReviewNote: nota('Es Monotributista.') })!;
    expect(contradiceLaCondicionDeclarada(senal, 'EXENTO')).toBe(false);
    expect(contradiceLaCondicionDeclarada(senal, 'MONOTRIBUTO')).toBe(false);
  });
});

describe('la nota que ve el humano', () => {
  it('dice qué se detectó, dónde, qué está haciendo el sistema y qué hacer', () => {
    const senal = detectarSenalCondicionIva({ aiReviewNote: nota('El comprobante es una Factura C.') })!;
    const texto = notaDeRevision(senal, { documento: 'factura-julio.pdf' });

    expect(texto).toContain('Factura C');
    expect(texto).toContain('factura-julio.pdf');
    expect(texto).toContain('NETO');
    expect(texto).toContain('subvaluando');
    expect(texto).toContain('Clase 4');
  });
});
