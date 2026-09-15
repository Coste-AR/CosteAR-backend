// PASO 2 — FX-AV-B por API: Planta (kg) -> Embolsado (bolsa 50kg), M1..M4,
// cerrando cada uno antes de abrir el siguiente (flujo normal). Los inputs
// numericos salen de dump_paso2_inputs.py (que reusa calc_fx_av.py, fuente
// unica de verdad, aritmetica exacta con Fraction).
const BASE_URL = 'http://127.0.0.1:3000/api/v1';

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
function cmp(label, real, esperado, tol = 0.02) {
  const r = Number(real), e = Number(esperado);
  const ok = Math.abs(r - e) <= tol;
  console.log(`  ${ok ? '✓' : '✗ DIFIERE'} ${label}: real=${r} ancla=${e}${ok ? '' : `  <<<< diff=${(r - e).toFixed(6)}`}`);
  return ok;
}

// ── Inputs exactos, del dump de calc_fx_av.py (D1 = Planta, EMB = Embolsado) ──
const D1 = [
  { p: 'M1', puesta: 120000, pn: 2400, finU: 9600, consumoGranja: 36000, mpPer: 23520000, ccPer: 3384000, uTot: 230.00 },
  { p: 'M2', puesta: 120000, pn: 2400, finU: 7200, consumoGranja: 34800, mpPer: 26064000, ccPer: 3811200, uTot: 252.00 },
  { p: 'M3', puesta: 130000, pn: 2600, finU: 8000, consumoGranja: 50400, mpPer: 31200000, ccPer: 4455800, uTot: 278.5661218424963 },
  { p: 'M4', puesta: 130000, pn: 2600, finU: 6000, consumoGranja: 51600, mpPer: 26650000, ccPer: 4626400, uTot: 247.21513275288012 },
];
const D1_AJUST = [26904000, 31939200, 37355000, 33364928.97];
const D1_EF = [2064000, 1699200, 2088528.97, 1375290.80];
const D1_EF_MP = [1920000, null, null, null]; // solo M1 con ancla explicita del usuario
const D1_EF_CC = [144000, null, null, null];

const EMB = [
  { p: 'M1', pn: 12, extra: 0, finU: 40, recibidas: 1440, term: 1388, mpPer: 1665600, ccPer: 1322400, modificado: 11500.00, caup: 96.64, unitario: 13735.84 },
  { p: 'M2', pn: 14, extra: 0, finU: 35, recibidas: 1704, term: 1695, mpPer: 2034000, ccPer: 1413750, modificado: 12576.99, caup: 101.78, unitario: 14715.28 },
  { p: 'M3', pn: 13, extra: 6, finU: 50, recibidas: 1524, term: 1490, mpPer: 1795200, ccPer: 1406300, modificado: 13900.25, caup: 116.88, unitario: 16151.35 },
  { p: 'M4', pn: 13, extra: 0, finU: 45, recibidas: 1556, term: 1548, mpPer: 1857600, ccPer: 1421150, modificado: 12412.33, caup: 101.29, unitario: 14633.39 },
];
const EMB_AJUST = [19548000, 25400799.64, 24886634.34, 23236299.57];
const EMB_EF = [482649.64, 458395.85, 724212.24, 583807.75];

export async function cargarFxAvB() {
  const terms = must(await request('/terms/current'), 'GET /terms/current');
  const email = `aud-2026-09-15-paso2-${Date.now()}@test.local`;
  const password = 'AuditoriaFxAvB2026';
  const cuit = String(Date.now()).padStart(11, '0').slice(0, 11);
  console.log('CREDENCIALES:', email, password);
  await must(await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name: 'Auditor FX-AV-B', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }),
  }), 'POST /auth/register');
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password }) }), 'POST /auth/login');
  const token = login.accessToken;

  const company = must(await request('/companies', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ name: 'FX-AV-B Planta-Embolsado (auditoria AUD-2026-09-15)', periodicity: 'MONTHLY' }),
  }), 'POST /companies');
  const companyId = company.id;

  const structure = must(await request(`/companies/${companyId}/cost-structures`, {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ productName: 'Alimento embolsado (FX-AV-B)', period: '2026-01', costingSystem: 'PROCESSES' }),
  }), 'POST /cost-structures');
  const structureId = structure.id;

  must(await request(`/structures/${structureId}/process-setup`, {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
      departments: [
        { name: 'Planta', sequence: 1, unit: 'kg' },
        { name: 'Embolsado', sequence: 2, unit: 'bolsa', conversionFromPrevious: 1 / 50 },
      ],
      hasJointProducts: false,
    }),
  }), 'POST /process-setup');

  const depts = must(await request(`/structures/${structureId}/process/departments`, { headers: auth(token) }), 'GET departments');
  const list = Array.isArray(depts) ? depts : (depts.departments ?? depts.items ?? []);
  const planta = list.find((d) => d.name === 'Planta');
  const embolsado = list.find((d) => d.name === 'Embolsado');
  console.log('plantaId', planta.id, 'embolsadoId', embolsado.id);

  const resultados = [];

  for (let i = 0; i < 4; i++) {
    const d1 = D1[i], emb = EMB[i];
    console.log(`\n\n########## ${d1.p} ##########`);

    // ── Abrir período ────────────────────────────────────────────────────
    const period = must(await request(`/structures/${structureId}/periods`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: i > 0 }),
    }), `POST /periods (${d1.p})`);
    const periodId = period.id ?? period.period?.id;

    // ── Inspeccionar el arrastre automático ANTES de tocar nada (solo desde M2) ──
    if (i > 0) {
      const carryPlanta = must(await request(`/structures/${structureId}/process/departments/${planta.id}/periods/${periodId}/movement`, { headers: auth(token) }), `GET movement Planta ${d1.p} (post-carry)`);
      const carryEmb = must(await request(`/structures/${structureId}/process/departments/${embolsado.id}/periods/${periodId}/movement`, { headers: auth(token) }), `GET movement Embolsado ${d1.p} (post-carry)`);
      console.log('  --- arrastre automático Planta ---', JSON.stringify(carryPlanta));
      console.log('  --- arrastre automático Embolsado ---', JSON.stringify(carryEmb));
      const sp = carryPlanta.saved, se = carryEmb.saved;
      const prevD1 = D1[i - 1], prevEmb = EMB[i - 1];
      cmp(`Planta.initialWip == EF de ${prevD1.p}`, sp.initialWip, prevD1.finU);
      cmp(`Embolsado.initialWip == EF de ${prevEmb.p}`, se.initialWip, prevEmb.finU);
      if (D1_EF_MP[i - 1] != null) {
        cmp(`Planta.initialWipCostMp == EF-MP de ${prevD1.p} (arrastre B18)`, sp.initialWipCostMp, D1_EF_MP[i - 1]);
        cmp(`Planta.initialWipCostCif == EF-CC de ${prevD1.p} (arrastre B18)`, sp.initialWipCostCif, D1_EF_CC[i - 1]);
      }
      console.log(`  Embolsado.initialWipCostPrevDept (arrastre del costo del dpto. anterior embebido en la EI) = ${se.initialWipCostPrevDept}`);
      console.log(`  Embolsado.initialWipCostCif (arrastre CC) = ${se.initialWipCostCif}`);
    }

    // ── Planta: solo los campos del período (el arrastre no se pisa) ──────
    const normalLossPctPlanta = d1.pn / d1.puesta; // 0,02 exacto siempre
    const movPlanta = await request(`/structures/${structureId}/process/departments/${planta.id}/periods/${periodId}/movement`, {
      method: 'PUT', headers: auth(token),
      body: JSON.stringify({
        ...(i === 0 ? { initialWip: 0 } : {}),
        startedInProduction: d1.puesta,
        finishedInStock: d1.consumoGranja, // se lo "consume" la Granja, no modelada esta sesion
        transferredOut: emb.recibidas * 50, // = kg a terceros -> Embolsado
        finalWip: d1.finU,
        normalLossPct: normalLossPctPlanta,
        totalLossReported: d1.pn,
        finalWipMpAvance: 1,
        finalWipConvAvance: 0.5,
        periodCostMp: d1.mpPer,
        periodCostMo: 0,
        periodCostCif: d1.ccPer,
        sourceArea: 'costista',
      }),
    });
    console.log(`PUT movement Planta ${d1.p} ->`, movPlanta.status);
    if (movPlanta.status >= 300) console.log(JSON.stringify(movPlanta.body, null, 2));

    // ── Embolsado: idem, solo campos del período ───────────────────────────
    const periodUnitsEmb = emb.recibidas; // seq>1: periodUnits = receivedFromPrevious
    // WORKAROUND declarado — AUD-2026-09-15-01, misma familia que AUD-04a:
    // `ProcessDepartment.normalLossPct` es Decimal(9,4) (schema.prisma:1850),
    // 4 decimales. pn/periodUnits es periodico (ej. 13/1556) y Postgres REDONDEA
    // al guardar: 0,008354755... -> 0,0084 (no trunca). Con ese valor guardado,
    // normalLoss(1556 x 0,0084=13,0704) > totalLossReported(13) real ->
    // extraordinaryLoss NEGATIVO -> 422 SIN tolerancia (peor que 04b, que al
    // menos tiene 1e-4). Reproducido en vivo dos veces: M2 y M4 (ver
    // paso2-run1-FALLA-extraordinaria-negativa.log y paso2-output.log de esta
    // corrida). Acá se trunca (no redondea) a los mismos 4 decimales de la
    // columna para evitar el overshoot — WYSIWYG con lo que la DB va a guardar.
    const normalLossPctEmb = Math.floor((emb.pn / periodUnitsEmb) * 1e4) / 1e4;
    const movEmb = await request(`/structures/${structureId}/process/departments/${embolsado.id}/periods/${periodId}/movement`, {
      method: 'PUT', headers: auth(token),
      body: JSON.stringify({
        ...(i === 0 ? { initialWip: 0 } : {}),
        receivedFromPrevious: emb.recibidas,
        transferredOut: emb.term,
        finalWip: emb.finU,
        normalLossPct: normalLossPctEmb,
        totalLossReported: emb.pn + emb.extra,
        finalWipMpAvance: 0,   // la bolsa (rafia+cosido) se incorpora al terminar
        finalWipConvAvance: 0.5,
        periodCostMp: emb.mpPer,
        periodCostMo: 0,
        periodCostCif: emb.ccPer,
        sourceArea: 'costista',
      }),
    });
    console.log(`PUT movement Embolsado ${d1.p} ->`, movEmb.status);
    if (movEmb.status >= 300) console.log(JSON.stringify(movEmb.body, null, 2));

    // ── Calcular ────────────────────────────────────────────────────────
    const calc = await request(`/structures/${structureId}/process/periods/${periodId}/calculate`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({}),
    });
    console.log(`POST calculate ${d1.p} ->`, calc.status);
    if (calc.status >= 300) {
      console.log(JSON.stringify(calc.body, null, 2));
      throw new Error(`calculate falló en ${d1.p}`);
    }
    const deptsRes = calc.body.data.results.departments;
    const plantaRes = deptsRes.find((d) => d.name === 'Planta');
    const embRes = deptsRes.find((d) => d.name === 'Embolsado');

    console.log(`\n--- ${d1.p} vs anclas ---`);
    cmp('Planta u.total ($/kg)', plantaRes.report.costoUnitarioTotalAcumulado, d1.uTot);
    cmp('Planta a justificar', plantaRes.report.costoAcumuladoAJustificar, D1_AJUST[i]);
    cmp('Planta existencia final', plantaRes.report.valuacionExistenciaFinalPorElemento, D1_EF[i]);
    cmp('Embolsado modificado', embRes.transferredCost.costoModificado, emb.modificado);
    cmp('Embolsado CAUP', embRes.transferredCost.caup, emb.caup);
    cmp('Embolsado unitario total', embRes.report.costoUnitarioTotalAcumulado, emb.unitario);
    cmp('Embolsado a justificar', embRes.report.costoAcumuladoAJustificar, EMB_AJUST[i]);
    cmp('Embolsado existencia final', embRes.report.valuacionExistenciaFinalPorElemento, EMB_EF[i]);

    resultados.push({ periodo: d1.p, periodId, plantaRes, embRes });

    // ── Cerrar ──────────────────────────────────────────────────────────
    const close = await request(`/periods/${periodId}/close`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
    console.log(`POST close ${d1.p} ->`, close.status);
    if (close.status >= 300) { console.log(JSON.stringify(close.body, null, 2)); throw new Error(`close falló en ${d1.p}`); }
  }

  console.log('\n\n========== RESUMEN FINAL ==========');
  const resumen = { token, companyId, structureId, planta, embolsado, periodos: resultados.map(r => ({ p: r.periodo, id: r.periodId, plantaRes: r.plantaRes, embRes: r.embRes })) };
  console.log(JSON.stringify({ companyId, structureId, plantaId: planta.id, embolsadoId: embolsado.id, periodos: resumen.periodos.map(p => ({ p: p.p, id: p.id })) }, null, 2));
  return resumen;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain || process.argv[1]?.endsWith('paso2-fxavb-m1-m4.mjs')) {
  cargarFxAvB().catch((err) => { console.error('\n💥', err); process.exit(1); });
}
