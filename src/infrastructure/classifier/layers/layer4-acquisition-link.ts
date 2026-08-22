// src/infrastructure/classifier/layers/layer4-acquisition-link.ts
import type { AcquisitionCostLink } from '../types.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FLETE FACTURADO APARTE QUE DECLARA SER SOBRE UNA COMPRA (CL-06)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * QUÉ PROBLEMA RESUELVE
 * ---------------------
 * R-ADQUISICION (Clase 4, ll. 15-18): *"Costo de nacionalización + flete
 * carretero hasta destino (ej. Tucumán) = costo de adquisición total"*. El flete
 * SOBRE LA COMPRA de un material integra el costo de ese material; el flete
 * DENTRO de la planta es CIP. Misma palabra, dos destinos.
 *
 * Hasta acá la regla solo se aplicaba cuando la línea de flete estaba en la
 * MISMA factura que la materia prima (ver el bloque de `freightInsuranceMatched`
 * en layer4-invoice-routing.ts). El transportista, sin embargo, factura aparte:
 * el documento FLE-02 del corpus —"Flete por la compra de 38 toneladas de maíz -
 * Factura 0003-00001902"— iba a COSTOS_INDIRECTOS con confianza 97, porque
 * 'flete' es una UNIVERSAL_CIP_KEYWORD y nada leía la referencia a la compra.
 *
 * QUÉ DECIDE ESTE MÓDULO Y QUÉ NO
 * -------------------------------
 * Decide (determinista, sin IA): que el documento **declara por escrito** ser un
 * flete/seguro/acarreo sobre una compra, y con qué número de comprobante la
 * referencia. Eso alcanza para la SECCIÓN, porque la sección sale del texto del
 * propio comprobante y de nada más.
 *
 * NO decide a qué asiento concreto se acumula ese importe: eso exige buscar el
 * comprobante referenciado en el libro de la empresa, que es una consulta a la
 * base scopeada por costista/empresa. El clasificador es puro sobre el texto —
 * por eso acá se DETECTA y se MARCA (`AcquisitionCostLink` viaja en el
 * `ClassificationResult`), y la resolución del vínculo es de la capa de
 * aplicación. El contrato está escrito en `AcquisitionCostLink` (types.ts).
 *
 * POR QUÉ EL DISPARADOR ES TAN ESTRECHO
 * -------------------------------------
 * Exige que la palabra de flete y la declaración de compra estén JUNTAS, en ese
 * orden y en el mismo renglón. No alcanza con que el documento diga "flete" y en
 * algún lado diga "compra": "Factura de compra: bobina de acero + flete y seguro
 * de transporte" es una compra de MP con flete adentro —el caso que ya resuelve
 * el bloque de la misma factura— y "Factura de flete y logística: acarreo de la
 * planta" es el flete de planta que DEBE seguir yendo a CIP (FLE-01, guarda de
 * regresión). Un disparador laxo se los come a los dos.
 *
 * LÍMITE CONOCIDO, DECLARADO: solo se lee el orden natural "flete … por la
 * compra …". Un comprobante redactado al revés ("Compra de maíz s/ factura
 * 0003-00001902 — flete carretero") no dispara y cae por el camino viejo. Se
 * prefiere no detectarlo a inventar un vínculo que el papel no declara.
 */

/**
 * Flete/seguro/acarreo seguido, en el mismo renglón, de una declaración de que
 * es SOBRE UNA COMPRA.
 *
 * - `[^.\n]{0,60}?` es la ventana: mismo renglón, misma oración, corta.
 * - El seguro entra porque la cátedra lo nombra junto al flete en la misma línea
 *   del costo de adquisición.
 * - `s/` es la abreviatura de "sobre" que usan los transportistas argentinos.
 */
const FLETE_SOBRE_COMPRA_RE =
  /\b(?:fletes?|acarreos?|seguros?|transportes?|despachante)\b[^.\n]{0,60}?(?:\b(?:por|sobre|seg[úu]n|correspondiente\s+a|corresponde\s+a|de|contra)\s+|\bs\/\s*)(?:la\s+|el\s+|una\s+|nuestra\s+|su\s+)?(?:compras?|factura\s+de\s+compra|orden\s+de\s+compra)\b/i;

/**
 * Contrapeso. El flete de ENTREGA a un cliente no es costo de adquisición de
 * nada: es un gasto de comercialización. Si el documento habla de una venta, se
 * devuelve null y el ruteo sigue por el camino de siempre — es preferible a
 * activar contra una materia prima el reparto de un pedido vendido.
 */
const CONTEXTO_VENTA_RE =
  /\bpor\s+(?:la\s+)?venta\b|\bfactura\s+de\s+venta\b|\bnota\s+de\s+venta\b|\bal?\s+cliente\b|\bentregas?\s+a\s+clientes?\b|\bdespacho\s+a\s+clientes?\b|\breparto\s+a\s+clientes?\b/i;

/**
 * Número de comprobante argentino (punto de venta + número) citado detrás de una
 * palabra que lo anuncia.
 *
 * La palabra que lo anuncia NO es decorativa: sin ella, `30-66889900-3` (un CUIT)
 * y cualquier fecha o importe con guion serían candidatos. Con ella, el único
 * número que se lee es el que el comprobante presenta como comprobante.
 */
const NUMERO_COMPROBANTE_RE =
  /\b(?:facturas?|fact\.?|fc\.?|comprobantes?|remitos?|orden\s+de\s+compra|o\/c)\s*(?:[abcme]\b\s*)?(?:n[°ºo]?\.?\s*|nro\.?\s*)?(\d{3,5})\s*-\s*(\d{4,8})\b/i;

/** Normaliza a la forma canónica PPPP-NNNNNNNN, que es como se cita en Argentina. */
function normalizarComprobante(puntoVenta: string, numero: string): string {
  return `${puntoVenta.padStart(4, '0')}-${numero.padStart(8, '0')}`;
}

/**
 * Devuelve el vínculo declarado por el documento, o null si no declara ninguno.
 *
 * Es una función PURA sobre el texto: no consulta la base ni la IA. Que el
 * comprobante referenciado exista o no en el sistema es indiferente acá — y esa
 * indiferencia es deliberada, ver `AcquisitionCostLink` en types.ts.
 */
export function detectAcquisitionCostLink(text: string): AcquisitionCostLink | null {
  const declaracion = FLETE_SOBRE_COMPRA_RE.exec(text);
  if (!declaracion) return null;
  if (CONTEXTO_VENTA_RE.test(text)) return null;

  const ref = NUMERO_COMPROBANTE_RE.exec(text);
  const [, puntoVenta, numero] = ref ?? [];

  return {
    referencedComprobante: puntoVenta && numero
      ? normalizarComprobante(puntoVenta, numero)
      : null,
    declaredBy: declaracion[0].replace(/\s+/g, ' ').trim(),
  };
}
