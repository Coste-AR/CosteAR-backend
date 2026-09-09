# 2026-09-08 — Avisar escala empresarial fuera de calibración del perfil

- **Issue:** #202
- **Repo:** CosteAR-backend
- **Rama:** `feat/issue-202-scale-warning`
- **PR:** #286
- **Agente:** Codex · GPT-5
- **Tanda:** no informada

## Recursos

| Recurso | Registro |
| --- | --- |
| Tiempo de la sesión | ~35 min |
| Tokens consumidos | no informado |
| Intentos hasta el verde | 2 (la primera suite total reveló que el fixture no era de alta confianza; se corrigió y volvió a verde) |
| Comandos de verificación corridos | `npm.cmd test -- tests/application/ingest-data-entry.test.ts tests/classifier/scale-calibration-warning.test.ts`, `npm.cmd run check:tests-base`, `npm.cmd test -- --reporter=dot --silent`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run test:http`, `docker compose up -d postgres redis` |

## Qué se hizo

Se agregó una señal opcional `scaleCalibrationWarning` al resultado del clasificador y a la salida de ingesta. Compara la escala física declarada por la empresa con la escala de calibración opcional resuelta por el paquete de rubro. Una diferencia material conserva idéntica la decisión de clasificación y expone el aviso para que el consumidor pueda escalarlo a revisión humana.

La ingesta obtiene la escala de la empresa y, para el perfil de postura avícola disponible, la escala resuelta por cascada de paquete. Si falta una de las dos, la clasificación conserva el comportamiento anterior.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** considerar material una diferencia de tres veces o más entre escalas de igual unidad.
- **Qué otra opción había:** usar un límite menor, mayor o cambiar directamente la confianza.
- **Por qué elegí esta:** el issue exige definir el factor y prohíbe modificar la decisión. Tres veces separa una variación operativa habitual de un cambio de contexto que merece señal sin hacerla ubicua. La justificación estable queda en ADR 0011.

- **Qué decidí:** emitir `UNIT_MISMATCH` cuando las unidades no son iguales, sin convertirlas.
- **Qué otra opción había:** convertir en forma automática o ignorar el desajuste.
- **Por qué elegí esta:** el contrato de #234 no define taxonomía ni factores de conversión. Inventarlos ocultaría una comparación no confiable; ignorarlo silenciaría precisamente el riesgo que atiende el issue.

- **Qué decidí:** resolver solo el paquete de postura para industria avícola.
- **Qué otra opción había:** inventar una correspondencia para todos los perfiles de industria.
- **Por qué elegí esta:** es el único paquete de rubro actualmente disponible que puede declarar esa escala. Sin paquete calibrado, la señal debe permanecer ausente.

## Dónde el issue no alcanzaba

- No fija el factor que vuelve material una diferencia de escala; se eligió tres veces y se dejó documentado en ADR 0011.
- No define conversión ni equivalencia entre unidades; se trata la incompatibilidad como señal explícita.
- No especifica cómo mapear categorías de industria a paquetes. Se usó únicamente el paquete de postura existente y no se infirieron otros.

## Qué quedó afuera

- No se cambiaron pesos, umbrales, orden ni decisiones del clasificador.
- No se sembraron escalas de calibración ni se modificó el schema o las migraciones.
- No se agregó contrato HTTP específico ni conversión de unidades; no se abrió issue nuevo.

## Con qué se verifica

```bash
npm.cmd test -- tests/application/ingest-data-entry.test.ts tests/classifier/scale-calibration-warning.test.ts
# 2 archivos, 11 pruebas en verde.

npm.cmd run check:tests-base
# pasó: todos los tests con base están declarados.

npm.cmd run lint
# pasó.

npm.cmd run typecheck
# pasó.

npm.cmd run test:http
# 13 archivos, 82 pruebas en verde.

npm.cmd test -- --reporter=dot --silent
# 173 archivos en verde, 1 omitido; 1562 pruebas en verde, 4 omitidas.

docker compose up -d postgres redis
# no se pudo iniciar: el daemon Docker Desktop no estaba disponible en npipe://./pipe/dockerDesktopLinuxEngine.
# Por eso npm.cmd run test:integration no se ejecutó localmente; debe ejecutarlo CI con Postgres real y rol sin BYPASSRLS.
```
