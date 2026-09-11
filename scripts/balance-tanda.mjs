#!/usr/bin/env node
/**
 * Balance verificable de una tanda de PRs.
 *
 * Lee GitHub con `gh`, no bitacoras escritas a mano. Los tokens permanecen
 * declaradamente ausentes hasta que la herramienta los exponga al agente.
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const REPOS_DE_COSTEAR = [
  'Coste-AR/CosteAR-backend',
  'Coste-AR/CosteAR-frontend',
  'Coste-AR/CosteAR-admin',
  'Coste-AR/CosteAR-os',
];

const CI_WORKFLOW = /(?:^|[ _-])(ci|e2e)(?:$|[ _-])|playwright/i;

function parseJson(texto, contexto) {
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(`GitHub devolvio JSON invalido al leer ${contexto}.`);
  }
}

function fechaDeDia(dia, fin = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error(`Fecha invalida: ${dia}. Usa AAAA-MM-DD.`);
  const fecha = new Date(`${dia}T00:00:00.000Z`);
  if (Number.isNaN(fecha.valueOf())) throw new Error(`Fecha invalida: ${dia}.`);
  if (fin) fecha.setUTCDate(fecha.getUTCDate() + 1);
  return fecha;
}

function dentroDelRango(fecha, inicio, fin) {
  const valor = new Date(fecha).valueOf();
  return valor >= inicio.valueOf() && valor < fin.valueOf();
}

function duracion(inicio, fin) {
  if (!inicio || !fin) return 'no medible: falta fecha';
  const ms = new Date(fin).valueOf() - new Date(inicio).valueOf();
  if (!Number.isFinite(ms) || ms < 0) return 'no medible: fechas inconsistentes';
  const minutos = Math.round(ms / 60_000);
  return `${Math.floor(minutos / 60)}h ${minutos % 60}m`;
}

function celda(valor) {
  return String(valor ?? 'ausente').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function mensajeDeError(error) {
  const texto = String(error?.stderr ?? error?.message ?? error);
  return /\b(401|403)\b|resource not accessible|forbidden|bad credentials/i.test(texto)
    ? 'sin permisos'
    : texto.replaceAll(/\s+/g, ' ').trim();
}

async function gh(args) {
  const { stdout } = await execFileAsync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    // El balance es diagnóstico: una API lenta tiene que hacerse visible como
    // hueco, no dejar la tanda colgada sin ningún resultado.
    timeout: 15_000,
  });
  return stdout;
}

async function eventosDelIssue(path, run) {
  const cuerpo = parseJson(await run(['api', `${path}?per_page=100&page=1`]), path);
  if (!Array.isArray(cuerpo)) throw new Error(`Respuesta inesperada de GitHub al leer ${path}.`);
  // Para calcular `listo` hay que recorrer toda la historia. Si no entra en
  // una pagina, el dato deja de ser barato y el script lo declara ausente: no
  // pagina cientos de comentarios ni toma la primera pagina como historia.
  if (cuerpo.length === 100) throw new Error('mas de 100 eventos en el issue');
  return cuerpo;
}

async function corridasDelCommit(repo, oid, run) {
  const query = new URLSearchParams({ event: 'pull_request', head_sha: oid, per_page: '100' });
  const respuesta = parseJson(await run(['api', `repos/${repo}/actions/runs?${query}`]), `corridas de ${oid}`);
  const corridas = respuesta.workflow_runs;
  if (!Array.isArray(corridas)) throw new Error(`Respuesta inesperada de GitHub al leer corridas de ${oid}.`);
  // Cien workflows para un unico SHA no son una medida: son un limite de API.
  // Se declara el hueco en vez de paginar historia ajena durante minutos.
  if (respuesta.total_count > corridas.length) throw new Error('mas de 100 corridas para un commit');
  return corridas;
}

async function commitsDelPr(repo, numero, run) {
  const respuesta = parseJson(await run(['api', `repos/${repo}/pulls/${numero}/commits?per_page=100&page=1`]), `commits de PR #${numero}`);
  if (!Array.isArray(respuesta)) throw new Error(`Respuesta inesperada de GitHub al leer commits de PR #${numero}.`);
  if (respuesta.length === 100) throw new Error('mas de 100 commits en el PR');
  return respuesta.map((commit) => ({
    oid: commit.sha,
    committedDate: commit.commit?.committer?.date ?? commit.commit?.author?.date ?? null,
  }));
}

function issueDe(pr) {
  const referencia = pr.closingIssuesReferences?.[0];
  if (referencia?.number) return referencia.number;
  const match = String(pr.body ?? '').match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  return match ? Number(match[1]) : null;
}

function primeraEtiquetaListo(eventos, creadoEn) {
  return eventos
    .filter((evento) => evento.event === 'labeled' && evento.label?.name === 'listo' && evento.created_at <= creadoEn)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.created_at ?? null;
}

function rebotesDeGuarda(pr, eventos) {
  const etiquetas = eventos.filter((evento) => evento.event === 'labeled' && evento.label?.name === 'necesita-mano').length;
  const comentarios = (pr.comments ?? []).filter((comentario) => /auto-merge:atrasado|necesita-mano/i.test(comentario.body ?? '')).length;
  return etiquetas + comentarios;
}

function filasMarkdown(filas) {
  const encabezado = [
    '| Repositorio | PR | Issue | Agente | Trabajo | Cola `listo` → PR | CI | Tamaño | Guarda | Retrabajo | Tokens |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  return encabezado.concat(filas.map((fila) => [
    `\`${fila.repo}\``, `#${fila.pr}`, fila.issue ? `#${fila.issue}` : 'sin issue', fila.agente,
    fila.trabajo, fila.cola, fila.ci, fila.tamano, fila.guarda, fila.retrabajo, 'ausente',
  ].map(celda).join(' | ').replace(/^/, '| ').concat(' |'))).join('\n');
}

function resumenPorAgente(filas) {
  const grupos = new Map();
  for (const fila of filas) {
    const actual = grupos.get(fila.agente) ?? { prs: 0, noMedibles: 0, fallas: 0 };
    actual.prs++;
    actual.fallas += fila.fallas ?? 0;
    if (fila.noMedible) actual.noMedibles++;
    grupos.set(fila.agente, actual);
  }
  const lineas = ['| Agente | PRs | Fallas de CI | PRs no medibles |', '| --- | --- | --- | --- |'];
  for (const [agente, datos] of [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lineas.push(`| ${celda(agente)} | ${datos.prs} | ${datos.fallas} | ${datos.noMedibles} |`);
  }
  return lineas.join('\n');
}

async function mapearConLimite(elementos, limite, funcion) {
  const resultados = new Array(elementos.length);
  let siguiente = 0;
  async function worker() {
    while (siguiente < elementos.length) {
      const indice = siguiente++;
      resultados[indice] = await funcion(elementos[indice]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, elementos.length) }, worker));
  return resultados;
}

async function filaDelPr(repo, pr, inicio, fin, run) {
  if (!dentroDelRango(pr.mergedAt, inicio, fin)) return null;
  let commits;
  try {
    commits = await commitsDelPr(repo, pr.number, run);
  } catch {
    return { repo, pr: pr.number, issue: issueDe(pr), agente: pr.author?.login ?? 'no medible', trabajo: 'no medible: commits inaccesibles', cola: 'ausente', ci: 'no medible: commits inaccesibles', tamano: `${pr.changedFiles} archivo(s), +${pr.additions}/-${pr.deletions}`, guarda: 'ausente', retrabajo: 'ausente', noMedible: true, fallas: 0 };
  }

  const issue = issueDe(pr);
  let eventos = [];
  let estadoEventos = null;
  if (issue) {
    try {
      eventos = await eventosDelIssue(`repos/${repo}/issues/${issue}/events`, run);
    } catch (error) {
      estadoEventos = `no medible: ${mensajeDeError(error)} al leer el issue`;
    }
  }

  const primerCommit = commits
    .map((commit) => commit.committedDate)
    .filter(Boolean)
    .sort()[0] ?? null;
  let corridas = [];
  let estadoCi = null;
  try {
    // `workflow_runs[].pull_requests` llega vacio aun para eventos pull_request.
    // El SHA de cada commit es el identificador verificable del PR.
    const porId = new Map();
    const porCommit = await Promise.all([...new Set(commits.map((commit) => commit.oid).filter(Boolean))]
      .map((oid) => corridasDelCommit(repo, oid, run)));
    for (const deEsteCommit of porCommit) {
      for (const runCi of deEsteCommit) {
        if (CI_WORKFLOW.test(runCi.name ?? '')) porId.set(runCi.id, runCi);
      }
    }
    corridas = [...porId.values()];
    if (corridas.length === 0) estadoCi = 'no medible: sin corridas de CI';
  } catch (error) {
    estadoCi = `no medible: ${mensajeDeError(error)} de CI`;
  }

  const fallas = corridas.filter((runCi) => runCi.conclusion === 'failure').length;
  const primerVerde = corridas
    .filter((runCi) => runCi.conclusion === 'success' && runCi.updated_at)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))[0]?.updated_at ?? null;
  const retrabajo = primerVerde
    ? commits.filter((commit) => commit.committedDate > primerVerde).length
    : 'ausente';
  const listoEn = primeraEtiquetaListo(eventos, pr.createdAt);
  const noMedible = Boolean(estadoCi || estadoEventos || !primerCommit);
  return {
    repo,
    pr: pr.number,
    issue,
    agente: pr.author?.login ?? 'ausente',
    trabajo: primerCommit ? duracion(primerCommit, pr.mergedAt) : 'no medible: sin commits',
    cola: estadoEventos ?? (listoEn ? duracion(listoEn, pr.createdAt) : 'ausente'),
    ci: estadoCi ?? `${corridas.length} intento(s), ${fallas} fallido(s)`,
    tamano: `${pr.changedFiles} archivo(s), +${pr.additions}/-${pr.deletions}`,
    guarda: estadoEventos ?? String(rebotesDeGuarda(pr, eventos)),
    retrabajo: String(retrabajo),
    noMedible,
    fallas,
  };
}

/** Genera el reporte y conserva las dependencias inyectables para probar fallas reales de GitHub. */
export async function generarBalance({ desde, hasta, repos = REPOS_DE_COSTEAR }, dependencias = {}) {
  const run = dependencias.run ?? gh;
  const inicio = fechaDeDia(desde);
  const fin = fechaDeDia(hasta, true);
  if (inicio >= fin) throw new Error('El rango de fechas es invalido.');

  const filas = [];
  for (const repo of repos) {
    let prs;
    try {
      prs = parseJson(await run([
        'pr', 'list', '--repo', repo, '--state', 'merged', '--search', `merged:${desde}..${hasta}`,
        '--limit', '100', '--json',
        'number,author,createdAt,mergedAt,additions,deletions,changedFiles,headRefName,body,closingIssuesReferences,comments',
      ]), `PRs de ${repo}`);
    } catch (error) {
      filas.push({ repo, pr: '—', issue: null, agente: 'no medible', trabajo: 'no medible: sin permisos del repo', cola: 'ausente', ci: 'no medible: sin permisos del repo', tamano: 'ausente', guarda: 'ausente', retrabajo: 'ausente', noMedible: true, fallas: 0 });
      continue;
    }

    const filasDelRepo = await mapearConLimite(prs, 4, (pr) => filaDelPr(repo, pr, inicio, fin, run));
    filas.push(...filasDelRepo.filter(Boolean));
  }

  const noMedibles = filas.filter((fila) => fila.noMedible).length;
  const markdown = [
    `# Balance de tanda: ${desde} a ${hasta}`,
    '',
    '> Tokens: **ausente**. Esta herramienta no los estima porque GitHub no conoce el consumo de la sesion del agente.',
    '',
    filasMarkdown(filas),
    '',
    '## Resumen por agente',
    '',
    resumenPorAgente(filas),
    '',
    `PRs analizados: ${filas.length}. PRs no medibles: ${noMedibles}.`,
  ].join('\n');
  return { markdown, exitCode: noMedibles > 0 ? 1 : 0 };
}

function argumentos(argv) {
  const tomar = (nombre) => {
    const indice = argv.indexOf(nombre);
    return indice >= 0 ? argv[indice + 1] : undefined;
  };
  const desde = tomar('--desde');
  const hasta = tomar('--hasta');
  const repos = tomar('--repos')?.split(',').map((repo) => repo.trim()).filter(Boolean);
  if (!desde || !hasta) throw new Error('Uso: node scripts/balance-tanda.mjs --desde AAAA-MM-DD --hasta AAAA-MM-DD [--repos owner/repo,...]');
  return { desde, hasta, ...(repos?.length ? { repos } : {}) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  generarBalance(argumentos(process.argv.slice(2)))
    .then(({ markdown, exitCode }) => {
      console.log(markdown);
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`balance-tanda: ${error.message}`);
      process.exitCode = 2;
    });
}
