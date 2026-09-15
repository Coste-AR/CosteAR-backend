// Puerto 3001 a propósito: el 3000 tenía un proceso node preexistente de otra
// sesión/worktree (PID confirmado con `netstat -ano`, no era el que este script
// arrancaba). Arrancar en un puerto propio evita pegarle a código desconocido.
const BASE_URL = 'http://127.0.0.1:3001/api/v1';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

function auth(token) { return { authorization: `Bearer ${token}` }; }

function must(res, label) {
  if (res.status < 200 || res.status >= 300) {
    console.log(`\n❌ ${label} -> ${res.status}`);
    console.log(JSON.stringify(res.body, null, 2));
    throw new Error(`Fallo en: ${label}`);
  }
  console.log(`✅ ${label} -> ${res.status}`);
  return res.body.data;
}

async function main() {
  const terms = must(await request('/terms/current'), 'GET /terms/current');
  const email = `aud-2026-09-14-${Date.now()}@test.local`;
  const password = 'AuditoriaFxAv2026';
  const cuit = String(Date.now()).padStart(11, '0').slice(0, 11);

  const register = must(await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email, password, name: 'Auditor FX-AV', cuit, professionalType: 'OTRO',
      acceptedTerms: true, termsVersionId: terms.id,
    }),
  }), 'POST /auth/register');

  const login = must(await request('/auth/login', {
    method: 'POST', body: JSON.stringify({ identifier: email, password }),
  }), 'POST /auth/login');
  const token = login.accessToken;

  const company = must(await request('/companies', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ name: 'Granja Los Tres Alamos (FX-AV, auditoria)', periodicity: 'MONTHLY' }),
  }), 'POST /companies');
  const companyId = company.id;

  const structure = must(await request(`/companies/${companyId}/cost-structures`, {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ productName: 'Huevo de gallina - cajon', period: '2026-01', costingSystem: 'PROCESSES' }),
  }), 'POST /cost-structures (PROCESSES)');
  const structureId = structure.id;

  const setup = must(await request(`/structures/${structureId}/process-setup`, {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
      departments: [
        { name: 'Granja', sequence: 1, unit: 'huevo' },
        { name: 'Fraccionadora', sequence: 2, unit: 'cajon', conversionFromPrevious: 1 / 360 },
      ],
      hasJointProducts: true,
    }),
  }), 'POST /process-setup');

  const depts = must(await request(`/structures/${structureId}/process/departments`, { headers: auth(token) }), 'GET /process/departments');
  console.log('depts raw:', JSON.stringify(depts));
  const deptsList = Array.isArray(depts) ? depts : (depts.departments ?? depts.items ?? []);
  const granja = deptsList.find((d) => d.name === 'Granja');
  const fraccionadora = deptsList.find((d) => d.name === 'Fraccionadora');
  console.log('granjaId', granja.id, 'fraccionadoraId', fraccionadora.id);

  // ── M1 ──────────────────────────────────────────────────────────────────
  const period1 = must(await request(`/structures/${structureId}/periods`, {
    method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }),
  }), 'POST /periods (M1)');
  const period1Id = period1.id ?? period1.period?.id;
  console.log('period1', JSON.stringify(period1));

  const granjaM1 = must(await request(`/structures/${structureId}/process/departments/${granja.id}/periods/${period1Id}/movement`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      initialWip: 0,
      startedInProduction: 270000,
      transferredOut: 270000,
      finalWip: 0,
      periodCostMp: 8280000,      // alimento 36.000 kg x $230,00
      periodCostMo: 0,
      periodCostCif: 10470000,    // resto del pool: amort $5.000.000 + CIP fijo + CV granja $1.500.000 + MOD (no desglosado, ver 03-backend.md)
      sourceArea: 'costista',
    }),
  }), 'PUT unit-movement Granja M1');

  const fracM1 = must(await request(`/structures/${structureId}/process/departments/${fraccionadora.id}/periods/${period1Id}/movement`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      initialWip: 0,
      receivedFromPrevious: 750.06, // WORKAROUND de AUD-2026-09-14-04: 1/360 no es exacto en Decimal(18,6)
      transferredOut: 700,
      totalLossReported: 20,       // 15 normal + 5 extraordinaria (se derivan)
      normalLossPct: 0.02,
      finalWip: 30.06, // WORKAROUND AUD-2026-09-14-04: el cuadro exige == 750.06 exacto
      finalWipMpAvance: 0,         // maples: 0% en la EF
      finalWipConvAvance: 0.60,    // CC: 60% en la EF
      periodCostMp: 2115000,       // maples $3.000,00 x equivalentes MP (705 = 700 term. + 5 extraord., EF al 0%)
      periodCostMo: 0,
      periodCostCif: 3447083,      // CC $4.767,75 x equivalentes CC (723)
      sourceArea: 'costista',
    }),
  }), 'PUT unit-movement Fraccionadora M1');

  const calc1 = must(await request(`/structures/${structureId}/process/periods/${period1Id}/calculate`, {
    method: 'POST', headers: auth(token), body: JSON.stringify({}),
  }), 'POST calculate M1');

  const frac = calc1.results.departments.find((d) => d.name === 'Fraccionadora');
  console.log('\n=== RESUMEN M1 vs anclas del fixture ===');
  console.log('costoModificado:', frac.transferredCost.costoModificado, 'ancla $25.000,00');
  console.log('CAUP:', frac.transferredCost.caup, 'ancla $510,20');
  console.log('costoTransferido (dpto anterior ajustado):', frac.transferredCost.costoTransferido, 'ancla $25.510,20');
  console.log('unitario total:', frac.report.costoUnitarioTotalAcumulado, 'ancla $33.277,95');
  console.log('a justificar:', frac.report.costoAcumuladoAJustificar, 'ancla $24.312.080,00');
  console.log('EF por diferencia:', frac.report.costoExistenciaFinalPorDiferencia, 'EF por elemento:', frac.report.valuacionExistenciaFinalPorElemento, '(deben coincidir entre si) ancla fixture $851.125,54');
  console.log('perdidas extraordinarias ($, separadas del costo del producto):', frac.report.costoPerdidasExtraordinarias);
  console.log('identidad CAUP (UAJ-PN)*(mod+CAUP) === costoTotal dpto anterior:', frac.transferredCost.unidadesBuenas * frac.transferredCost.costoTransferido, 'vs', frac.report.previousDepartment.costoTotal);

  const close1 = await request(`/periods/${period1Id}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  console.log(`\n${close1.status >= 200 && close1.status < 300 ? '✅' : '❌'} POST /periods/close M1 -> ${close1.status}`);
  console.log(JSON.stringify(close1.body, null, 2));
}

main().catch((err) => {
  console.error('\n💥', err.message);
  process.exit(1);
});
