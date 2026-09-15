// BLOQUE 1 — P-06 conjuntos por tamaño. Los CUATRO métodos, en vivo por API,
// usando los casos "Ancla" que ya viven como comentario en el propio dominio
// (src/domain/calculations/joint-costs.ts), NUNCA antes ejercitados por ningún
// test ni ninguna auditoría anterior (P-06 "NO EJERCITADO" en AUD-2026-09-15).
// Un solo departamento (secuencia 1) alcanza: el reparto de costos conjuntos
// NO pasa por conversionFromPrevious ni por el cuadro de movimiento, así que
// NO está bloqueado por AUD-2026-09-14-04a (confirmado leyendo joint-cost-service.ts:
// resolveContext solo exige depto+período válidos, nada de UnitMovementSchedule).
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
function cmp(label, real, esperado, tol = 0.02) {
  const r = Number(real), e = Number(esperado);
  const ok = Math.abs(r - e) <= tol;
  console.log(`  ${ok ? '✓' : '✗ DIFIERE'} ${label}: real=${r} ancla=${e}${ok ? '' : `  <<<< diff=${(r - e).toFixed(6)}`}`);
  return ok;
}

async function main() {
  const terms = must(await request('/terms/current'), 'terms');
  const email = `aud-2026-09-16-bloque1-${Date.now()}@test.local`;
  const cuit = String(Date.now()).padStart(11, '0').slice(-11);
  must(await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'AuditoriaBloque1-2026', name: 'Auditor BLOQUE1', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }) }), 'register');
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: 'AuditoriaBloque1-2026' }) }), 'login');
  const token = login.accessToken;

  const company = must(await request('/companies', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'BLOQUE1 — P-06 conjuntos (auditoria AUD-2026-09-16)', periodicity: 'MONTHLY' }) }), 'company');
  const structure = must(await request(`/companies/${company.id}/cost-structures`, { method: 'POST', headers: auth(token), body: JSON.stringify({ productName: 'Punto de separación BLOQUE1', period: '2026-01', costingSystem: 'PROCESSES' }) }), 'structure (PROCESSES)');

  // Un único departamento, secuencia 1: SIN conversionFromPrevious (no aplica a seq=1).
  must(await request(`/structures/${structure.id}/process-setup`, {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ departments: [{ name: 'Separación', sequence: 1, unit: 'kg' }], hasJointProducts: true }),
  }), 'process-setup (1 depto, hasJointProducts=true)');

  const depts = must(await request(`/structures/${structure.id}/process/departments`, { headers: auth(token) }), 'GET departments');
  const list = Array.isArray(depts) ? depts : (depts.departments ?? depts.items ?? []);
  const dept = list[0];
  console.log('deptId', dept.id);

  const period = must(await request(`/structures/${structure.id}/periods`, { method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }) }), 'abrir período');
  const periodId = period.id ?? period.period?.id;

  // ── MÉTODO 1 · PHYSICAL_UNITS — Ancla M1 del dominio (joint-costs.ts:247-249) ──
  console.log('\n########## MÉTODO 1 · PHYSICAL_UNITS ##########');
  const r1 = must(await request(`/structures/${structure.id}/process/periods/${periodId}/joint-costs`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      deptId: dept.id, method: 'PHYSICAL_UNITS', jointCostTotal: 570000,
      products: [
        { productName: 'A', kind: 'coproduct', unitsObtained: 2500 },
        { productName: 'B', kind: 'coproduct', unitsObtained: 3000 },
        { productName: 'C', kind: 'coproduct', unitsObtained: 4000 },
      ],
      sourceArea: 'costista', captureMethod: 'manual',
    }),
  }), 'PUT joint-costs (PHYSICAL_UNITS)');
  const l1 = Object.fromEntries(r1.result.lines.map((l) => [l.productName, l]));
  cmp('A unitCost', l1.A.unitCost, 60); cmp('A allocatedCost', l1.A.allocatedCost, 150000);
  cmp('B unitCost', l1.B.unitCost, 60); cmp('B allocatedCost', l1.B.allocatedCost, 180000);
  cmp('C unitCost', l1.C.unitCost, 60); cmp('C allocatedCost', l1.C.allocatedCost, 240000);
  cmp('totalAllocated', r1.result.totalAllocated, 570000);
  console.log('  totalAllocated real:', r1.result.totalAllocated);
  // ── El bug del frontend, medido con estos datos exactos ──
  // JointCostsTab.tsx:471 -> enPerdida = allocationBase>0 && allocatedCost>allocationBase
  // Para PHYSICAL_UNITS, allocationBase = UNIDADES (2500/3000/4000), allocatedCost = PESOS.
  for (const p of ['A', 'B', 'C']) {
    const enPerdida = l1[p].allocationBase > 0 && l1[p].allocatedCost > l1[p].allocationBase;
    console.log(`  Frontend "enPerdida" (comparando $ contra unidades) para ${p}: base=${l1[p].allocationBase} asignado=${l1[p].allocatedCost} -> enPerdida=${enPerdida}`);
  }

  // ── MÉTODO 2 · TECHNICAL_YIELD — Ancla M2 del dominio (joint-costs.ts:269-270) ──
  console.log('\n########## MÉTODO 2 · TECHNICAL_YIELD ##########');
  const r2 = must(await request(`/structures/${structure.id}/process/periods/${periodId}/joint-costs`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      deptId: dept.id, method: 'TECHNICAL_YIELD', jointCostTotal: 1150000,
      products: [
        { productName: 'Jugo', kind: 'coproduct', unitsObtained: 60, yieldPct: 6 },
        { productName: 'Aceite', kind: 'coproduct', unitsObtained: 5, yieldPct: 0.5 },
        { productName: 'Cascara', kind: 'byproduct', unitsObtained: 50, yieldPct: 5 },
      ],
      sourceArea: 'costista', captureMethod: 'manual',
    }),
  }), 'PUT joint-costs (TECHNICAL_YIELD)');
  const l2 = Object.fromEntries(r2.result.lines.map((l) => [l.productName, l]));
  cmp('Jugo participación %', l2.Jugo.participationPct * 100, 52.17, 0.01);
  cmp('Aceite participación %', l2.Aceite.participationPct * 100, 4.35, 0.01);
  cmp('Cascara participación %', l2.Cascara.participationPct * 100, 43.48, 0.01);
  cmp('totalAllocated', r2.result.totalAllocated, 1150000);

  // ── MÉTODO 3 · MARKET_VALUE — Ancla M3 del dominio (joint-costs.ts:289-291) ──
  console.log('\n########## MÉTODO 3 · MARKET_VALUE ##########');
  const r3 = must(await request(`/structures/${structure.id}/process/periods/${periodId}/joint-costs`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      deptId: dept.id, method: 'MARKET_VALUE', jointCostTotal: 570000,
      products: [
        { productName: 'A', kind: 'coproduct', unitsObtained: 2500, marketPrice: 120 },
        { productName: 'B', kind: 'coproduct', unitsObtained: 3000, marketPrice: 170 },
        { productName: 'C', kind: 'coproduct', unitsObtained: 4000, marketPrice: 225 },
      ],
      sourceArea: 'costista', captureMethod: 'manual',
    }),
  }), 'PUT joint-costs (MARKET_VALUE)');
  const l3 = Object.fromEntries(r3.result.lines.map((l) => [l.productName, l]));
  cmp('A unitCost', l3.A.unitCost, 40); cmp('A allocatedCost', l3.A.allocatedCost, 100000);
  cmp('B unitCost', l3.B.unitCost, 56.67, 0.01); cmp('B allocatedCost', l3.B.allocatedCost, 170000);
  cmp('C unitCost', l3.C.unitCost, 75); cmp('C allocatedCost', l3.C.allocatedCost, 300000);
  cmp('totalAllocated', r3.result.totalAllocated, 570000);
  for (const p of ['A', 'B', 'C']) {
    console.log(`  Frontend "enPerdida" MARKET_VALUE para ${p}: base(=marketValue)=${l3[p].allocationBase} asignado=${l3[p].allocatedCost} margin(backend)=${l3[p].margin ?? 'null (frontend no lo pide/consume)'}`);
  }

  // ── MÉTODO 4 · NET_REALIZABLE_VALUE — Ancla M4 del dominio (joint-costs.ts:316-318) ──
  console.log('\n########## MÉTODO 4 · NET_REALIZABLE_VALUE ##########');
  const r4 = must(await request(`/structures/${structure.id}/process/periods/${periodId}/joint-costs`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      deptId: dept.id, method: 'NET_REALIZABLE_VALUE', jointCostTotal: 110000,
      products: [
        { productName: 'A', kind: 'coproduct', unitsObtained: 200, marketPrice: 300, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
        { productName: 'B', kind: 'coproduct', unitsObtained: 300, marketPrice: 400, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
        { productName: 'C', kind: 'coproduct', unitsObtained: 400, marketPrice: 500, sellingCostVarPct: 0.03, sellingCostFixedPerUnit: 10 },
      ],
      sourceArea: 'costista', captureMethod: 'manual',
    }),
  }), 'PUT joint-costs (NET_REALIZABLE_VALUE)');
  const l4 = Object.fromEntries(r4.result.lines.map((l) => [l.productName, l]));
  cmp('A unitCost', l4.A.unitCost, 85.96, 0.01); cmp('A allocatedCost', l4.A.allocatedCost, 17191.32, 1);
  cmp('B unitCost', l4.B.unitCost, 115.63, 0.5); cmp('B allocatedCost', l4.B.allocatedCost, 34688.54, 1);
  cmp('C unitCost', l4.C.unitCost, 145.30, 0.5); cmp('C allocatedCost', l4.C.allocatedCost, 58120.13, 1);
  cmp('totalAllocated', r4.result.totalAllocated, 110000);

  // ── R16 · descarte con costo de eliminación → ¿coproducto de precio NEGATIVO? ──
  console.log('\n########## R16 · marketPrice negativo — ¿el schema lo permite? ##########');
  const rNeg = await request(`/structures/${structure.id}/process/periods/${periodId}/joint-costs`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      deptId: dept.id, method: 'MARKET_VALUE', jointCostTotal: 570000,
      products: [
        { productName: 'A', kind: 'coproduct', unitsObtained: 2500, marketPrice: 120 },
        { productName: 'Descarte T0/T4', kind: 'waste', unitsObtained: 500, marketPrice: -1500 },
      ],
      sourceArea: 'costista', captureMethod: 'manual',
    }),
  });
  console.log(`PUT con marketPrice: -1500 -> status ${rNeg.status}`);
  console.log(JSON.stringify(rNeg.body, null, 2));

  console.log('\n\n========== RESUMEN ==========');
  console.log(JSON.stringify({ companyId: company.id, structureId: structure.id, deptId: dept.id, periodId }, null, 2));
}
main().catch((e) => { console.error('💥', e.message, e.stack); process.exit(1); });
