export type ProductoParaMezcla = {
  id: string;
  producto: string;
  cm: number;
  consumoPorUnidad: number;
  demandaMaxima: number;
};

export function calcularMezclaOptima(input: {
  disponible: number;
  unidadRecurso: string;
  productos: ProductoParaMezcla[];
}) {
  let restante = input.disponible;
  let contribucionMarginalTotal = 0;
  const ranking = input.productos
    .filter((producto) => producto.cm > 0 && producto.consumoPorUnidad > 0 && producto.demandaMaxima > 0)
    .map((producto) => ({ ...producto, cme: producto.cm / producto.consumoPorUnidad }))
    .sort((a, b) => b.cme - a.cme || a.producto.localeCompare(b.producto))
    .map((producto) => {
      const cantidadAsignada = Math.min(producto.demandaMaxima, restante / producto.consumoPorUnidad);
      const recursoAsignado = cantidadAsignada * producto.consumoPorUnidad;
      restante = Math.max(0, restante - recursoAsignado);
      contribucionMarginalTotal += cantidadAsignada * producto.cm;
      return {
        productoId: producto.id,
        producto: producto.producto,
        cme: producto.cme,
        cm: producto.cm,
        consumoPorUnidad: producto.consumoPorUnidad,
        demandaMaxima: producto.demandaMaxima,
        cantidadAsignada,
        recursoAsignado,
        unidades: {
          cme: `moneda/${input.unidadRecurso}`,
          cm: 'moneda/unidad de producto',
          consumoPorUnidad: `${input.unidadRecurso}/unidad de producto`,
          demandaMaxima: 'unidades de producto',
          cantidadAsignada: 'unidades de producto',
          recursoAsignado: input.unidadRecurso,
        },
      };
    });

  return { ranking, contribucionMarginalTotal, recursoRestante: restante };
}
