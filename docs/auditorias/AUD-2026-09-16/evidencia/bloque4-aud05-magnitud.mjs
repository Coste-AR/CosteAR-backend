// BLOQUE 4 — magnitud de AUD-2026-09-14-05, medida con las tres categorías de
// clasificación separadas (MP / MOD / CIF, calculation-result-enrichment.ts:118-134)
// para poder mover EXACTAMENTE $2.000.000 de una categoría a otra sin tocar el resto:
//   MP  (comportamiento_materia_prima)     = $15.000.000, VARIABLE desde el arranque (estable)
//   CIF (comportamiento_costos_indirectos) = $16.000.000, FIJO desde el arranque (estable)
//   MOD (comportamiento_mano_obra_directa) = $2.000.000,  FIJO al cerrar -> se reclasifica a VARIABLE
// Con 750 unidades vendidas/producidas y precio $50.000:
//   ANTES:   cv=20.000  cm=30.000  CF=18.000.000  PE=600,0    (= M1 del fixture, AM17 §13)
//   DESPUÉS: cv=22.666,67 cm=27.333,33 CF=16.000.000 PE=585,4  (fixture §10/§13)
// itcs.sacFraction=0 para que MOD dé EXACTO $2.000.000 (por defecto el motor usa
// 1/12 si no se manda, direct-labor.ts:130).
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
  const email = `aud-2026-09-16-bloque4-${Date.now()}@test.local`;
  const cuit = String(Date.now()).padStart(11, '0').slice(-11);
  must(await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'AuditoriaBloque4-2026', name: 'Auditor BLOQUE4', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }) }), 'register');
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: 'AuditoriaBloque4-2026' }) }), 'login');
  const token = login.accessToken;

  const company = must(await request('/companies', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'BLOQUE4 — magnitud AUD-05 (auditoria AUD-2026-09-16)', periodicity: 'MONTHLY' }) }), 'company');
  const structure = must(await request(`/companies/${company.id}/cost-structures`, { method: 'POST', headers: auth(token), body: JSON.stringify({ productName: 'Producto BLOQUE4', period: '2026-01', costingSystem: 'ORDERS' }) }), 'structure (ORDERS)');

  const period1 = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir M1');

  // ── Clasificación INICIAL: MP variable, MOD fijo, CIF fijo ──────────────
  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_materia_prima`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'VARIABLE', confirmado: true }) }), 'clasificar MP=VARIABLE');
  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_mano_obra_directa`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'FIJO', confirmado: true }) }), 'clasificar MOD=FIJO');
  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_costos_indirectos`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'FIJO', confirmado: true }) }), 'clasificar CIF=FIJO');

  // ── MP = $15.000.000 consumidos (1.000 u. x $15.000, se consumen todas) ──
  must(await request(`/cost-structures/${structure.id}/raw-material`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ materials: [{
      name: 'Insumo BLOQUE4', unit: 'unidad',
      wilson: { annualDemand: 12000, orderCost: 100, holdingRate: 0.2, unitCost: 15000 },
      stockPolicy: { minConsumption: 1, maxConsumption: 2, minLeadTime: 1, maxLeadTime: 2, safetyStock: 1 },
      initialStock: { quantity: 1000, unitCost: 15000 },
      movements: [{ date: '2026-01-10', type: 'consumption', detail: 'Consumo BLOQUE4', quantity: 1000 }],
    }] }),
  }), 'raw-material (MP=$15.000.000)');

  // ── MOD = $2.000.000 (sacFraction=0, sin ausentismo, sin cargas -> ITCS=0) ──
  must(await request(`/cost-structures/${structure.id}/direct-labor`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({
      workingDays: { totalDaysPerYear: 365, unpaidAbsence: { sundays: 0, saturdays: 0, unjustifiedAbsences: 0, holidaysOnWeekend: 0 }, paidAbsence: { holidays: 0, vacations: 0, sickness: 0, specialLeaves: 0, workAccidents: 0 } },
      itcs: { derivationBase: 0, fixedArt: 0, sacFraction: 0, uncertainRemunerative: [], uncertainNonRemunerative: [] },
      departments: [{ name: 'Operacion BLOQUE4', basicRemuneration: 2000000, hoursWorked: 8 }],
    }),
  }), 'direct-labor (MOD=$2.000.000)');

  // ── CIF = $16.000.000 aplicado (normalCapacity=actualActivity=100, sin desvío) ──
  must(await request(`/cost-structures/${structure.id}/indirect-costs`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({
      centers: [{ id: 'centro-b4', name: 'Centro BLOQUE4', type: 'productive' }],
      concepts: [{ name: 'Servicio BLOQUE4', amount: { fixed: 16000000, variable: 0 }, distribution: { 'centro-b4': 1 } }],
      serviceDistributions: [],
      productiveSettings: [{ centerId: 'centro-b4', normalCapacity: 100, actualActivity: 100, actualCip: 16000000 }],
    }),
  }), 'indirect-costs (CIF=$16.000.000)');

  must(await request(`/cost-structures/${structure.id}/sales`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ salesUnitPrice: 50000, salesQuantity: 750, productionQuantity: 750 }),
  }), 'sales (precio $50.000, 750 unidades)');

  const calc1 = must(await request(`/cost-structures/${structure.id}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'calculate M1 (clasificación ANTES)');
  console.log('rawMaterialConsumed', calc1.rawMaterialConsumed ?? calc1.results?.rawMaterialConsumed);
  console.log('directLaborTotal', calc1.directLaborTotal ?? calc1.results?.directLaborTotal);
  console.log('indirectCostsApplied', calc1.indirectCostsApplied ?? calc1.results?.indirectCostsApplied);

  must(await request(`/periods/${period1.id}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'cerrar M1');

  const tableroAntes = must(await request(`/periods/${period1.id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno (M1 CERRADO, ANTES de reclasificar)');
  console.log('\n=== TABLERO M1 — ANTES ===');
  console.log(JSON.stringify(tableroAntes, null, 2));

  // ── Reclasificar MOD: FIJO -> VARIABLE, empresa-wide, con M1 ya CERRADO ──
  must(await request(`/companies/${company.id}/parametros-costeo/comportamiento_mano_obra_directa`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'VARIABLE', confirmado: true }) }), 'reclasificar MOD=VARIABLE (M1 ya cerrado)');

  const tableroSinRecalcular = must(await request(`/periods/${period1.id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno (M1 CERRADO, DESPUÉS de reclasificar, SIN recalcular)');
  console.log('\n=== TABLERO M1 — DESPUÉS de reclasificar, SIN recalcular (tablero lee snapshot congelado) ===');
  console.log(JSON.stringify(tableroSinRecalcular, null, 2));

  // ── Recalcular el período YA CERRADO (AUD-2026-09-14-05: nada lo impide) ──
  const recalc = await request(`/cost-structures/${structure.id}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  console.log(`\nPOST calculate sobre M1 CERRADO (recalcular) -> ${recalc.status}`);
  if (recalc.status >= 300) console.log(JSON.stringify(recalc.body, null, 2));

  const tableroDespues = must(await request(`/periods/${period1.id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno (M1 CERRADO, DESPUÉS de recalcular con la clasificación nueva)');
  console.log('\n=== TABLERO M1 — DESPUÉS de recalcular con MOD ya VARIABLE ===');
  console.log(JSON.stringify(tableroDespues, null, 2));

  console.log('\n\n========== COMPARACIÓN ==========');
  const cm = (t) => t?.contribucionMarginalPorCajon?.valor;
  const pe = (t) => t?.puntoEquilibrioCajones?.valor;
  const cv = (t) => t?.costoPorCajon?.variable?.valor;
  const resultado = (t) => t?.resultadoPeriodo?.valor;
  console.log('cv          ANTES:', cv(tableroAntes), '| SIN recalcular:', cv(tableroSinRecalcular), '| DESPUÉS recalc:', cv(tableroDespues), '(esperado 20.000 -> 22.666,67)');
  console.log('cm          ANTES:', cm(tableroAntes), '| SIN recalcular:', cm(tableroSinRecalcular), '| DESPUÉS recalc:', cm(tableroDespues), '(esperado 30.000 -> 27.333,33)');
  console.log('PE          ANTES:', pe(tableroAntes), '| SIN recalcular:', pe(tableroSinRecalcular), '| DESPUÉS recalc:', pe(tableroDespues), '(esperado 600,0 -> 585,4)');
  console.log('resultado   ANTES:', resultado(tableroAntes), '| SIN recalcular:', resultado(tableroSinRecalcular), '| DESPUÉS recalc:', resultado(tableroDespues), '(hipótesis: NO se mueve)');
  const conversorAntes = cm(tableroAntes) ? 1000000 / cm(tableroAntes) : null;
  const conversorDespues = cm(tableroDespues) ? 1000000 / cm(tableroDespues) : null;
  console.log('conversor $1M -> cajones  ANTES:', conversorAntes, '| DESPUÉS:', conversorDespues, '(esperado 33,3 -> 36,6)');

  console.log('\n\n', JSON.stringify({ companyId: company.id, structureId: structure.id, period1Id: period1.id }));
}
main().catch((e) => { console.error('💥', e.message, e.stack); process.exit(1); });
