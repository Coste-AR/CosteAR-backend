---
issue: 74
repo: CosteAR-backend
pr: 391
rama: feat/74-alertas-indicadores
agente: codex
modelo: gpt-5
tanda: B3
inicio: 2026-09-19T20:58-03:00
fin: 2026-09-19T21:22-03:00
minutos: 24
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

# 2026-09-19 — Las alertas físicas dejan de callarse cuando falta el dato

## Recursos

La primera verificación general tuvo un timeout intermitente en `admin-stats`,
fuera del cambio y sin una aserción fallida. El archivo pasó aislado sin cambios
y la corrida general final quedó verde limitando Vitest a dos workers. El rojo
deliberado fue la caída simulada del proveedor de email: la alerta debe quedar
visible en la app y la respuesta debe declarar que el correo no salió.

## Qué se hizo

- Se comprobó que las cuatro reglas físicas del #74 y la alerta recalculada de
  punto de equilibrio ya estaban realmente en `origin/dev`.
- Se agregó un contrato HTTP para listar, crear, editar y evaluar reglas por
  empresa y estructura, usando el modelo `ReglaAlerta` existente.
- La evaluación distingue `INACTIVA`, `NO_EVALUABLE`, `NORMAL` y `ALERTA`. La
  falta de lectura, referencia o historia sostenida incluye un motivo.
- Un hallazgo crea una alerta en la bandeja. Si el canal es email, usa los
  destinatarios configurados o el correo del dueño; una falla del proveedor no
  borra ni oculta la alerta in-app.
- Las mutaciones y la entrega se auditan en la misma transacción. Una prueba con
  Postgres verifica el aislamiento RLS entre dos empresas.
- Se documentó la decisión en ADR 0025.

## Decisiones que tomé sobre la marcha

- **Qué decidí:** conservar `evaluarRegla()` como adaptador hallazgo/`null` y
  agregar `evaluarReglaDetallada()` para el contrato nuevo.
  **Qué otra opción había:** cambiar el tipo de retorno del evaluador existente.
  **Por qué elegí esta:** evita romper el flujo ya probado del punto de
  equilibrio y permite declarar ausencia en consumidores nuevos.
- **Qué decidí:** recibir lecturas fechadas en la evaluación sin crear una tabla
  genérica.
  **Qué otra opción había:** persistir cada medición en un modelo nuevo.
  **Por qué elegí esta:** postura y otros indicadores se derivan de hechos que
  ya tienen su propia fuente; duplicarlos crea dos verdades y el issue no pide
  una migración.
- **Qué decidí:** `EMAIL` agrega el correo a la alerta in-app; no lo reemplaza.
  **Qué otra opción había:** canales mutuamente excluyentes.
  **Por qué elegí esta:** el issue dice que la alerta llega por la app y, cuando
  corresponda, también por correo.

## Dónde el issue no alcanzaba

- No definía el contrato entre las fuentes físicas y el evaluador. Se eligió un
  endpoint que recibe lecturas porque humedad y peso todavía no tienen modelos
  de captura propios, mientras que la postura ya se deriva sin persistirse.
- `destinatarios` era un arreglo de texto sin semántica declarada. Para el canal
  email se validan direcciones; con arreglo vacío se usa el dueño de la empresa.
- No decía qué hacer si el proveedor de correo falla después de crear la alerta.
  Se conserva la alerta en la app y se devuelve una entrega `FALLIDA` accionable.

## Qué quedó afuera

- No se agregó persistencia duplicada de lecturas ni una migración.
- No se agregaron pantallas ni formularios de captura de humedad o peso; los
  repositorios consumidores pueden usar el contrato HTTP nuevo.
- No se modificó la matemática del punto de equilibrio ni se activaron umbrales
  sin confirmación humana.

## Con qué se verifica

```bash
npm run lint                         # verde
npm run typecheck                    # verde
npx vitest run --maxWorkers=2        # 205 archivos, 1794 tests; 4 skips existentes
npm run test:http                    # 23 archivos, 132 tests
npm run test:integration             # 24 archivos, 78 tests con RLS
npm run test:db                      # 5 archivos, 66 tests
npm run check:tests-base             # verde
npm run check:openapi                # verde
npm run typecheck:openapi-consumer   # verde
```
