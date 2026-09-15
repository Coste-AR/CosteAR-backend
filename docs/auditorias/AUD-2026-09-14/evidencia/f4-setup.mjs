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

const EMAIL = 'aud-f4-2026-09-14@test.local';
const PASSWORD = 'AuditoriaF4-2026';

async function main() {
  const terms = must(await request('/terms/current'), 'terms');
  const cuit = '20304050607';
  const reg = await request('/auth/register', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Auditor F4', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }) });
  console.log(reg.status === 201 ? '✅ register nuevo' : `ℹ️ register -> ${reg.status} (puede que ya exista)`);
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: EMAIL, password: PASSWORD }) }), 'login');
  const token = login.accessToken;

  const company = must(await request('/companies', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Granja Los Tres Alamos F4', periodicity: 'MONTHLY' }) }), 'company');
  const structure = must(await request(`/companies/${company.id}/cost-structures`, { method: 'POST', headers: auth(token), body: JSON.stringify({ productName: 'Huevo - cajon F4', period: '2026-01', costingSystem: 'ORDERS' }) }), 'structure ORDERS');
  const period1 = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir M1');

  must(await request(`/cost-structures/${structure.id}/raw-material`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ materials: [{
      name: 'Alimento balanceado', unit: 'kg',
      wilson: { annualDemand: 432000, orderCost: 500, holdingRate: 0.2, unitCost: 230 },
      stockPolicy: { minConsumption: 1000, maxConsumption: 1500, minLeadTime: 3, maxLeadTime: 7, safetyStock: 2000 },
      initialStock: { quantity: 0, unitCost: 230 },
      movements: [
        { date: '2026-01-05', type: 'purchase', detail: 'Compra alimento enero', quantity: 40000, unitCost: 230 },
        { date: '2026-01-15', type: 'consumption', detail: 'Consumo alimento enero', quantity: 36000 },
      ],
    }] }),
  }), 'raw-material');

  must(await request(`/cost-structures/${structure.id}/direct-labor`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({
      workingDays: { totalDaysPerYear: 365, unpaidAbsence: { sundays: 0, saturdays: 0, unjustifiedAbsences: 0, holidaysOnWeekend: 0 }, paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 } },
      itcs: { derivationBase: 0, fixedArt: 0, uncertainRemunerative: [], uncertainNonRemunerative: [] },
      departments: [{ name: 'Granja', basicRemuneration: 300000, hoursWorked: 200 }],
    }),
  }), 'direct-labor');

  must(await request(`/cost-structures/${structure.id}/indirect-costs`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({
      centers: [{ id: 'granja', name: 'Granja', type: 'productive' }],
      concepts: [{ name: 'Amortizacion plantel', amount: { fixed: 5000000, variable: 0 }, distribution: { granja: 1 } }],
      serviceDistributions: [],
      productiveSettings: [{ centerId: 'granja', normalCapacity: 750, actualActivity: 750, actualCip: 5000000 }],
    }),
  }), 'indirect-costs');

  must(await request(`/cost-structures/${structure.id}/sales`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ salesUnitPrice: 50000, salesQuantity: 750, productionQuantity: 750 }),
  }), 'sales');

  const calc = must(await request(`/cost-structures/${structure.id}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'calculate');

  console.log('\n=== Credenciales para el browser ===');
  console.log('email:', EMAIL, ' password:', PASSWORD);
  console.log('companyId:', company.id, ' structureId:', structure.id, ' periodId:', period1.id);
  console.log('productionCost:', calc.result?.productionCost);
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
