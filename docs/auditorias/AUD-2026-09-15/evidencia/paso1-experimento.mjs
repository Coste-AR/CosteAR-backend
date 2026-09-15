// PASO 1 — experimento controlado sobre AUD-2026-09-14-04a.
// Mismo endpoint, mismo flujo (process-setup -> movement -> calculate), dos
// conversiones distintas:
//   a) 1/50  (kg -> bolsa de 50 kg)  = 0,02 EXACTO en Decimal(18,6)
//   b) 1/360 (huevo -> cajon)        = 0,00277... periodica, YA CONFIRMADO que falla
//
// Si (a) carga y (b) sigue fallando: PROBADO que 04a es representabilidad del
// factor, no una falla general del motor de procesos.
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

async function nuevoUsuario(prefix) {
  const terms = await request('/terms/current');
  const email = `${prefix}-${Date.now()}@test.local`;
  const password = 'AuditoriaFxAv2026';
  const cuit = String(Date.now()).padStart(11, '0').slice(0, 11);
  await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email, password, name: 'Auditor PASO1', cuit, professionalType: 'OTRO',
      acceptedTerms: true, termsVersionId: terms.body.data.id,
    }),
  });
  const login = await request('/auth/login', {
    method: 'POST', body: JSON.stringify({ identifier: email, password }),
  });
  return login.body.data.accessToken;
}

async function correr(nombre, { unitAnterior, unitNueva, factor, transferido, periodCostAnteriorMp, periodCostNuevaMp }) {
  console.log(`\n=== ${nombre} (factor ${factor} = ${factor}) ===`);
  const token = await nuevoUsuario('paso1');

  const company = await request('/companies', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ name: `PASO1 ${nombre}`, periodicity: 'MONTHLY' }),
  });
  const companyId = company.body.data.id;

  const structure = await request(`/companies/${companyId}/cost-structures`, {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({ productName: nombre, period: '2026-01', costingSystem: 'PROCESSES' }),
  });
  const structureId = structure.body.data.id;

  const setup = await request(`/structures/${structureId}/process-setup`, {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
      departments: [
        { name: 'Anterior', sequence: 1, unit: unitAnterior },
        { name: 'Nueva', sequence: 2, unit: unitNueva, conversionFromPrevious: factor },
      ],
      hasJointProducts: false,
    }),
  });
  console.log('setup ->', setup.status);
  if (setup.status < 200 || setup.status >= 300) {
    console.log(JSON.stringify(setup.body, null, 2));
    return { nombre, factor, setupOk: false };
  }

  const depts = await request(`/structures/${structureId}/process/departments`, { headers: auth(token) });
  const list = Array.isArray(depts.body.data) ? depts.body.data : (depts.body.data.departments ?? depts.body.data.items ?? []);
  const anterior = list.find((d) => d.name === 'Anterior');
  const nueva = list.find((d) => d.name === 'Nueva');
  console.log('factor guardado (GET process-setup):', anterior && nueva ? 'ver detalle abajo' : 'no encontrado');
  const setupGet = await request(`/structures/${structureId}/process-setup`, { headers: auth(token) });
  console.log('conversionFromPrevious guardado:', JSON.stringify(setupGet.body?.data?.departments?.find((d) => d.name === 'Nueva')?.conversionFromPrevious ?? setupGet.body));

  const period = await request(`/structures/${structureId}/periods`, {
    method: 'POST', headers: auth(token), body: JSON.stringify({ carryAmounts: false }),
  });
  const periodId = period.body.data.id ?? period.body.data.period?.id;

  const esperado = transferido * factor;
  console.log(`transferido=${transferido} x factor=${factor} = esperado exacto ${transferido * factor}; cargamos receivedFromPrevious=${esperado} redondeado a lo que el usuario mediría`);

  await request(`/structures/${structureId}/process/departments/${anterior.id}/periods/${periodId}/movement`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      initialWip: 0, startedInProduction: transferido, transferredOut: transferido, finalWip: 0,
      periodCostMp: periodCostAnteriorMp, periodCostMo: 0, periodCostCif: 0, sourceArea: 'costista',
    }),
  });

  // El usuario carga lo que MIDIÓ en la planta (el resultado exacto de la
  // conversion tal como la calcularía a mano), no lo que el sistema espera
  // internamente — eso es justamente lo que 04a pone a prueba.
  const recibidoMedido = Math.round(esperado * 1e6) / 1e6;
  const movNueva = await request(`/structures/${structureId}/process/departments/${nueva.id}/periods/${periodId}/movement`, {
    method: 'PUT', headers: auth(token),
    body: JSON.stringify({
      initialWip: 0, receivedFromPrevious: recibidoMedido, transferredOut: recibidoMedido, finalWip: 0,
      periodCostMp: periodCostNuevaMp, periodCostMo: 0, periodCostCif: 0, sourceArea: 'costista',
    }),
  });
  console.log('PUT movement Nueva ->', movNueva.status);

  const calc = await request(`/structures/${structureId}/process/periods/${periodId}/calculate`, {
    method: 'POST', headers: auth(token), body: JSON.stringify({}),
  });
  console.log('POST calculate ->', calc.status);
  console.log(JSON.stringify(calc.body, null, 2));

  return { nombre, factor, transferido, esperado, recibidoMedido, calculateStatus: calc.status, calculateBody: calc.body };
}

async function main() {
  const a = await correr('A - kg a bolsa (1/50 EXACTO)', {
    unitAnterior: 'kg', unitNueva: 'bolsa', factor: 1 / 50,
    transferido: 1000, periodCostAnteriorMp: 230000, periodCostNuevaMp: 24000,
  });

  const b = await correr('B - huevo a cajon (1/360 PERIODICA, ya confirmado que falla)', {
    unitAnterior: 'huevo', unitNueva: 'cajon', factor: 1 / 360,
    transferido: 3600, periodCostAnteriorMp: 828000, periodCostNuevaMp: 30000,
  });

  console.log('\n\n========== RESULTADO DEL EXPERIMENTO ==========');
  console.log(`(a) 1/50  -> calculate ${a.calculateStatus} (${a.calculateStatus === 200 ? 'CARGA' : 'FALLA'})`);
  console.log(`(b) 1/360 -> calculate ${b.calculateStatus} (${b.calculateStatus === 200 ? 'CARGA' : 'FALLA'})`);
  if (a.calculateStatus === 200 && b.calculateStatus !== 200) {
    console.log('PROBADO: 04a es representabilidad del factor decimal, no falla general del motor de procesos.');
  } else if (a.calculateStatus !== 200) {
    console.log('EL DEFECTO ES MAS GRANDE DE LO QUE DICE LA FICHA: incluso una conversion EXACTA (1/50) falla.');
  }
}

main().catch((err) => { console.error('💥', err); process.exit(1); });
