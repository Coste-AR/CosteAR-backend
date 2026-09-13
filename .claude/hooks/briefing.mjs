/**
 * BRIEFING AUTOMÁTICO AL ABRIR LA SESIÓN.
 *
 * Lo corre el hook `SessionStart` (ver `.claude/settings.json`). Lo que imprime
 * en stdout entra como contexto de la conversación, antes de que la persona
 * escriba nada.
 *
 * POR QUÉ EXISTE. La trazabilidad estaba escrita en documentos, y un documento
 * depende de que alguien se acuerde de leerlo — el mismo modo de fallar que el
 * diagnóstico del 22-08 encontró en el flujo de PRs: «todo lo que dependía de
 * la memoria de una persona falló». Un documento además envejece: dice qué pasó
 * el 22 de agosto, no qué pasó ayer.
 *
 * Esto no reemplaza a la documentación: la vuelve innecesaria de buscar. El
 * estado sale de git y de gh en el momento; el mensaje del orquestador sale de
 * `ESTADO.md`.
 *
 * TRES REGLAS DE DISEÑO:
 *
 * 1. NUNCA FALLA. Si git no está, si `gh` no está autenticado, si no hay red —
 *    imprime lo que pudo y sigue. Un briefing a medias sirve; una sesión que no
 *    arranca, no.
 * 2. ES CORTO. Cada línea que imprime ocupa contexto de la conversación real.
 *    Si no cambia lo que la persona va a hacer, no va.
 * 3. ES RÁPIDO. Todo con timeout. Nadie espera para empezar a trabajar.
 *
 * Está en Node y no en bash a propósito: corre igual en Windows, macOS y Linux,
 * y Node ya es dependencia del proyecto.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/**
 * `--check-settings`: verifica que `.claude/settings.json` tenga la forma que
 * Claude Code espera. Correr esto antes de commitear un cambio al hook.
 *
 * Existe porque la primera versión estaba mal escrita —`type` y `command`
 * colgando directo de la entrada del evento, sin el array `hooks` intermedio— y
 * el error recién apareció al abrir una sesión nueva, que es lo único que no se
 * puede probar desde adentro de una sesión.
 *
 * Y el modo de fallar es el que obliga a tener esto: **un settings.json
 * inválido se descarta ENTERO**, no solo la parte mal escrita. Con más hooks
 * configurados, uno mal puesto apaga todos los demás.
 */
if (process.argv.includes('--check-settings')) {
  const ruta = join(RAIZ, '.claude', 'settings.json');
  try {
    const cfg = JSON.parse(readFileSync(ruta, 'utf8'));
    const eventos = Object.entries(cfg.hooks ?? {});
    if (!eventos.length) throw new Error('no hay ningún hook configurado');

    for (const [evento, entradas] of eventos) {
      if (!Array.isArray(entradas)) throw new Error(`${evento} tiene que ser un array`);
      for (const [i, entrada] of entradas.entries()) {
        if (!Array.isArray(entrada.hooks)) {
          throw new Error(
            `${evento}[${i}] no tiene el array \`hooks\`. La entrada de un evento no es el hook: ` +
              'es un objeto que lo contiene — { hooks: [ { type, command } ] }',
          );
        }
        for (const [j, h] of entrada.hooks.entries()) {
          if (h.type !== 'command' || !h.command) {
            throw new Error(`${evento}[${i}].hooks[${j}] necesita \`type: "command"\` y \`command\``);
          }
        }
      }
    }
    console.log(`✔ ${ruta}\n  ${eventos.length} evento(s) con la forma correcta.`);
    process.exit(0);
  } catch (e) {
    console.error(`✖ ${ruta}\n  ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

/** Corre un comando y devuelve su salida, o `null` si falla por cualquier motivo. */
function correr(cmd, args, timeout = 5000) {
  try {
    return execFileSync(cmd, args, {
      cwd: RAIZ,
      timeout,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

// El shim permite probar el script completo sin depender del git/gh ni de la
// cuenta de la máquina. En uso normal no existe y se ejecutan los binarios reales.
const commandShim = process.env.BRIEFING_COMMAND_SHIM;
const runTool = (tool, args, timeout) => commandShim
  ? correr(process.execPath, [commandShim, tool, ...args], timeout)
  : correr(tool, args, timeout);
const git = (...args) => runTool('git', args, 5000);
/** `gh` puede no estar instalado o no estar autenticado: los dos casos son `null`. */
const gh = (...args) => runTool('gh', args, 8000);

function parseJson(output) {
  if (output === null) return null;
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function numeroDesdeIssueUrl(url) {
  if (typeof url !== 'string') return null;
  const match = /\/issues\/(\d+)$/.exec(url);
  return match ? Number(match[1]) : null;
}

function fechaArgentina(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '??';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')} ART`;
}

const lineas = [];
const agregar = (l = '') => lineas.push(l);

// ── Dónde estás parado ──────────────────────────────────────────────────────
const rama = git('rev-parse', '--abbrev-ref', 'HEAD');
if (!rama) {
  // Sin git no hay nada que decir que la persona no sepa. Salir en silencio es
  // mejor que imprimir un briefing vacío que solo gasta contexto.
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY
  ?? gh('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner');
const modo = gh(
  'variable', 'get', 'MODO_TRABAJO',
  ...(repo ? ['-R', repo] : []),
);
agregar(modo
  ? `Modo de trabajo: ${modo.toLocaleLowerCase('es-AR')}`
  : 'Modo de trabajo: NO DECLARADO (no se pudo leer la variable)');
agregar('━━━ CosteAR · briefing de sesión ━━━');
agregar();

const sucio = git('status', '--porcelain');
const estado = sucio ? `${sucio.split('\n').length} archivo(s) sin commitear` : 'limpio';
agregar(`Rama: ${rama}  ·  Working tree: ${estado}`);

// ── ¿Te quedaste atrás? ─────────────────────────────────────────────────────
//
// Se lee la referencia remota que ya está en disco: NO se hace `fetch`. Un
// fetch acá agregaría segundos al arranque de cada sesión y podría fallar sin
// red. Si el dato está viejo, el propio briefing lo dice.
const atras = git('rev-list', '--count', `${rama}..origin/dev`);
if (atras && Number(atras) > 0) {
  agregar(
    `⚠️  origin/dev tiene ${atras} commit(s) que esta copia no tiene. ` +
      'Sincronizala vos, Claude, antes de abrir una rama: `git checkout dev && git pull`. ' +
      'No se lo pidas a la persona.',
  );
}

// ── Qué está pasando en los PRs ─────────────────────────────────────────────
const yo = gh('api', 'user', '--jq', '.login');
const prs = gh(
  'pr', 'list', '--state', 'open', '--limit', '10',
  '--json', 'number,title,isDraft,author,baseRefName',
  '--jq',
  '.[] | "\\(.number)\\t\\(.author.login)\\t\\(if .isDraft then "draft" else "listo" end)\\t→\\(.baseRefName)\\t\\(.title)"',
);

// `null` es «no se pudo preguntar» (sin `gh`, sin auth, sin red) y cadena vacía
// es «no hay ninguno». Son cosas distintas: la primera se calla, la segunda
// informa. Tratarlas igual hacía desaparecer la sección justo cuando la
// respuesta era la más tranquilizadora.
if (prs !== null) {
  const filas = prs.split('\n').filter(Boolean).map((l) => l.split('\t'));
  const mios = yo ? filas.filter((f) => f[1] === yo) : [];
  const otros = yo ? filas.filter((f) => f[1] !== yo) : filas;

  agregar();
  if (mios.length) {
    agregar('Tus PRs abiertos:');
    for (const [n, , estadoPr, base, titulo] of mios) {
      agregar(`  #${n} [${estadoPr}] ${base}  ${titulo}`);
    }
  }
  if (otros.length) {
    agregar(`PRs de otros (${otros.length}): ${otros.map((f) => `#${f[0]} ${f[1]}`).join(', ')}`);
  }
  if (!filas.length) agregar('PRs abiertos: ninguno.');
}

// ── Tus issues ──────────────────────────────────────────────────────────────
if (yo) {
  const issues = gh(
    'issue', 'list', '--state', 'open', '--assignee', '@me', '--limit', '5',
    '--json', 'number,title', '--jq', '.[] | "#\\(.number) \\(.title)"',
  );
  if (issues) {
    agregar();
    agregar('Tus issues asignados:');
    for (const i of issues.split('\n').filter(Boolean)) agregar(`  ${i}`);
  }
}

// ── El mensaje del orquestador ──────────────────────────────────────────────
//
// Los comentarios de PR también salen por la API de issues. Se consulta una
// sola ventana y se filtra contra los asuntos que siguen accionables hoy.
const erroresMensajes = [];
const issueOutput = gh(
  'issue', 'list', '--state', 'open', '--limit', '1000',
  '--json', 'number,labels',
);
const issueRows = parseJson(issueOutput);
const issueNumbers = new Set();
if (!Array.isArray(issueRows)) {
  erroresMensajes.push('No se pudieron leer los issues `listo`/`bloqueado`.');
} else {
  for (const issue of issueRows) {
    const labels = Array.isArray(issue?.labels) ? issue.labels.map((label) => label?.name) : [];
    if (typeof issue?.number === 'number' && labels.some((label) => label === 'listo' || label === 'bloqueado')) {
      issueNumbers.add(issue.number);
    }
  }
}

const prOutput = gh('pr', 'list', '--state', 'open', '--limit', '1000', '--json', 'number');
const prRows = parseJson(prOutput);
const prNumbers = new Set();
if (!Array.isArray(prRows)) {
  erroresMensajes.push('No se pudieron leer los PRs abiertos para buscar mensajes.');
} else {
  for (const pr of prRows) if (typeof pr?.number === 'number') prNumbers.add(pr.number);
}

let commentRows = null;
if (!repo) {
  erroresMensajes.push('No se pudo determinar el repositorio para leer comentarios.');
} else {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const commentsOutput = gh(
    'api', `repos/${repo}/issues/comments?since=${since}&per_page=100`,
    '--paginate', '--slurp',
  );
  const pages = parseJson(commentsOutput);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    erroresMensajes.push('No se pudieron leer los comentarios de los últimos 7 días.');
  } else {
    commentRows = pages.flat();
  }
}

const mensajes = (commentRows ?? [])
  .filter((comment) => typeof comment?.body === 'string' && comment.body.startsWith('/agente'))
  .map((comment) => ({ ...comment, number: numeroDesdeIssueUrl(comment.issue_url) }))
  .filter((comment) => comment.number !== null && (issueNumbers.has(comment.number) || prNumbers.has(comment.number)))
  .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

agregar();
if (mensajes.length === 0 && erroresMensajes.length === 0) {
  agregar('Mensajes para vos: ninguno');
} else {
  agregar('Mensajes para vos:');
  for (const error of erroresMensajes) agregar(`  ⚠️ ${error}`);
  for (const mensaje of mensajes) {
    const target = prNumbers.has(mensaje.number) ? `PR #${mensaje.number}` : `#${mensaje.number}`;
    const author = mensaje.user?.login ?? 'autor desconocido';
    agregar(`  ${fechaArgentina(mensaje.created_at)} · ${author} · ${target}`);
    const bodyLines = mensaje.body.split('\n');
    while (bodyLines.at(-1) === '') bodyLines.pop();
    for (const line of bodyLines) agregar(`    ${line}`);
  }
}

// ESTADO.md es lo único de todo esto que escribe una persona. Va último para
// quedar lo más cerca posible del principio de la conversación.
const estadoPath = join(RAIZ, 'ESTADO.md');
if (existsSync(estadoPath)) {
  try {
    // Los comentarios HTML se sacan acá. `ESTADO.md` los usa para las
    // instrucciones de cómo mantenerlo, que le sirven a quien lo edita y no a
    // quien va a programar: inyectarlas gasta contexto para decir nada.
    //
    // (Claude Code hace esto solo con los CLAUDE.md, pero `ESTADO.md` no es uno
    // —lo lee este script—, así que acá hay que hacerlo a mano.)
    const texto = readFileSync(estadoPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
    if (texto) {
      agregar();
      agregar('━━━ ESTADO.md · qué está pasando ahora ━━━');
      agregar(texto);
    }
  } catch {
    // Si no se puede leer, el resto del briefing igual sirve.
  }
}

agregar();
// El manual y la filosofía viven en repos que pueden no estar clonados en esta
// máquina — por eso son URLs absolutas, no rutas relativas. La filosofía ya
// tiene su resumen operativo en el CLAUDE.md de este repo: esto es la versión
// completa, no la única fuente de los tres pasos.
agregar(
  'Recordá: el PR nace en draft (`gh pr create --draft`). Cuando está terminado y en ' +
    'verde se marca listo (`gh pr ready`) y se le pone la etiqueta `auto-merge`: de ahí ' +
    'lo mergea el workflow, con squash a `dev` y merge commit en las promociones. ' +
    'Manual completo: ' +
    'https://github.com/Coste-AR/CosteAR-backend/blob/dev/docs/manual-de-flujo-de-trabajo.md',
);
agregar(
  'Cómo trabajamos (diagnosticar → planificar → implementar), versión completa: ' +
    'https://github.com/Coste-AR/CosteAR-admin/blob/dev/docs/2026-08-22-filosofia-diagnosticar-planificar-implementar.md',
);
// #39 — el DoD vive en el único repo privado y el código en los otros tres.
// Va acá y no solo en el CLAUDE.md por el mismo motivo que el resto de esta
// sección: es lo que se lee cuando nadie fue a buscarlo.
//
// Contra EST-04 (cada línea cuesta contexto real): se decidió UNA línea con el
// resumen Nivel 1 + link, no el DoD completo (~100 líneas). El completo cambia
// lo que se hace solo en casos puntuales (migraciones, motor de cálculo,
// entrega al cliente) que ya tienen su propia regla más específica en este
// archivo (DOM-*, DOC-05); el resumen de acá cubre el caso común.
agregar(
  'Definition of Done (Nivel 1, resumen): probado en staging, PR con plantilla, ' +
    'lint/typecheck/test en verde, sin console.log de debug. Completo: ' +
    'https://github.com/Coste-AR/CosteAR-admin/blob/dev/DEFINITION-OF-DONE.md',
);
// El reparto de tareas con git. Va en el briefing y no solo en el CLAUDE.md
// porque es lo primero que se rompe: el briefing avisa que la copia quedó
// atrás, y si la línea está escrita en segunda persona, Claude le pasa el
// comando a la persona en vez de correrlo. Los socios no hacen pulls a mano.
//
// Actualizado el 30-08-2026: hasta ese día esta línea decía «la persona solo
// mergea, desde la web». Ya no es cierto — nadie mergea a mano. Lo hace
// `.github/workflows/auto-merge.yml` cuando el PR está en verde Y etiquetado.
agregar(
  'Reparto con git: **Claude corre git** — pull, fetch, checkout, push, prune y ' +
    'limpieza de ramas — y abre los PRs. **Nadie mergea a mano**: el PR se marca listo, ' +
    'se etiqueta `auto-merge` y entra solo cuando el CI está en verde. La etiqueta es ' +
    'la decisión; el merge es del workflow. ' +
    'Nunca le pases un comando de git para que lo copie: corrélo vos y contale qué quedó.',
);
agregar('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

console.log(lineas.join('\n'));
