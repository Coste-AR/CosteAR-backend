// PREGUNTA ABIERTA 1.b — ¿PROCESSES reproduce AUD-05 en el tablero del dueño?
// Verificación empírica: estructura PROCESSES completa (1 depto, movimiento
// cargado, calculada y cerrada), CON unidadGestion y sales configurados, y se
// mira si el tablero-dueno devuelve contribucionMarginal/puntoEquilibrio en
// absoluto — la hipótesis, por lectura de código, es que NUNCA los devuelve,
// porque ProcessCalculationService.calculate() (process-calculation-service.ts)
// nunca llama a enrichCalculationResult (a diferencia de CalculationRunService,
// que sí lo hace para ORDERS). Si la hipótesis es correcta, la pregunta "¿usa
// clasificación vigente o congelada?" ni siquiera se puede plantear para
// PROCESSES: el campo nunca se puebla, ni antes ni después de cerrar.
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

async function main() {
  const terms = must(await request('/terms/current'), 'terms');
  const email = `aud-2026-09-16-followup-${Date.now()}@test.local`;
  const password = 'AuditoriaFollowup-2026';
  const cuit = String(Date.now()).padStart(11, '0').slice(-11);
  must(await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name: 'Auditor Followup', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }) }), 'register');
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password }) }), 'login');
  const token = login.accessToken;

  const company = must(await request('/companies', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'FOLLOWUP — PROCESSES tablero (auditoria AUD-2026-09-16)', periodicity: 'MONTHLY' }) }), 'company');
  const structure = must(await request(`/companies/${company.id}/cost-structures`, { method: 'POST', headers: auth(token), body: JSON.stringify({ productName: 'Producto Followup', period: '2026-01', costingSystem: 'PROCESSES' }) }), 'structure (PROCESSES)');
  must(await request(`/structures/${structure.id}/process-setup`, { method: 'POST', headers: auth(token), body: JSON.stringify({ departments: [{ name: 'Depto', sequence: 1, unit: 'unidad' }], hasJointProducts: false }) }), 'process-setup');
  const depts = must(await request(`/structures/${structure.id}/process/departments`, { headers: auth(token) }), 'GET departments');
  const dept = (Array.isArray(depts) ? depts : depts.departments ?? depts.items)[0];
  const period = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir período');
  const periodId = period.id ?? period.period?.id;

  must(await request(`/structures/${structure.id}/process/departments/${dept.id}/periods/${periodId}/movement`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      initialWip: 0, startedInProduction: 1000, finishedInStock: 0, transferredOut: 970,
      finalWip: 0, normalLossPct: 0.03, totalLossReported: 30,
      finalWipMpAvance: 1, finalWipConvAvance: 1,
      periodCostMp: 20000000, periodCostMo: 0, periodCostCif: 16000000,
      sourceArea: 'costista',
    }),
  }), 'PUT movement');

  must(await request(`/structures/${structure.id}/process/periods/${periodId}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'POST calculate');

  // Sales + unidadGestion, para descartar que "incompleta" sea por falta de ESO.
  const salesPut = await request(`/cost-structures/${structure.id}/sales`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ salesUnitPrice: 50000, salesQuantity: 970, productionQuantity: 970 }) });
  console.log('PUT sales (sobre estructura PROCESSES) ->', salesPut.status, JSON.stringify(salesPut.body).slice(0, 300));

  must(await request(`/periods/${periodId}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'cerrar período');

  const tableroSinUnidad = must(await request(`/periods/${periodId}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno (sin unidadGestion todavia)');
  console.log('\n=== TABLERO (PROCESSES, sin unidadGestion) ===');
  console.log(JSON.stringify(tableroSinUnidad, null, 2));

  console.log('\n\nIDs para seed manual de unidadGestion:', JSON.stringify({ email, password, companyId: company.id, userId: null, periodId }));
}
main().catch((e) => { console.error('💥', e.message, e.stack); process.exit(1); });
