const BASE_URL = 'http://127.0.0.1:3001/api/v1';
async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
function auth(token) { return { authorization: `Bearer ${token}` }; }
async function freshToken(suffix) {
  const terms = (await request('/terms/current')).body.data;
  const email = `aud-p12-${suffix}-${Date.now()}@test.local`;
  const cuit = String(Date.now()).padStart(11, '0').slice(-11);
  await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'AuditoriaP12-2026', name: 'Auditor aislamiento', cuit, professionalType: 'OTRO', acceptedTerms: true, termsVersionId: terms.id }) });
  const login = await request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password: 'AuditoriaP12-2026' }) });
  return login.body.data.accessToken;
}
async function main() {
  const tokenA = await freshToken('A');
  const company = (await request('/companies', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ name: 'Empresa A aislamiento', periodicity: 'MONTHLY' }) })).body.data;
  const structure = (await request(`/companies/${company.id}/cost-structures`, { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ productName: 'Producto A', period: '2026-01', costingSystem: 'PROCESSES' }) })).body.data;

  const tokenB = await freshToken('B');
  console.log('=== Aislamiento entre empresas (P-12) ===');
  const crossStructures = await request(`/companies/${company.id}/cost-structures`, { headers: auth(tokenB) });
  console.log('B lee /companies/A/cost-structures ->', crossStructures.status, JSON.stringify(crossStructures.body).slice(0, 150));
  const crossDirect = await request(`/structures/${structure.id}/process/departments`, { headers: auth(tokenB) });
  console.log('B lee /structures/(deA)/process/departments ->', crossDirect.status, JSON.stringify(crossDirect.body).slice(0, 150));
  const crossCompanyRead = await request(`/companies/${company.id}`, { headers: auth(tokenB) });
  console.log('B lee /companies/(deA) directo ->', crossCompanyRead.status, JSON.stringify(crossCompanyRead.body).slice(0, 150));
}
main().catch((e) => { console.error('💥', e.message); process.exit(1); });
