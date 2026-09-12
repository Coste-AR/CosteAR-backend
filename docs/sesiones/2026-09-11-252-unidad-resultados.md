---
issue: 252
repo: CosteAR-backend
pr: 341
minutos: 18
tokens: no-informado
clears: 0
intentos_hasta_verde: 2
rojos_deliberados: 1
rebotes_de_guarda: 0
---

Se completó el contrato de unidad de gestión que el PR #323 había incorporado
solamente al tablero. Cálculo, punto de equilibrio y comparación entre períodos
ahora declaran `unidadGestion` y proyectan sus valores por unidad con el factor
elegido por la empresa. Cuando no hay una unidad declarada, conservan el valor
base y devuelven `null`; no se infiere una alternativa por rubro.

La decisión principal fue separar el snapshot estable del motor de la proyección
de respuesta. Se descartó persistir el resultado convertido porque una empresa
podría cambiar su unidad de gestión y eso reinterpretaría su historia. También se
descartó repetir multiplicaciones y divisiones en servicios: el conversor quedó
en dominio y una prueba impide reintroducir aritmética con `factor` en cálculo,
comparación o tablero. El ADR 0015 deja registradas estas alternativas.

El cuerpo original de #252 no alcanzaba para saber si las cantidades almacenadas
eran base o gestión, ni qué hacer con el resultado cuando faltaba la declaración.
Eso quedó definido posteriormente en #322 y detallado como implementación en
#326. Con esas definiciones y con `Company.unidadGestionId` ya presente no fue
necesario inventar contrato ni migrar datos.

Quedaron afuera la presentación en frontend, la elección de unidad por período y
las conversiones intermedias a pedido. No se cambió ninguna fórmula del motor ni
se agregaron migraciones; Prisma sólo documenta la unidad de los campos actuales.

La guarda roja fue
`npm run test -- tests/domain/unidad-gestion-resultados.test.ts`: falló porque el
conversor todavía no existía. Después se verificó con `npm run lint`, `npm run
typecheck`, `npm run test`, `npm run test:http`, `npm run test:integration` con el
rol `costear_app` sin `BYPASSRLS`, `npm run check:tests-base` y `npm run
check:openapi`. La primera corrida completa detectó cuatro mocks del simulador
que no declaraban la nueva lectura de empresa; se completaron y la segunda quedó
verde. No desapareció ni cambió de nombre ningún test.
