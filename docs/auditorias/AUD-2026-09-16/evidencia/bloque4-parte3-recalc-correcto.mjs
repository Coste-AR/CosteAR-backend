// BLOQUE 4, parte 3 — CORRECCIÓN DE MÉTODO: `POST /cost-structures/:id/calculate`
// escribe en `CostCalculation` (SIN periodId, legado) — no toca `CalculationRun`,
// que es lo que lee `tablero-dueno` (owner-dashboard-service.ts:104, filtra por
// `periodId`). El recálculo que SÍ genera un `CalculationRun` nuevo para el
// período es un EFECTO SECUNDARIO de volver a guardar una sección (Órdenes):
// `recalculateVariableView` (cost-structure-service.ts:331-341), disparado desde
// `updateSales`/`saveSection` (líneas 510 y 640). No hay endpoint dedicado: se
// dispara re-guardando `sales` con LOS MISMOS valores (no cambia ningún dato,
// solo fuerza el recálculo).
const BASE_URL = 'http://127.0.0.1:3000/api/v1';
async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
function auth(token) { return { authorization: `Bearer ${token}` }; }
function must(res, label) {
  if (res.status < 200 || res.status >= 300) { console.log(`❌ ${label} -> ${res.status}`, JSON.stringify(res.body)); throw new Error(label); }
  console.log(`✅ ${label} -> ${res.status}`);
  return res.body.data;
}
const g = (t, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), t);
function resumen(label, t) {
  console.log(`\n-- ${label} --`);
  console.log('  cv:', g(t, 'costoPorCajon.variable.valor'), '| cm:', g(t, 'contribucionMarginalPorCajon.valor'), '| PE:', g(t, 'puntoEquilibrioCajones.valor'), '| resultadoPeriodo:', g(t, 'resultadoPeriodo.valor'));
  const cm = g(t, 'contribucionMarginalPorCajon.valor');
  console.log('  conversor $1.000.000 ->', cm ? (1000000 / cm).toFixed(2) : null, 'cajones');
}

const structureId = '5e84acaa-714b-49ac-9ada-1df4d9ba798c';
const period1Id = '776cabf0-ec4d-4413-91ad-6626cedfa5b4';
const companyId = 'bfb27259-446c-4d0c-a09b-6ff272915fbd';

async function main() {
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'aud-2026-09-16-bloque4-1789489664987@test.local', password: 'AuditoriaBloque4-2026' }) }), 'login');
  const token = login.accessToken;

  // 1) Volver a MOD=FIJO y forzar recálculo real (re-PUT sales) -> captura el "ANTES" limpio.
  must(await request(`/companies/${companyId}/parametros-costeo/comportamiento_mano_obra_directa`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'FIJO', confirmado: true }) }), 'MOD=FIJO');
  must(await request(`/cost-structures/${structureId}/sales`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ salesUnitPrice: 50000, salesQuantity: 750, productionQuantity: 750 }) }), 'PUT sales (re-guardar mismos valores -> dispara recalculateVariableView)');
  const antes = must(await request(`/periods/${period1Id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno ANTES (MOD=FIJO, recalc real)');
  resumen('ANTES (MOD=FIJO, recálculo real disparado)', antes);

  must(await request(`/periods/${period1Id}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }).then((r) => (r.status === 409 ? { status: 200, body: { data: 'ya estaba cerrado' } } : r)), 'confirmar M1 sigue/vuelve CERRADO');

  // 2) Reclasificar MOD->VARIABLE con M1 YA CERRADO, y forzar el recálculo REAL.
  must(await request(`/companies/${companyId}/parametros-costeo/comportamiento_mano_obra_directa`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'VARIABLE', confirmado: true }) }), 'reclasificar MOD=VARIABLE (M1 CERRADO)');

  const sinRecalcular = must(await request(`/periods/${period1Id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno reclasificado, SIN recalcular todavía');
  resumen('reclasificado, SIN recalcular (debe = ANTES: snapshot)', sinRecalcular);

  must(await request(`/cost-structures/${structureId}/sales`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ salesUnitPrice: 50000, salesQuantity: 750, productionQuantity: 750 }) }), 'PUT sales de nuevo -> recálculo REAL con M1 CERRADO y MOD=VARIABLE');

  const despues = must(await request(`/periods/${period1Id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno DESPUÉS del recálculo real');
  resumen('DESPUÉS del recálculo real (M1 sigue CERRADO)', despues);

  console.log('\n\nEsperado por fórmula: cv 20.000->22.666,67 | cm 30.000->27.333,33 | PE 600,0->585,4 | resultadoPeriodo SIN CAMBIOS | conversor 33,3->36,6');
}
main().catch((e) => { console.error('💥', e.message, e.stack); process.exit(1); });
