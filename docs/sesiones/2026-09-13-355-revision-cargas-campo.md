---
issue: 355
repo: CosteAR-backend
pr: 357
rama: feat/revision-cargas-fuera-rango
agente: codex
modelo: gpt-5
tanda: B2
inicio: 2026-09-13T22:40-03:00
fin: 2026-09-13T23:10-03:00
minutos: 30
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 0
rebotes_de_guarda: 0
---

# 2026-09-13 â€” Las cargas imposibles se guardan y quedan visibles para revisiÃ³n

## QuÃ© se hizo

- ProducciÃ³n diaria y eventos de lote persisten `requiereRevision` y un motivo legible.
- Una producciÃ³n superior al plantel vivo y una baja que dejarÃ­a saldo negativo se guardan marcadas.
- Los valores dentro de esos lÃ­mites se guardan sin marca.
- Ambos `POST` devuelven la marca en la misma respuesta para que el panel confirme el resultado real.

## Decisiones que tomÃ© sobre la marcha

- **QuÃ© decidÃ­:** usar invariantes fÃ­sicas derivadas de los eventos del lote hasta la fecha de la carga.
  **QuÃ© otra opciÃ³n habÃ­a:** fijar umbrales comerciales de postura o mortalidad.
  **Por quÃ© elegÃ­ esta:** no existe configuraciÃ³n de negocio que autorice esos porcentajes; superar el 100% del plantel o producir saldo negativo sÃ­ es objetivamente inconsistente.
- **QuÃ© decidÃ­:** conservar la carga y agregar metadata en las tablas existentes.
  **QuÃ© otra opciÃ³n habÃ­a:** rechazarla o crear una cola paralela de borradores.
  **Por quÃ© elegÃ­ esta:** el criterio de #355 exige que el dato quede guardado y que la revisiÃ³n no bloquee el trabajo de campo.

## DÃ³nde el issue no alcanzaba

- No definÃ­a porcentajes de tolerancia por especie, edad o establecimiento. Se evitÃ³ inventarlos y se aplicaron solamente los dos lÃ­mites fÃ­sicos verificables con los datos actuales.
- Una baja importada sin motivo sigue excluida del saldo, segÃºn el contrato preexistente: no se reclasifica ni modifica en esta tarea.

## QuÃ© quedÃ³ afuera

- La interfaz que muestra “Marcado para revisiÃ³n” se completa en CosteAR-frontend #97.
- Una bandeja administrativa para resolver marcas y umbrales configurables por rubro requieren contratos propios.

## Con quÃ© se verifica

```bash
npm run prisma:generate
npm run lint
npm run typecheck
npm run check:tests-base
npm test
npx vitest run tests/domain/revision-carga-campo.test.ts tests/application/eventos-lote-service.test.ts tests/application/produccion-diaria-revision.test.ts tests/http/cargas-campo-revision.test.ts
```

La primera suite completa se ejecutÃ³ en paralelo con lint y typecheck y tuvo dos timeouts aislados en archivos no modificados; se reejecutÃ³ sola para eliminar contenciÃ³n.
