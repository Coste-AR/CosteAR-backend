// PASO 3 — comportamiento del sistema cuando los períodos se mueven, sobre la
// serie FX-AV-B ya cargada y cerrada (M1..M4) por cargarFxAvB().
import { cargarFxAvB } from './paso2-fxavb-m1-m4.mjs';

const BASE_URL = 'http://127.0.0.1:3001/api/v1';
async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
function auth(token) { return { authorization: `Bearer ${token}` }; }
function log(label, res) { console.log(`  ${label} -> ${res.status}`); console.log('   ', JSON.stringify(res.body).slice(0, 600)); return res; }

async function main() {
  console.log('########## Cargando FX-AV-B (M1..M4, cerrados) ##########');
  const { token, structureId, planta, embolsado, periodos } = await cargarFxAvB();
  const [m1, m2, m3, m4] = periodos;

  console.log('\n\n########## PASO 3.A — ORDEN DE CIERRE ##########');
  console.log('Estado tras cargarFxAvB: M1..M4 los 4 CERRADOS en secuencia.');

  console.log('\n-- A1: reabrir M2 (ya cerrado) --');
  const reopenM2 = await request(`/periods/${m2.id}/reopen`, { method: 'POST', headers: auth(token), body: JSON.stringify({ reason: 'PASO 3.A/B — auditoría AUD-2026-09-15, prueba de orden de cierre' }) });
  log('POST reopen M2', reopenM2);

  console.log('\n-- A2: con M2 reabierto (M3 y M4 siguen CERRADOS, "en el medio" queda abierto), intentar abrir M5 --');
  const openM5 = await request(`/structures/${structureId}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) });
  log('POST /periods (intento M5 con M2 abierto)', openM5);
  console.log(`  Interpretación: ${openM5.status >= 200 && openM5.status < 300 ? 'DEJÓ ABRIR — el sistema NO protege el orden' : 'BLOQUEADO — no se puede avanzar la secuencia mientras CUALQUIER período (no solo el último) esté abierto'}`);

  console.log('\n-- A3: intentar volver a cerrar M3 (ya CERRADO) mientras M2 está abierto --');
  const recloseM3 = await request(`/periods/${m3.id}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  log('POST close M3 (ya cerrado)', recloseM3);

  console.log('\n\n########## PASO 3.B — REAPERTURA EN CASCADA ##########');
  console.log('M2 sigue abierto (de A1). Le cambio periodCostMp a Planta y recalculo.');

  const movAntes = await request(`/structures/${structureId}/process/departments/${planta.id}/periods/${m2.id}/movement`, { headers: auth(token) });
  console.log('  Planta M2 ANTES del cambio (saved.periodCostMp):', movAntes.body.data.saved.periodCostMp);

  const DELTA = 1000000;
  // Un PUT que solo manda el costo NO alcanza (dos intentos anteriores dieron 422,
  // "el cuadro no cuadra" — ver paso3-run1-B-y-C-incompletos.log): a diferencia de
  // los initialWipCost*, los campos del cuadro de UNIDADES del período no se
  // "mergean" con lo ya guardado — hay que re-mandar el cuadro completo. Repito
  // el payload original de M2 (paso2-fxavb-m1-m4.mjs) con solo periodCostMp cambiado.
  const editPlanta = await request(`/structures/${structureId}/process/departments/${planta.id}/periods/${m2.id}/movement`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      startedInProduction: 120000, finishedInStock: 34800, transferredOut: 85200, finalWip: 7200,
      normalLossPct: 2400 / 120000, totalLossReported: 2400, finalWipMpAvance: 1, finalWipConvAvance: 0.5,
      periodCostMp: Number(movAntes.body.data.saved.periodCostMp) + DELTA, periodCostMo: 0, periodCostCif: 3811200,
      sourceArea: 'costista',
    }),
  });
  log(`PUT movement Planta M2 (periodCostMp +$${DELTA.toLocaleString('es-AR')})`, editPlanta);

  const recalcM2 = await request(`/structures/${structureId}/process/periods/${m2.id}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  const plantaM2Nuevo = recalcM2.body?.data?.results?.departments?.find((d) => d.name === 'Planta');
  console.log('  POST calculate M2 (tras editar) ->', recalcM2.status, '| nuevo u.total Planta:', plantaM2Nuevo?.report?.costoUnitarioTotalAcumulado, '| nueva EF Planta:', plantaM2Nuevo?.report?.valuacionExistenciaFinalPorElemento);

  console.log('\n-- B1: SIN volver a cerrar M2 todavía, miro si M3 (cerrado, calculado con el M2 VIEJO) ya cambió solo --');
  const m3ProdReportAntes = await request(`/structures/${structureId}/process/periods/${m3.id}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  console.log('  (nota: esto ejecuta una corrida NUEVA sobre M3, no lee la vieja — ver abajo el intento de lectura pasiva)');
  const m3MovAntes = await request(`/structures/${structureId}/process/departments/${planta.id}/periods/${m3.id}/movement`, { headers: auth(token) });
  console.log('  M3 Planta.initialWipCostMp (EI arrastrada) SIN recerrar M2:', m3MovAntes.body.data.saved.initialWipCostMp, '(se cargó originalmente con el M2 viejo: 1584000)');

  console.log('\n-- B2: cierro M2 de nuevo (con el costo editado) y reviso si M3 se actualiza solo o queda inconsistente en silencio --');
  const recloseM2 = await request(`/periods/${m2.id}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  log('POST close M2 (segunda vez, con el dato editado)', recloseM2);

  const m3MovDespues = await request(`/structures/${structureId}/process/departments/${planta.id}/periods/${m3.id}/movement`, { headers: auth(token) });
  console.log('  M3 Planta.initialWipCostMp DESPUÉS de recerrar M2:', m3MovDespues.body.data.saved.initialWipCostMp);
  const desvioB = Number(m3MovDespues.body.data.saved.initialWipCostMp) - Number(m3MovAntes.body.data.saved.initialWipCostMp);
  console.log(`  DESVÍO en pesos del arrastre de M3 tras la edición retroactiva de M2: $${desvioB.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
  console.log(`  Veredicto B: ${desvioB === 0 ? 'M3 NO se actualizó — quedó consistente con su propia foto (o el sistema bloqueó el cierre de M2)' : 'M3 sigue mostrando su EI vieja aunque M2 cambió por debajo -> INCONSISTENCIA SILENCIOSA' }`);

  const m3ListaEstado = await request(`/structures/${structureId}/periods`, { headers: auth(token) });
  console.log('  Estados de todos los períodos ahora:', JSON.stringify((m3ListaEstado.body.data ?? []).map((p) => ({ code: p.code, status: p.status }))));

  console.log('\n\n########## PASO 3.C — DATO TARDÍO EN PERÍODO CERRADO ##########');
  console.log('M1 sigue CERRADO (nunca se reabrió). Intento un PUT movement directo, con fechaHecho DENTRO de M1 (cuadro completo, solo cambia periodCostMp).');
  const tardio = await request(`/structures/${structureId}/process/departments/${planta.id}/periods/${m1.id}/movement`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      startedInProduction: 120000, finishedInStock: 36000, transferredOut: 72000, finalWip: 9600,
      normalLossPct: 2400 / 120000, totalLossReported: 2400, finalWipMpAvance: 1, finalWipConvAvance: 0.5,
      periodCostMp: 99999999, periodCostMo: 0, periodCostCif: 3384000,
      fechaHecho: '2026-01-15', sourceArea: 'costista',
    }),
  });
  log('PUT movement Planta M1 (CERRADO, con fechaHecho tardío)', tardio);
  const m1PostTardio = await request(`/structures/${structureId}/process/departments/${planta.id}/periods/${m1.id}/movement`, { headers: auth(token) });
  console.log('  Planta M1 periodCostMp después del intento:', m1PostTardio.body.data.saved.periodCostMp, '(original: 23520000)');
  console.log(`  Veredicto C: ${tardio.status >= 400 ? `RECHAZADO (${tardio.status}, ${tardio.body?.error?.code})` : Number(m1PostTardio.body.data.saved.periodCostMp) === 99999999 ? 'ACEPTADO EN SILENCIO — pisó el período cerrado sin aviso' : 'status 2xx pero el valor NO cambió — revisar late_data_decisions'}`);

  console.log('\n\n########## PASO 3.E — RECÁLCULO DE UN PERÍODO CERRADO ##########');
  console.log('Uso M4 (nunca tocado desde que se cerró). Lo reabro y recalculo DOS veces para ver si runN incrementa (append-only) o se pisa.');
  const reopenM4 = await request(`/periods/${m4.id}/reopen`, { method: 'POST', headers: auth(token), body: JSON.stringify({ reason: 'PASO 3.E — auditoría AUD-2026-09-15, prueba de recálculo append-only' }) });
  log('POST reopen M4', reopenM4);
  const calc1 = await request(`/structures/${structureId}/process/periods/${m4.id}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  console.log('  1er recalculate M4 -> runId:', calc1.body?.data?.runId, 'runN:', calc1.body?.data?.runN);
  const calc2 = await request(`/structures/${structureId}/process/periods/${m4.id}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  console.log('  2do  recalculate M4 -> runId:', calc2.body?.data?.runId, 'runN:', calc2.body?.data?.runN);
  console.log(`  Veredicto E (unidades): ${calc1.body?.data?.runId !== calc2.body?.data?.runId && calc2.body?.data?.runN > calc1.body?.data?.runN ? 'NO se pisa — cada recálculo crea una corrida nueva con runN correlativo (append-only, confirmado en vivo)' : 'POSIBLE PISADO — revisar'}`);
  console.log('  Registro de quién/cuándo y bitácora en la misma transacción: confirmado por LECTURA DE CÓDIGO en calculation-run-persistence.ts (persistCalculationRun) — runN correlativo con lock FOR UPDATE, executedBy/validatedBy/validatedAt en la misma fila, y recordTraceAudit(...) llamado con el mismo `tx` DENTRO de la transacción — no se verificó con una query SQL directa a `audit_log` en esta sesión.');
  const closeM4 = await request(`/periods/${m4.id}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  log('POST close M4 (recerrando)', closeM4);

  console.log('\n\n########## FIN PASO 3 ##########');
}

main().catch((err) => { console.error('\n💥', err); process.exit(1); });
