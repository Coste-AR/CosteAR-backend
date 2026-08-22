# Fase 2 — Verificar el deploy sin mirarlo

> Plan escrito **antes** de implementar. Sale del §11.4 de la auditoría consolidada
> (`Auditorias/2026-08-20 auditoria consolidada y reparto.md`), Fase 2.
>
> Estado: Fase 0 ✅ (22-08) · Fase 1 ✅ (22-08, PRs #128/#61/#35) · **Fase 2 = esto**.

## El problema

Durante la auditoría del 20-08 la pregunta *«¿este defecto está afectando al cliente?»* quedó sin
responder **tres veces**, siempre por lo mismo: nadie sabía qué SHA corría en cada ambiente.

El runbook lo cubría con un paso manual —«anotá el SHA después de cada deploy»— que **nunca se
ejecutó**. Es el caso C del diagnóstico: *lo que dependía de que alguien se acordara, no se hizo*.

El 21-08 se cerró la mitad del problema: `/health` ahora informa `RAILWAY_GIT_COMMIT_SHA`. Preguntar
sigue siendo un acto manual que nadie hace.

## Qué se construye

Un workflow que, después de cada push a `staging` o `main`, **consulta `/health` del ambiente y
compara el SHA que devuelve contra el commit que se acaba de mergear**. Si no coinciden dentro de la
ventana, el pipeline falla.

Copiado de **de-wall**, que hace exactamente esto con 12 intentos contra `/health`.

## Decisiones de diseño

### La lógica de decisión va en un módulo puro, testeado

`evaluarSalud()` no hace red: recibe el SHA esperado y lo que respondió el ambiente, y devuelve
`ok` / `esperar` / `abortar`. El polling es una cáscara alrededor.

Motivo: es el error del 21-08 otra vez —un test del healthcheck escrito sobre `buildApp()` no
cargaba en el CI y daba `0 test`—. **Un chequeo que solo se puede probar deployando no protege
nada.**

### Cuatro respuestas distintas, tres desenlaces

| Lo que devuelve `/health` | Qué significa | Qué hace |
|---|---|---|
| `version` == SHA del push | El deploy llegó | ✅ termina bien |
| `version` == otro SHA | Railway todavía sirve la versión anterior | 🔁 reintenta |
| no responde / 5xx | El deploy está reiniciando o se cayó | 🔁 reintenta |
| `version` == `desconocido` | `RAILWAY_GIT_COMMIT_SHA` no está inyectada | ⛔ **aborta ya** |

`desconocido` **no se reintenta**: no es una condición que el tiempo arregle, es configuración
faltante. Reintentar 12 veces para después decir lo mismo solo retrasa el diagnóstico 6 minutos.

### Falla, no avisa

Si al agotar los intentos el ambiente sigue con el SHA viejo, el job **falla en rojo**. Un aviso que
no rompe nada es otra cosa que alguien tiene que acordarse de mirar, y de eso trata todo el §10.

### Compara SHAs completos, con tolerancia al corto

Railway inyecta el SHA completo y `github.sha` también, así que el caso normal es igualdad exacta.
Igual se acepta que uno sea prefijo del otro (≥7 caracteres): si algún día el ambiente informa el
corto, el chequeo tiene que seguir siendo correcto en vez de fallar por un detalle de formato.

### El squash no rompe la comparación

Los merges son squash: `staging` recibe **un commit nuevo** cuyo SHA no existe en `dev`. No importa
—Railway deploya ese mismo commit y `github.sha` del evento `push` es exactamente ese—. La
comparación es contra el commit del ambiente, no contra el del PR.

## Lo que este plan NO resuelve

- **Las URLs públicas de los ambientes no están en ningún lado.** El runbook las tiene como
  `_______________` y el repo no tiene ni secrets ni variables cargadas (verificado con
  `gh secret list` / `gh variable list`: ambas vacías). El workflow las lee de las variables
  `STAGING_HEALTH_URL` y `MAIN_HEALTH_URL`, y si faltan **lo dice y no corre**, en vez de dar un
  verde vacío. Cargarlas es el único paso que queda fuera de este PR, y necesita acceso a Railway.
- **No verifica que la app funcione**, solo que la versión correcta está viva. Un smoke más profundo
  (login, un cálculo) es otro trabajo y otra discusión: `staging` tiene un cliente real y
  escribirle datos de prueba no es gratis.
- **No toca `main`.** El workflow lo cubre, pero `main` está 449 commits atrás (issue #94) y
  desatascarlo es el Bloque aparte.

## Criterios de cierre

- [ ] `evaluarSalud()` con tests unitarios que corren **sin base y sin red**
- [ ] El workflow falla si el SHA no aparece dentro de la ventana
- [ ] El workflow dice qué falta si la variable de URL no está cargada
- [ ] El runbook deja de pedir la verificación a mano y apunta acá
