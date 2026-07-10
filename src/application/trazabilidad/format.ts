/** Formato es-AR (punto de miles, coma decimal) para los `display` de la ficha de trazabilidad. */
export function fmtNumber(value: number, maxDecimals = 2): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

export function fmtMoney(value: number): string {
  return `$ ${fmtNumber(value, 2)}`;
}
