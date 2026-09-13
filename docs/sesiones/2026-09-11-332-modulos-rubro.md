# Bitácora — issue #332: módulos y preguntas por rubro

## Recursos

- Tiempo de sesión: no informado.
- Tokens consumidos: no informado.
- Intentos hasta verde: 2. Se verificó primero en rojo el caso HTTP de una
  opción inválida (la aserción temporal esperaba 200 y recibió 422); se
  restauró la aserción correcta y quedó verde.
- Comandos de verificación:
  - `npm run prisma:generate`
  - `npm run lint` — verde.
  - `npm run typecheck` — verde.
  - `npm run test` — 1.631 verdes, 4 omitidos.
  - `npm run test:http` — 97 verdes.
  - `npm run test:integration` — 69 verdes con un rol temporal sin
    `BYPASSRLS` y una base temporal desechable.
  - `npm run check:tests-base` — verde.

## Decisiones

1. El paquete declara las ocho claves, estados por defecto, dependencias,
   parámetros y alertas; la empresa sólo persiste un override de estado por
   módulo. La alternativa era guardar una copia del catálogo por empresa, pero
   habría permitido que apagar un módulo destruyera o duplicara su contrato.
   Con el override separado, reactivarlo conserva los datos operativos.
2. Se reutilizó `PaqueteRubro.seedParameters` como catálogo declarativo de
   preguntas y opciones, en vez de sumar otra columna JSON. Es información de
   paquete con el mismo alcance y evita dos catálogos que puedan desalinearse.
   El motor conserva sus defaults puros para calcular; la API obtiene qué
   mostrar desde el paquete.
3. `unidad_gestion` actualiza `Company.unidadGestionId` contra una
   `UnidadMedida` ya existente de la empresa. No se crea una unidad al vuelo:
   una respuesta de onboarding no debe fabricar una unidad de conversión sin su
   factor y trazabilidad.
4. No se incluyeron pantallas ni botones concretos en el backend. El contrato
   agregado al issue aclara que el frontend los mapea en su propio issue; acá se
   devuelve la clave y el contenido de negocio necesario.

## Dónde el issue no alcanzaba

El cuerpo inicial no definía los módulos, defaults, dependencias ni las
opciones. El comentario de contrato del 11-09-2026 los completó y fue la fuente
usada. La base local de desarrollo tenía una deriva histórica de migraciones no
relacionada; no se reseteó ni modificó. La migración se generó y verificó en una
base temporal desde el historial completo de `dev`.

## Qué quedó afuera

- La traducción de las claves de módulo a pantallas y botones queda en
  `CosteAR-frontend#157`.
- No se tocó el motor de cálculo, períodos cerrados ni la pestaña existente de
  parámetros fuera de la exposición del nuevo catálogo.
