// PASO 4 — period-comparison contra la serie FX-AV-B (M1..M4 cerrados).
import { cargarFxAvB } from './paso2-fxavb-m1-m4.mjs';
const BASE_URL = 'http://127.0.0.1:3001/api/v1';
async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
function auth(token) { return { authorization: `Bearer ${token}` }; }

async function main() {
  const { token, structureId, periodos } = await cargarFxAvB();

  console.log('\n\n########## PASO 4 — /structures/:id/periods/compare ##########');

  const sinParams = await request(`/structures/${structureId}/periods/compare`, { headers: auth(token) });
  console.log('\n-- Sin params (default: los dos últimos) -> ', sinParams.status);
  console.log(JSON.stringify(sinParams.body, null, 2));

  const m1m2 = await request(`/structures/${structureId}/periods/compare?from=2026-01&to=2026-02`, { headers: auth(token) });
  console.log('\n-- from=2026-01&to=2026-02 (M1 vs M2) -> ', m1m2.status);
  console.log(JSON.stringify(m1m2.body, null, 2));

  console.log('\n-- Reabro M4 y comparo M3(cerrado) vs M4(abierto) para ver "source":"recomputed" y el warning --');
  const m4 = periodos.find((p) => p.p === 'M4');
  const reopen = await request(`/periods/${m4.id}/reopen`, { method: 'POST', headers: auth(token), body: JSON.stringify({ reason: 'PASO 4 — auditoría AUD-2026-09-15, comparar contra período abierto' }) });
  console.log('  reopen M4 ->', reopen.status);
  const m3m4abierto = await request(`/structures/${structureId}/periods/compare?from=2026-03&to=2026-04`, { headers: auth(token) });
  console.log('  compare M3 vs M4(abierto) ->', m3m4abierto.status);
  console.log(JSON.stringify(m3m4abierto.body, null, 2));
}
main().catch((e) => { console.error('💥', e); process.exit(1); });
