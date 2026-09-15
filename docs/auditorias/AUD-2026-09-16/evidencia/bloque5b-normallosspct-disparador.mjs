// BLOQUE 5.B — ¿Cuál es el disparador REAL de la familia normalLossPct?
// Hipótesis del pedido: "no es un número no redondo (2,5% representa perfecto
// en Decimal(9,4))". Confirmado por lectura de schema: Decimal(9,4) guarda la
// FRACCIÓN con 4 decimales (0,0250 = 2,5% exacto). El disparador real: cuando
// la fracción se DERIVA de un conteo físico (ej. 13 unidades perdidas sobre
// 1.556 = 0,00835475...), Postgres REDONDEA (no trunca) a 4 decimales al
// guardar. Si el 5º dígito decimal es >=5, redondea HACIA ARRIBA, y
// normalLoss = periodUnits × pctRedondeado puede superar el totalLossReported
// REAL (entero) -> extraordinaryLoss negativo -> 422 (process-costing.ts:226).
// Con un % TIPEADO a mano (2,5% / 3% / 4,25%) no hay redondeo: el valor
// guardado ES el valor exacto, así que nunca dispara.
// Departamento único, secuencia 1 (sin conversionFromPrevious, no aplica).
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

async function nuevaEstructura(token, nombre) {
  const company = must(await request('/companies', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: nombre, periodicity: 'MONTHLY' }) }), `company ${nombre}`);
  const structure = must(await request(`/companies/${company.id}/cost-structures`, { method: 'POST', headers: auth(token), body: JSON.stringify({ productName: nombre, period: '2026-01', costingSystem: 'PROCESSES' }) }), `structure ${nombre}`);
  must(await request(`/structures/${structure.id}/process-setup`, { method: 'POST', headers: auth(token), body: JSON.stringify({ departments: [{ name: 'Depto', sequence: 1, unit: 'unidad' }], hasJointProducts: false }) }), 'process-setup');
  const depts = must(await request(`/structures/${structure.id}/process/departments`, { headers: auth(token) }), 'GET departments');
  const dept = (Array.isArray(depts) ? depts : depts.departments ?? depts.items)[0];
  const period = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir período');
  return { structureId: structure.id, deptId: dept.id, periodId: period.id ?? period.period?.id };
}

async function probar(token, { structureId, deptId, periodId }, label, { startedInProduction, normalLossPct, totalLossReported }) {
  console.log(`\n### ${label} — normalLossPct enviado: ${normalLossPct} (${(normalLossPct * 100).toFixed(6)}%) ###`);
  const mov = await request(`/structures/${structureId}/process/departments/${deptId}/periods/${periodId}/movement`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      initialWip: 0, startedInProduction, finishedInStock: 0,
      transferredOut: startedInProduction - Math.round(totalLossReported), finalWip: 0,
      normalLossPct, totalLossReported,
      finalWipMpAvance: 1, finalWipConvAvance: 1,
      periodCostMp: startedInProduction * 100, periodCostMo: 0, periodCostCif: startedInProduction * 10,
      sourceArea: 'costista',
    }),
  });
  console.log(`PUT movement -> ${mov.status}`);
  const guardado = await request(`/structures/${structureId}/process/departments/${deptId}/periods/${periodId}/movement`, { headers: auth(token) });
  console.log('normalLossPct GUARDADO (redondeado por Postgres):', guardado.body?.data?.saved?.normalLossPct);
  const calc = await request(`/structures/${structureId}/process/periods/${periodId}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  console.log(`POST calculate -> ${calc.status}`);
  if (calc.status >= 300) console.log('  422:', JSON.stringify(calc.body.error ?? calc.body));
  else console.log('  OK, sin pérdida extraordinaria negativa.');
}

async function main() {
  const terms = must(await request('/terms/current'), 'terms');
  const email = `aud-2026-09-16-bloque5b-${Date.now()}@test.local`;
  const cuit = String(Date.now()).padStart(11, '0').slice(-11);
  must(await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'AuditoriaBloque5B-2026', name: 'Auditor BLOQUE5B', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }) }), 'register');
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: 'AuditoriaBloque5B-2026' }) }), 'login');
  const token = login.accessToken;

  // CASO A — % TIPEADO A MANO, redondo: 2,5%
  const ctxA = await nuevaEstructura(token, 'BLOQUE5B-A tipeado 2,5% (AUD-2026-09-16)');
  await probar(token, ctxA, 'CASO A · tipeado a mano 2,5%', { startedInProduction: 1000, normalLossPct: 0.025, totalLossReported: 25 });

  // CASO B — % TIPEADO A MANO, redondo: 3,00%
  const ctxB = await nuevaEstructura(token, 'BLOQUE5B-B tipeado 3% (AUD-2026-09-16)');
  await probar(token, ctxB, 'CASO B · tipeado a mano 3%', { startedInProduction: 1000, normalLossPct: 0.03, totalLossReported: 30 });

  // CASO C — % TIPEADO A MANO, redondo: 4,25%
  const ctxC = await nuevaEstructura(token, 'BLOQUE5B-C tipeado 4,25% (AUD-2026-09-16)');
  await probar(token, ctxC, 'CASO C · tipeado a mano 4,25%', { startedInProduction: 1000, normalLossPct: 0.0425, totalLossReported: 42.5 });

  // CASO D — % DERIVADO de un conteo real: 13 perdidas / 1.556 unidades (el caso EXACTO de AUD-2026-09-15-01)
  const ctxD = await nuevaEstructura(token, 'BLOQUE5B-D derivado 13-1556 (AUD-2026-09-16)');
  await probar(token, ctxD, 'CASO D · derivado de conteo 13/1556 = 0,00835475...', { startedInProduction: 1556, normalLossPct: 13 / 1556, totalLossReported: 13 });

  // CASO E — % DERIVADO de otro conteo real: 17 perdidas / 825 unidades
  const ctxE = await nuevaEstructura(token, 'BLOQUE5B-E derivado 17-825 (AUD-2026-09-16)');
  await probar(token, ctxE, 'CASO E · derivado de conteo 17/825 = 0,02060606...', { startedInProduction: 825, normalLossPct: 17 / 825, totalLossReported: 17 });

  // CASO F — otro conteo real que también redondea hacia arriba: 7 / 333
  const ctxF = await nuevaEstructura(token, 'BLOQUE5B-F derivado 7-333 (AUD-2026-09-16)');
  await probar(token, ctxF, 'CASO F · derivado de conteo 7/333 = 0,021021021...', { startedInProduction: 333, normalLossPct: 7 / 333, totalLossReported: 7 });
}
main().catch((e) => { console.error('💥', e.message, e.stack); process.exit(1); });
