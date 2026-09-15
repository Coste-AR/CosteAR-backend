// BLOQUE 4, parte 2 — mismos datos de bloque4-aud05-magnitud.mjs, ahora con
// Company.unidadGestionId seteado (vía la UnidadMedida sembrada a mano —
// seed-unidad-gestion.mjs — porque no existe endpoint que la cree).
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

const companyId = 'bfb27259-446c-4d0c-a09b-6ff272915fbd';
const structureId = '5e84acaa-714b-49ac-9ada-1df4d9ba798c';
const period1Id = '776cabf0-ec4d-4413-91ad-6626cedfa5b4';
const unidadGestionId = '1afa9cf2-3099-4842-b773-1156b16e79e2';

async function main() {
  const login = must(await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'aud-2026-09-16-bloque4-1789489664987@test.local', password: 'AuditoriaBloque4-2026' }) }), 'login');
  const token = login.accessToken;

  must(await request(`/companies/${companyId}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ unidadGestionId }) }), 'PUT company unidadGestionId=cajon');

  const tableroAhora = must(await request(`/periods/${period1Id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno (con unidad de gestión, clasificación YA reclasificada MOD=VARIABLE del script anterior)');
  console.log('\n=== TABLERO — con unidadGestion, clasificación actual (MOD ya VARIABLE) ===');
  console.log(JSON.stringify(tableroAhora, null, 2));

  // Volver a FIJO para capturar el "antes" real con unidad de gestión puesta.
  must(await request(`/companies/${companyId}/parametros-costeo/comportamiento_mano_obra_directa`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'FIJO', confirmado: true }) }), 'volver MOD=FIJO');
  const recalcAntes = await request(`/cost-structures/${structureId}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) });
  console.log('recalculate (MOD=FIJO, para el ANTES) ->', recalcAntes.status);
  const tableroAntes = must(await request(`/periods/${period1Id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno (ANTES, MOD=FIJO, con unidadGestion)');
  console.log('\n=== TABLERO — ANTES (MOD=FIJO) con unidadGestion ===');
  console.log(JSON.stringify(tableroAntes, null, 2));

  const tableroSinRecalcular = must(await request(`/periods/${period1Id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno otra vez, sin tocar nada (control: mismo run)');

  // Reclasificar de nuevo a VARIABLE, SIN recalcular todavía.
  must(await request(`/companies/${companyId}/parametros-costeo/comportamiento_mano_obra_directa`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ comportamientoVolumen: 'VARIABLE', confirmado: true }) }), 'reclasificar MOD=VARIABLE (M1 cerrado, SIN recalcular todavía)');
  const tableroReclasificadoSinRecalcular = must(await request(`/periods/${period1Id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno (reclasificado, SIN recalcular)');
  console.log('\n=== TABLERO — reclasificado a VARIABLE, SIN recalcular (debe seguir igual al ANTES: snapshot congelado) ===');
  console.log(JSON.stringify(tableroReclasificadoSinRecalcular, null, 2));

  const recalcDespues = must(await request(`/cost-structures/${structureId}/calculate`, { method: 'POST', headers: auth(token), body: JSON.stringify({}) }), 'recalcular M1 CERRADO con MOD ya VARIABLE');
  const tableroDespues = must(await request(`/periods/${period1Id}/tablero-dueno`, { headers: auth(token) }), 'GET tablero-dueno (DESPUÉS de recalcular con MOD=VARIABLE)');
  console.log('\n=== TABLERO — DESPUÉS de recalcular con MOD=VARIABLE ===');
  console.log(JSON.stringify(tableroDespues, null, 2));

  console.log('\n\n========== COMPARACIÓN FINAL ==========');
  const g = (t, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), t);
  for (const [label, t] of [['ANTES (MOD=FIJO)', tableroAntes], ['reclasificado SIN recalcular', tableroReclasificadoSinRecalcular], ['DESPUÉS de recalcular', tableroDespues]]) {
    console.log(`\n-- ${label} --`);
    console.log('  cv (costoPorCajon.variable):', g(t, 'costoPorCajon.variable.valor'));
    console.log('  cm (contribucionMarginalPorCajon):', g(t, 'contribucionMarginalPorCajon.valor'));
    console.log('  PE (puntoEquilibrioCajones):', g(t, 'puntoEquilibrioCajones.valor'));
    console.log('  resultadoPeriodo:', g(t, 'resultadoPeriodo.valor'));
    const cm = g(t, 'contribucionMarginalPorCajon.valor');
    console.log('  conversor $1.000.000 ->', cm ? (1000000 / cm).toFixed(2) : null, 'cajones');
  }
}
main().catch((e) => { console.error('💥', e.message, e.stack); process.exit(1); });
