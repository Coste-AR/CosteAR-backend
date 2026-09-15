// PASO 3.D — AUD-05 con magnitud: reclasificar sobre un período CERRADO y medir
// cm/PE/resultado antes y después. Estructura ORDERS mínima (mismo patrón que
// docs/auditorias/AUD-2026-09-14/evidencia/p07-periodo-cerrado.mjs), con ventas
// configuradas para que el tablero del dueño tenga cm/PE reales. NO es la escala
// del fixture FX-AV (eso exigiría Granja+Fraccionadora con AUD-04a resuelto y
// ventas configuradas, fuera de esta sesión) — se declara la limitación y se
// mide el mecanismo con los números propios de esta estructura mínima.
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
  const email = `aud-2026-09-15-paso3d-${Date.now()}@test.local`;
  const cuit = String(Date.now()).padStart(11, '0').slice(-11);
  must(await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'AuditoriaPaso3D-2026', name: 'Auditor PASO3D', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }) }), 'register');
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: 'AuditoriaPaso3D-2026' }) }), 'login');
  const token = login.accessToken;

  const company = must(await request('/companies', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'PASO3D — AUD-05 con magnitud (auditoria AUD-2026-09-15)', periodicity: 'MONTHLY' }) }), 'company');
  const structure = must(await request(`/companies/${company.id}/cost-structures`, { method: 'POST', headers: auth(token), body: JSON.stringify({ productName: 'Producto PASO3D', period: '2026-01', costingSystem: 'ORDERS' }) }), 'structure (ORDERS)');

  const period1 = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir M1');

  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_materia_prima`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'FIJO', confirmado: true }),
  }), 'set clasificacion=FIJO (empresa-wide)');

  must(await request(`/cost-structures/${structure.id}/raw-material`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ materials: [{
      name: 'Insumo PASO3D', unit: 'unidad',
      wilson: { annualDemand: 1200, orderCost: 10, holdingRate: 0.3, unitCost: 4 },
      stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 1 },
      initialStock: { quantity: 100, unitCost: 4 },
      movements: [{ date: '2026-01-10', type: 'consumption', detail: 'Consumo PASO3D', quantity: 100 }],
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
      centers: [{ id: 'centro-p3d', name: 'Centro PASO3D', type: 'productive' }],
      concepts: [{ name: 'Servicio PASO3D', amount: { fixed: 18000000, variable: 0 }, distribution: { 'centro-p3d': 1 } }],
      serviceDistributions: [],
      productiveSettings: [{ centerId: 'centro-p3d', normalCapacity: 100, actualActivity: 100, actualCip: 18000000 }],
    }),
  }), 'indirect-costs M1');
  must(await request(`/cost-structures/${structure.id}/sales`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ salesUnitPrice: 50000, salesQuantity: 100, productionQuantity: 100 }),
  }), 'sales M1');
  must(await request(`/cost-structures/${structure.id}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'calculate M1');
  must(await request(`/periods/${period1.id}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'cerrar M1');

  const tableroAntes = must(await request(`/periods/${period1.id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno M1 (recién cerrado, ANTES de reclasificar)');
  console.log('\n=== TABLERO M1 — ANTES de reclasificar ===');
  console.log(JSON.stringify(tableroAntes, null, 2).slice(0, 3000));

  const period2 = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir M2');

  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_materia_prima`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'VARIABLE', confirmado: true }),
  }), 'reclasificar comportamiento_materia_prima = VARIABLE (empresa-wide, con M2 abierto)');

  const tableroDespues = must(await request(`/periods/${period1.id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno M1 (CERRADO) DESPUÉS de reclasificar');
  console.log('\n=== TABLERO M1 (CERRADO) — DESPUÉS de reclasificar a nivel empresa ===');
  console.log(JSON.stringify(tableroDespues, null, 2).slice(0, 3000));

  console.log('\n\n========== COMPARACIÓN ==========');
  console.log('cm ANTES:', tableroAntes?.contribucionMarginalPorUnidad ?? tableroAntes?.cm ?? JSON.stringify(tableroAntes).slice(0,200));
  console.log('cm DESPUÉS:', tableroDespues?.contribucionMarginalPorUnidad ?? tableroDespues?.cm ?? JSON.stringify(tableroDespues).slice(0,200));
}
main().catch((e) => { console.error('💥', e.message, e.stack); process.exit(1); });
