const BASE_URL = 'http://127.0.0.1:3001/api/v1';
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
  const email = `aud-p07-${Date.now()}@test.local`;
  const cuit = String(Date.now()).padStart(11, '0').slice(-11);
  must(await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'AuditoriaP07-2026', name: 'Auditor P07', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }) }), 'register');
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: 'AuditoriaP07-2026' }) }), 'login');
  const token = login.accessToken;

  const company = must(await request('/companies', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Empresa prueba P07 periodo cerrado', periodicity: 'MONTHLY' }) }), 'company');
  const structure = must(await request(`/companies/${company.id}/cost-structures`, { method: 'POST', headers: auth(token), body: JSON.stringify({ productName: 'Producto P07', period: '2026-01', costingSystem: 'ORDERS' }) }), 'structure (ORDERS)');

  const period1 = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir M1');

  // Clasificación empresa-wide (sin periodId): FIJO
  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_materia_prima`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'FIJO', confirmado: true }),
  }), 'set clasificacion=FIJO (empresa-wide)');

  const resuelto1 = must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_materia_prima?periodId=${period1.id}`, { headers: auth(token) }), `GET clasificacion para M1 (abierto) - antes de cerrar`);
  console.log('   -> comportamientoVolumen resuelto para M1 (abierto):', resuelto1.comportamientoVolumen ?? JSON.stringify(resuelto1));

  // Completar las 3 secciones mínimas de ÓRDENES para que el período sea cerrable (mismo payload que tests/e2e/costing-server.test.ts)
  must(await request(`/cost-structures/${structure.id}/raw-material`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ materials: [{
      name: 'Insumo P07', unit: 'unidad',
      wilson: { annualDemand: 100, orderCost: 10, holdingRate: 0.3, unitCost: 4 },
      stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 1 },
      initialStock: { quantity: 10, unitCost: 4 },
      movements: [{ date: '2026-01-10', type: 'consumption', detail: 'Consumo P07', quantity: 6 }],
    }] }),
  }), 'raw-material M1');
  must(await request(`/cost-structures/${structure.id}/direct-labor`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({
      workingDays: { totalDaysPerYear: 365, unpaidAbsence: { sundays: 0, saturdays: 0, unjustifiedAbsences: 0, holidaysOnWeekend: 0 }, paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 } },
      itcs: { derivationBase: 0, fixedArt: 0, uncertainRemunerative: [], uncertainNonRemunerative: [] },
      departments: [{ name: 'Operacion', basicRemuneration: 24, hoursWorked: 8 }],
    }),
  }), 'direct-labor M1');
  must(await request(`/cost-structures/${structure.id}/indirect-costs`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({
      centers: [{ id: 'centro-p07', name: 'Centro P07', type: 'productive' }],
      concepts: [{ name: 'Servicio P07', amount: { fixed: 12, variable: 0 }, distribution: { 'centro-p07': 1 } }],
      serviceDistributions: [],
      productiveSettings: [{ centerId: 'centro-p07', normalCapacity: 6, actualActivity: 6, actualCip: 12 }],
    }),
  }), 'indirect-costs M1');
  must(await request(`/cost-structures/${structure.id}/sales`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ salesUnitPrice: 15, salesQuantity: 6, productionQuantity: 6 }),
  }), 'sales M1');
  must(await request(`/cost-structures/${structure.id}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'calculate M1');

  must(await request(`/periods/${period1.id}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'cerrar M1');

  const period2 = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir M2');

  // Reclasificar en el período abierto (M2), empresa-wide: VARIABLE
  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_materia_prima`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'VARIABLE', confirmado: true }),
  }), 'set clasificacion=VARIABLE (empresa-wide, con M2 abierto)');

  const resuelto1DespuesDeCerrar = must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_materia_prima?periodId=${period1.id}`, { headers: auth(token) }), `GET clasificacion para M1 (YA CERRADO) - despues de reclasificar en M2`);
  console.log('\n=== RESULTADO P-07 ===');
  console.log('M1 (cerrado) resuelve comportamientoVolumen =', resuelto1DespuesDeCerrar.comportamientoVolumen ?? JSON.stringify(resuelto1DespuesDeCerrar));
  console.log('Esperado si el motor es correcto: FIJO (la clasificación vigente cuando M1 se calculó/cerró)');
  console.log('Si da VARIABLE: usa la clasificación del período abierto sobre uno cerrado -> CRÍTICO');
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
