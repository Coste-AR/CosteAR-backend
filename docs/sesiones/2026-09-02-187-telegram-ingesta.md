# Bitácora — issue #187: canal Telegram

## Asociación de identidad

Se asumió que un chat privado de Telegram se vincula a una sola
`OperatorMembership`, no directamente a la empresa. Así se conoce a la vez la
persona que envió el dato, su conexión activa y la empresa destino. El chat es
único globalmente para impedir que un mismo remitente ingrese datos en más de
una empresa.

Un chat ausente, una membresía inactiva o una conexión inactiva no crean una
entrada: dejan una alerta de rechazo con el identificador del chat ofuscado.

## Alcance

El canal solo entrega texto o adjuntos a `ingest-data-entry`. No interpreta
mensajes ni crea hechos de operación. Los botones son únicamente accesos de
campo y no muestran importes ni términos contables.

## Verificación

- `npm ci --force`
- `npm run prisma:generate`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --reporter=dot --silent`
- `npm run test:http` (11 archivos, 73 tests)
- `npm run test:integration` con base desechable y rol sin `BYPASSRLS`
  (1 archivo, 9 tests)
