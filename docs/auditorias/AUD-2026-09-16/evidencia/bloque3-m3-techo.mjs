// BLOQUE 3 — Escenario M3 del fixture (PE fuera del techo del tramo), para
// capturar el tablero del dueño en pantalla. Estructura ORDERS mínima (mismo
// patrón que BLOQUE 4) con los números de M3 (fixtures-avicola.md §6):
//   cajones 825, precio $47.960, cv $25.896,32, cm $22.063,68,
//   CF $24.430.000, PE esperado 1.107,2 cajones.
// El backend NO tiene ningún campo de "techo de tramo" ni "capacidad instalada"
// en owner-dashboard.schema.ts (confirmado por grep: cero resultados) — así que
// esta captura documenta el estado ACTUAL: el PE se muestra como número suelto,
// sin ningún techo con el que compararlo, porque el dato no existe en el
// contrato de la API.
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
  const email = `aud-2026-09-16-bloque3-${Date.now()}@test.local`;
  const password = 'AuditoriaBloque3-2026';
  const cuit = String(Date.now()).padStart(11, '0').slice(-11);
  must(await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name: 'Auditor BLOQUE3', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }) }), 'register');
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password }) }), 'login');
  const token = login.accessToken;

  const company = must(await request('/companies', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'BLOQUE3 — M3 PE fuera del techo (auditoria AUD-2026-09-16)', periodicity: 'MONTHLY' }) }), 'company');
  const structure = must(await request(`/companies/${company.id}/cost-structures`, { method: 'POST', headers: auth(token), body: JSON.stringify({ productName: 'Producto M3', period: '2026-03', costingSystem: 'ORDERS' }) }), 'structure (ORDERS)');
  const period1 = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir M3');

  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_materia_prima`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'VARIABLE', confirmado: true }) }), 'MP=VARIABLE');
  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_mano_obra_directa`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'FIJO', confirmado: true }) }), 'MOD=FIJO');
  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_costos_indirectos`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'FIJO', confirmado: true }) }), 'CIF=FIJO');

  // cv total = 825 x $25.896,32 = $21.364.464  (MP, variable)
  must(await request(`/cost-structures/${structure.id}/raw-material`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ materials: [{
      name: 'Insumo M3', unit: 'unidad',
      wilson: { annualDemand: 9900, orderCost: 100, holdingRate: 0.2, unitCost: 25896.32 },
      stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 1 },
      initialStock: { quantity: 825, unitCost: 25896.32 },
      movements: [{ date: '2026-03-10', type: 'consumption', detail: 'Consumo M3', quantity: 825 }],
    }] }),
  }), 'raw-material (cv=$21.364.464)');

  // CF = $24.430.000 total, repartido MOD $4.430.000 (fijo) + CIF $20.000.000 (fijo)
  must(await request(`/cost-structures/${structure.id}/direct-labor`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({
      workingDays: { totalDaysPerYear: 365, unpaidAbsence: { sundays: 0, saturdays: 0, unjustifiedAbsences: 0, holidaysOnWeekend: 0 }, paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 } },
      itcs: { derivationBase: 0, fixedArt: 0, sacFraction: 0, uncertainRemunerative: [], uncertainNonRemunerative: [] },
      departments: [{ name: 'Operacion M3', basicRemuneration: 4430000, hoursWorked: 8 }],
    }),
  }), 'direct-labor (MOD=$4.430.000)');

  must(await request(`/cost-structures/${structure.id}/indirect-costs`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({
      centers: [{ id: 'centro-m3', name: 'Centro M3', type: 'productive' }],
      concepts: [{ name: 'Estructura M3', amount: { fixed: 20000000, variable: 0 }, distribution: { 'centro-m3': 1 } }],
      serviceDistributions: [],
      productiveSettings: [{ centerId: 'centro-m3', normalCapacity: 100, actualActivity: 100, actualCip: 20000000 }],
    }),
  }), 'indirect-costs (CIF=$20.000.000)');

  must(await request(`/cost-structures/${structure.id}/sales`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ salesUnitPrice: 47960, salesQuantity: 825, productionQuantity: 825 }),
  }), 'sales (precio $47.960, 825 unidades — mix M3)');

  console.log('\n\n', JSON.stringify({ email, password, companyId: company.id, structureId: structure.id, period1Id: period1.id }));

  const login2 = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password }) }), 'confirmar login (para setear unidadGestion después del seed)');
}
main().catch((e) => { console.error('💥', e.message, e.stack); process.exit(1); });
