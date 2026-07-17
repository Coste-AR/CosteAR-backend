const $ = (id) => document.getElementById(id);
let state = { token: null, companyId: null, structureId: null, dpCantidad: null, dpPrecio: null, dpPending: null };

$('apiBase').value = location.origin + '/api/v1';

function setStatus(id, msg, kind) {
  const el = $(id);
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

async function api(path, opts = {}) {
  const base = $('apiBase').value.replace(/\/$/, '');
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(base + path, Object.assign({}, opts, { headers }));
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error((body && body.error && body.error.message) || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function enable(...ids) { ids.forEach((id) => $(id).disabled = false); }

// --- 1. Login ---
$('btnLogin').onclick = async () => {
  setStatus('statusLogin', 'Conectando...');
  try {
    const r = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: $('identifier').value, password: $('password').value }),
    });
    state.token = r.data.accessToken;
    setStatus('statusLogin', 'OK — conectado como ' + r.data.user.name, 'ok');
    enable('btnSetup');
  } catch (e) {
    setStatus('statusLogin', 'Error: ' + e.message + (e.status ? ' (HTTP ' + e.status + ')' : ''), 'err');
  }
};

// --- 2. Setup: empresa + estructura + MP/MOD/CIP (mismo ejemplo que R5 "Piezas mecánicas") ---
$('btnSetup').onclick = async () => {
  setStatus('statusSetup', 'Creando...');
  try {
    const company = await api('/companies', { method: 'POST', body: JSON.stringify({ name: 'Demo Trazabilidad SA', industry: 'Metalúrgica' }) });
    state.companyId = company.data.id;

    const structure = await api(`/companies/${state.companyId}/cost-structures`, {
      method: 'POST',
      body: JSON.stringify({ productName: 'Pieza mecanizada', period: '2026-06', costingSystem: 'ORDERS' }),
    });
    state.structureId = structure.data.id;

    await api(`/cost-structures/${state.structureId}/raw-material`, {
      method: 'PUT',
      body: JSON.stringify({
        wilson: { annualDemand: 6000, orderCost: 5000, holdingRate: 0.3, unitCost: 1200 },
        stockPolicy: { minConsumption: 20, maxConsumption: 40, minLeadTime: 5, maxLeadTime: 12, safetyStock: 200 },
        initialStock: { quantity: 300, unitCost: 2400 },
        movements: [
          { date: '2026-06-05', type: 'purchase', detail: 'Compra acero', quantity: 1000, unitCost: 2600 },
          { date: '2026-06-15', type: 'consumption', detail: 'Orden de producción', quantity: 800 },
        ],
      }),
    });

    await api(`/cost-structures/${state.structureId}/direct-labor`, {
      method: 'PUT',
      body: JSON.stringify({
        workingDays: {
          totalDaysPerYear: 365,
          unpaidAbsence: { sundays: 52, saturdays: 52, unjustifiedAbsences: 2, holidaysOnWeekend: 3 },
          paidAbsence: { holidays: 12, vacations: 14, sickness: 6, specialLeaves: 2, workAccidents: 6 },
        },
        itcs: { derivationBase: 0.27, fixedArt: 0.015, uncertainRemunerative: [{ name: 'Premio', coefficient: 0.15 }], uncertainNonRemunerative: [] },
        departments: [
          { name: 'Mecanizado', basicRemuneration: 1500000, hoursWorked: 400 },
          { name: 'Terminado', basicRemuneration: 1200000, hoursWorked: 350 },
        ],
      }),
    });

    await api(`/cost-structures/${state.structureId}/indirect-costs`, {
      method: 'PUT',
      body: JSON.stringify({
        centers: [
          { id: 'mec', name: 'Mecanizado', type: 'productive' },
          { id: 'ter', name: 'Terminado', type: 'productive' },
        ],
        concepts: [{ name: 'Costos indirectos', amount: { fixed: 600000, variable: 300000 }, distribution: { mec: 60, ter: 40 } }],
        serviceDistributions: [],
        productiveSettings: [
          { centerId: 'mec', normalCapacity: 400, actualActivity: 400, actualCip: 400000 },
          { centerId: 'ter', normalCapacity: 350, actualActivity: 350, actualCip: 400000 },
        ],
      }),
    });

    await api(`/cost-structures/${state.structureId}/sales`, {
      method: 'PUT',
      body: JSON.stringify({ salesUnitPrice: 13250, salesQuantity: 800 }),
    });

    setStatus('statusSetup', 'Listo. structureId = ' + state.structureId, 'ok');
    enable('btnCalc', 'btnRuns', 'btnCreateDp', 'btnPendingDp', 'btnAudit');
  } catch (e) {
    setStatus('statusSetup', 'Error: ' + e.message, 'err');
  }
};

// --- 3. Calcular + árbol ---
function renderTree(nodes, container) {
  container.innerHTML = '';
  for (const node of nodes) container.appendChild(renderNode(node));
}
function renderNode(node) {
  const wrap = document.createElement('div');
  wrap.className = 'tree-node';
  const row = document.createElement('div');
  row.className = 'tree-row';
  const hasChildren = node.children && node.children.length > 0;
  row.innerHTML = `
    <span class="chevron">${hasChildren ? '▶' : ''}</span>
    <span class="tree-label">${node.label}</span>
    <span class="tree-formula">${node.formula || ''}</span>
    <span class="tree-value">${fmtVal(node.value, node.unit)}</span>
  `;
  const childrenWrap = document.createElement('div');
  childrenWrap.className = 'tree-children';
  if (hasChildren) {
    for (const c of node.children) childrenWrap.appendChild(renderNode(c));
    row.onclick = () => {
      childrenWrap.classList.toggle('open');
      row.querySelector('.chevron').textContent = childrenWrap.classList.contains('open') ? '▼' : '▶';
    };
  }
  wrap.appendChild(row);
  wrap.appendChild(childrenWrap);
  return wrap;
}
function fmtVal(v, unit) {
  if (v == null) return '—';
  const n = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(v);
  if (unit === '$') return '$ ' + n;
  return n + (unit ? ' ' + unit : '');
}

$('btnCalc').onclick = async () => {
  setStatus('statusCalc', 'Calculando...');
  try {
    const r = await api(`/structures/${state.structureId}/calculate`, { method: 'POST', body: '{}' });
    setStatus(
      'statusCalc',
      `OK — run #${r.data.runN} · Margen $ ${r.data.results.grossMargin.toLocaleString('es-AR')} (${r.data.results.grossMarginPct.toFixed(2)}%)`,
      'ok',
    );
    renderTree(r.data.tree, $('tree'));
  } catch (e) {
    setStatus('statusCalc', `Error ${e.status || ''}: ${e.message}`, 'err');
  }
};

$('btnRuns').onclick = async () => {
  const r = await api(`/structures/${state.structureId}/runs`);
  const rows = r.data.map((run) => `<tr><td>#${run.runN}</td><td>${run.engineVersion}</td><td>${run.executedBy}</td><td>${new Date(run.executedAt).toLocaleString('es-AR')}</td><td>$ ${(run.grossMargin ?? 0).toLocaleString('es-AR')}</td></tr>`).join('');
  $('runsList').innerHTML = `<table><thead><tr><th>Run</th><th>Motor</th><th>Ejecutado por</th><th>Cuándo</th><th>Margen</th></tr></thead><tbody>${rows}</tbody></table>`;
};

// --- 4. TraceCard ---
$('btnCreateDp').onclick = async () => {
  setStatus('statusTrace', 'Creando compra de ejemplo...');
  try {
    const movementId = 'mov-' + Date.now();
    const cantidad = await api(`/structures/${state.structureId}/data-points`, {
      method: 'POST',
      body: JSON.stringify({
        element: 'MP', fieldKey: 'mp.compra.cantidad', label: 'Compra de acero — Proveedor Central',
        unit: 'u', sourceArea: 'deposito', method: 'portal_operador',
        valueNum: 1000, valueJson: { movementId, role: 'cantidad' }, fechaHecho: '2026-06-05',
      }),
    });
    const precio = await api(`/structures/${state.structureId}/data-points`, {
      method: 'POST',
      body: JSON.stringify({
        element: 'MP', fieldKey: 'mp.compra.precio', label: 'Compra de acero — Proveedor Central',
        unit: '$', sourceArea: 'contaduria', method: 'manual',
        valueNum: 2600, valueJson: { movementId, role: 'precio' }, fechaHecho: '2026-06-05',
      }),
    });
    state.dpCantidad = cantidad.data.id;
    state.dpPrecio = precio.data.id;
    setStatus('statusTrace', 'Creados. Click abajo para ver la ficha.', 'ok');
    enable('btnValidate', 'btnRevision');
    await loadTrace(state.dpCantidad);
  } catch (e) {
    setStatus('statusTrace', 'Error: ' + e.message, 'err');
  }
};

async function loadTrace(id) {
  const r = await api(`/data-points/${id}/trace`);
  renderTraceCard(r.data, $('traceCard'));
}

function renderTraceCard(t, container) {
  const fields = t.fields.map((f) => `
    <div class="field-cell">
      <div class="k">${f.key}</div>
      <div class="v">${fmtVal(f.value, f.unit)}</div>
      <div class="meta">${f.by.name} · ${f.by.role} · ${f.by.area} · ${new Date(f.at).toLocaleString('es-AR')} · ${f.method}</div>
    </div>`).join('');
  const versions = t.versions.map((v) => `
    <div class="v-row ${v.current ? '' : 'old'}">
      v${v.n} <span class="val">${v.display}</span> ${v.reason ? '— ' + v.reason : ''} — ${v.by}, ${new Date(v.at).toLocaleString('es-AR')}
    </div>`).join('');
  container.innerHTML = `
    <div class="trace-card">
      <div><strong>${t.label}</strong> <span class="pill pill-${t.status}">${t.status}</span></div>
      <div class="display">${t.display}</div>
      ${t.signedBy ? `<div class="meta">Firmado por ${t.signedBy.name} (${t.signedBy.role}) — ${new Date(t.signedBy.at).toLocaleString('es-AR')}</div>` : ''}
      <div class="fields-grid">${fields}</div>
      <div class="versions-list"><strong>Versiones</strong>${versions}</div>
      <div class="impacts">Impacta en: ${t.impacts.map((i) => `<span>${i}</span>`).join('')}</div>
      <code class="id">${t.id}</code>
    </div>`;
}

$('btnValidate').onclick = async () => {
  await api(`/data-points/${state.dpCantidad}/validate`, { method: 'POST', body: JSON.stringify({ sourceArea: 'costista' }) });
  await loadTrace(state.dpCantidad);
  setStatus('statusTrace', 'Validado.', 'ok');
};
$('btnRevision').onclick = async () => {
  await api(`/data-points/${state.dpCantidad}/pedir-revision`, { method: 'POST', body: JSON.stringify({ sourceArea: 'costista', comment: 'Revisar con el proveedor' }) });
  setStatus('statusTrace', 'Pedido de revisión registrado en la bitácora.', 'ok');
};

// --- 5. Doble período ---
$('btnPendingDp').onclick = async () => {
  const r = await api(`/structures/${state.structureId}/data-points`, {
    method: 'POST',
    body: JSON.stringify({ element: 'CIP', fieldKey: 'cip.gasto.sin-imputar', label: 'Gasto de fin de mes (sin imputar)', unit: '$', sourceArea: 'planta', method: 'manual', valueNum: 50000, fechaHecho: '2026-07-02' }),
  });
  state.dpPending = r.data.id;
  setStatus('statusImputacion', 'Dato creado sin período imputado: ' + state.dpPending, 'ok');
  enable('btnCalcBlocked', 'btnImputar');
};
$('btnCalcBlocked').onclick = async () => {
  try {
    await api(`/structures/${state.structureId}/calculate`, { method: 'POST', body: '{}' });
    setStatus('statusImputacion', 'No debería haber llegado acá — revisá el gating.', 'err');
  } catch (e) {
    setStatus('statusImputacion', `Bloqueado como se esperaba — HTTP ${e.status} ${e.body?.error?.code}: ${e.message}`, 'ok');
  }
};
$('btnImputar').onclick = async () => {
  await api(`/data-points/${state.dpPending}/imputacion`, { method: 'POST', body: JSON.stringify({ sourceArea: 'costista', periodo: $('periodoInput').value }) });
  const r = await api(`/structures/${state.structureId}/calculate`, { method: 'POST', body: '{}' });
  setStatus('statusImputacion', `Imputado y recalculado — run #${r.data.runN}.`, 'ok');
};

// --- 6. Auditoría ---
$('btnAudit').onclick = async () => {
  const r = await api(`/structures/${state.structureId}/audit?page=1&pageSize=50`);
  const rows = r.data.items.map((it) => `<tr><td>${it.action}</td><td>${it.entityType}</td><td>${it.actor.name} (${it.actor.role}/${it.actor.area})</td><td>${new Date(it.at).toLocaleString('es-AR')}</td><td>${it.comment || ''}</td></tr>`).join('');
  const latency = r.data.latencyByArea.map((l) => `<tr><td>${l.area}</td><td>${l.avgDays} días</td><td>${l.count} dato(s)</td></tr>`).join('');
  $('auditOut').innerHTML = `
    <h3 class="subheading">Latencia de captación por área</h3>
    <table><thead><tr><th>Área</th><th>Promedio</th><th>Muestras</th></tr></thead><tbody>${latency || '<tr><td colspan=3>Sin datos con fecha_hecho todavía</td></tr>'}</tbody></table>
    <h3 class="subheading spaced">Bitácora (${r.data.total} entradas)</h3>
    <table><thead><tr><th>Acción</th><th>Entidad</th><th>Actor</th><th>Cuándo</th><th>Comentario</th></tr></thead><tbody>${rows}</tbody></table>
  `;
};
