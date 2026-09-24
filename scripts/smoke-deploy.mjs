/**
 * ¿LLEGÓ DE VERDAD EL DEPLOY?
 *
 * Consulta `/health` del ambiente y compara el SHA que informa contra el commit
 * que se acaba de mergear. Si no coinciden dentro de la ventana, falla.
 *
 * Reemplaza el paso manual del runbook —«anotá el SHA después de cada deploy»—
 * que nunca se ejecutó. Durante la auditoría del 20-08 la pregunta «¿esto está
 * afectando al cliente?» quedó sin respuesta TRES veces, siempre por no saber
 * qué versión corría dónde.
 *
 * Uso:
 *   node scripts/smoke-deploy.mjs --url https://... --sha <SHA> [--intentos 12] [--espera 15]
 */

/** Cuántos caracteres de SHA hacen falta para que la comparación signifique algo. */
const MINIMO_PREFIJO = 7;

/**
 * La decisión, sin red y sin reloj: qué hacer con lo que respondió el ambiente.
 *
 * Vive aparte del polling a propósito. El 21-08 se escribió un test del
 * healthcheck sobre `buildApp()` y en el CI no cargaba ni un test: un chequeo
 * que solo se puede probar deployando no protege nada. Esta función se prueba
 * en la máquina de cualquiera, sin Postgres y sin internet.
 *
 * @param {{ shaEsperado: string, respuesta: { ok: boolean, status?: number, version?: string, error?: string } }} args
 * @returns {{ estado: 'ok'|'esperar'|'abortar', motivo: string }}
 */
export function evaluarSalud({ shaEsperado, respuesta }) {
  if (!shaEsperado || shaEsperado.length < MINIMO_PREFIJO) {
    return { estado: 'abortar', motivo: `SHA esperado inválido: "${shaEsperado}"` };
  }

  if (!respuesta.ok) {
    // Todavía reiniciando, o caído. Desde afuera no se distingue, y las dos se
    // tratan igual: esperar y volver a preguntar.
    const detalle = respuesta.error ?? `HTTP ${respuesta.status}`;
    return { estado: 'esperar', motivo: `el ambiente no responde (${detalle})` };
  }

  const version = respuesta.version;

  if (!version) {
    // Mientras el contenedor arranca, Railway responde 200 con un cuerpo suyo
    // —`{"status":"starting"}`— que no es nuestro `/health`. Visto en vivo el
    // 22-08 durante el primer deploy de `production` a `main`.
    //
    // Eso es esperar, no abortar: el que contesta todavía no es nuestro
    // servidor. Abortar ahí haría fallar el chequeo justo en el momento en que
    // su trabajo es tener paciencia.
    //
    // Si en cambio el cuerpo dice `status: 'ok'` y aun así no trae `version`,
    // el que responde SÍ es nuestro endpoint y le falta el campo: eso es un
    // contrato roto y no lo arregla esperar.
    if (respuesta.status_body === 'ok') {
      return { estado: 'abortar', motivo: '/health respondió `status: ok` pero sin campo `version`' };
    }
    const que = respuesta.status_body ? `\`status: ${respuesta.status_body}\`` : 'un cuerpo sin `version`';
    return { estado: 'esperar', motivo: `el ambiente todavía está arrancando (${que})` };
  }

  // `desconocido` NO se reintenta. No es una condición que el tiempo arregle:
  // es que `RAILWAY_GIT_COMMIT_SHA` no está inyectada en el ambiente. Esperar
  // doce veces para decir lo mismo solo retrasa el diagnóstico.
  if (version === 'desconocido') {
    return {
      estado: 'abortar',
      motivo:
        'el ambiente informa `version: "desconocido"`: falta la variable RAILWAY_GIT_COMMIT_SHA. ' +
        'Sin eso no se puede verificar ningún deploy.',
    };
  }

  if (mismoCommit(version, shaEsperado)) {
    return { estado: 'ok', motivo: `el ambiente corre ${version}` };
  }

  return {
    estado: 'esperar',
    motivo: `el ambiente todavía corre ${version}, se esperaba ${shaEsperado}`,
  };
}

/**
 * Railway y GitHub informan el SHA completo, así que el caso normal es igualdad
 * exacta. Se acepta el prefijo por si algún día un ambiente informa el corto:
 * el chequeo tiene que seguir siendo correcto, no fallar por el formato.
 */
export function mismoCommit(a, b) {
  if (!a || !b) return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  const corto = x.length <= y.length ? x : y;
  const largo = x.length <= y.length ? y : x;
  if (corto.length < MINIMO_PREFIJO) return false;
  return largo.startsWith(corto);
}

/** Evalúa un preflight CORS sin red para que el criterio tenga cobertura unitaria. */
export function evaluarCors({ origin, respuesta }) {
  if (respuesta.error) {
    return { ok: false, motivo: `CORS para ${origin} no respondió (${respuesta.error})` };
  }

  if (respuesta.status < 200 || respuesta.status >= 300) {
    return { ok: false, motivo: `CORS para ${origin} respondió HTTP ${respuesta.status}` };
  }

  if (respuesta.allowOrigin !== origin) {
    const recibido = respuesta.allowOrigin ?? 'sin Access-Control-Allow-Origin';
    return {
      ok: false,
      motivo: `CORS para ${origin} devolvió ${recibido}; se esperaba exactamente ${origin}`,
    };
  }

  return { ok: true, motivo: `CORS permite ${origin}` };
}

/** Consulta `/health` y normaliza cualquier falla a la forma que espera `evaluarSalud`. */
async function consultarSalud(url, timeoutMs = 10_000) {
  const corte = AbortSignal.timeout(timeoutMs);
  try {
    const r = await fetch(url, { signal: corte, headers: { accept: 'application/json' } });
    if (!r.ok) return { ok: false, status: r.status };
    const cuerpo = await r.json();
    // `status_body` es el `status` del CUERPO, no el HTTP: sirve para distinguir
    // nuestro `/health` (`ok`) del cuerpo que Railway sirve mientras arranca
    // (`starting`).
    return {
      ok: true,
      status: r.status,
      status_body: cuerpo?.status,
      version: cuerpo?.version,
      environment: cuerpo?.environment,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function consultarCors(base, origin, timeoutMs = 10_000) {
  const url = `${base.replace(/\/+$/, '')}/api/v1/auth/refresh`;
  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
      headers: {
        origin,
        'access-control-request-method': 'POST',
      },
    });
    return {
      status: response.status,
      allowOrigin: response.headers.get('access-control-allow-origin') ?? undefined,
    };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1];
  }
  return args;
}

async function main() {
  const args = leerArgs(process.argv.slice(2));
  const base = args.url ?? process.env.HEALTH_URL;
  const sha = args.sha ?? process.env.GITHUB_SHA;
  const intentos = Number(args.intentos ?? 12);
  const espera = Number(args.espera ?? 15) * 1000;
  const originsRaw = args.origins ?? process.env.FRONTEND_ORIGINS;

  if (!base) {
    console.error(
      '✖ Falta la URL del ambiente.\n' +
        '  El workflow la toma de la variable de repositorio STAGING_HEALTH_URL / MAIN_HEALTH_URL.\n' +
        '  Cargarlas en: Settings → Secrets and variables → Actions → Variables.\n' +
        '  (Es el "hueco de infra" que el runbook viene arrastrando sin dueño.)',
    );
    process.exitCode = 2;
    return;
  }
  if (!sha) {
    console.error('✖ Falta el SHA esperado (--sha o GITHUB_SHA).');
    process.exitCode = 2;
    return;
  }
  const origins = originsRaw?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (origins.length === 0) {
    console.error(
      '✖ Falta FRONTEND_ORIGINS. Cargar una lista separada por comas en las variables del repositorio; sin orígenes no se puede medir CORS.',
    );
    process.exitCode = 2;
    return;
  }

  const url = `${base.replace(/\/+$/, '')}/health`;
  console.log(`Verificando que ${url} esté corriendo ${sha}`);
  console.log(`Hasta ${intentos} intentos, cada ${espera / 1000}s.\n`);

  let deployConfirmado = false;
  for (let intento = 1; intento <= intentos; intento += 1) {
    const respuesta = await consultarSalud(url);
    const { estado, motivo } = evaluarSalud({ shaEsperado: sha, respuesta });

    if (estado === 'ok') {
      console.log(`✔ Intento ${intento}/${intentos}: ${motivo}`);
      deployConfirmado = true;
      break;
    }

    if (estado === 'abortar') {
      console.error(`\n✖ ${motivo}`);
      process.exitCode = 1;
      return;
    }

    console.log(`… intento ${intento}/${intentos}: ${motivo}`);
    if (intento < intentos) await dormir(espera);
  }

  if (!deployConfirmado) {
    console.error(
      `\n✖ El deploy NO llegó: después de ${intentos} intentos ` +
        `(${(intentos * espera) / 1000}s) el ambiente sigue sin servir ${sha}.\n` +
        '  O el build de Railway falló, o tarda más que la ventana, o el deploy quedó ' +
        'trabado (P3009 de una migración a medio aplicar bloquea cualquier deploy).',
    );
    process.exitCode = 1;
    return;
  }

  console.log('\nEl deploy llegó. Verificando preflights CORS:');
  for (const origin of origins) {
    const resultado = evaluarCors({ origin, respuesta: await consultarCors(base, origin) });
    if (!resultado.ok) {
      console.error(`✖ ${resultado.motivo}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✔ ${resultado.motivo}`);
  }
  console.log('\nEl deploy sirve el commit correcto y permite todos los orígenes configurados.');
}

// Solo corre cuando se lo invoca como script; importarlo desde un test no dispara nada.
if (process.argv[1] && process.argv[1].endsWith('smoke-deploy.mjs')) {
  await main();
}
