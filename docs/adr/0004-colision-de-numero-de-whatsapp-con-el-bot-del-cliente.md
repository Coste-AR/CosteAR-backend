# 0004 — Colisión de número de WhatsApp con el bot del cliente

- **Fecha:** 2026-08-18
- **Estado:** **Abierta** — este ADR plantea las opciones, no elige
- **Decide:** el equipo, con el cliente. **No el equipo técnico solo**
- **Contexto de origen:** plan del vertical avícola, decisión D-06

## Contexto

CosteAR recibe datos de campo por un webhook de WhatsApp: un operario manda un mensaje y el dato entra al costo.

El problema es que **el cliente del vertical ya tiene su propio bot de WhatsApp**, con canales armados y gente acostumbrada a usarlo.

Y hay una restricción de la plataforma que no se puede negociar:

> **Un número de WhatsApp Business admite un solo webhook.**

No es una limitación nuestra ni algo que se resuelva programando mejor: es cómo funciona la API de Meta. Si el número del cliente ya apunta a su bot, no puede apuntar también al nuestro.

Entonces hay que elegir, y **la elección no es técnica**: es sobre quién es el dueño de la relación con el operario que manda el mensaje.

## Decisión

**Sin tomar.** Se documentan las tres opciones con sus consecuencias para que la decida quien corresponde.

Este ADR se actualiza cuando se resuelva.

## Las tres opciones

### A · CosteAR se integra detrás del bot del cliente

El número sigue apuntando al bot del cliente. Ese bot reenvía a CosteAR lo que nos corresponde.

| A favor | En contra |
|---|---|
| El operario **no cambia nada**: sigue escribiendo al mismo número que ya conoce | **Dependemos de un sistema que no controlamos.** Si su bot se cae o cambia, dejamos de recibir datos y nos enteramos tarde |
| Un solo canal para el operario, sin confusión | Requiere que **alguien del lado del cliente programe** el reenvío y lo mantenga |
| No hay que dar de alta un número nuevo | La trazabilidad se corta: el mensaje pasa por un intermediario del que no tenemos log |

### B · CosteAR reemplaza al bot del cliente

El número pasa a apuntar a nuestro webhook y absorbemos lo que hacía el bot.

| A favor | En contra |
|---|---|
| Control total del canal, log completo, sin intermediarios | **Nos hacemos cargo de funcionalidad que hoy no tenemos.** Su bot ya hace cosas que a él le sirven |
| Una sola cosa que mantener | Si algo de lo que él usaba deja de andar, **la culpa es nuestra** aunque no fuera parte del trato |
| | Es la opción de mayor alcance y la más difícil de revertir |

### C · Número distinto para CosteAR

Damos de alta un número propio.

| A favor | En contra |
|---|---|
| **Independencia total.** No dependemos de su bot ni nos hacemos cargo del suyo | El operario tiene que **acordarse de a cuál escribir**. Y va a equivocarse |
| Es la más rápida de implementar y la más fácil de revertir | Un mensaje al número equivocado **se pierde igual** que antes |
| Los datos entran directo, con trazabilidad completa | Hay que dar de alta y verificar un número nuevo con Meta |

## Lo que hay que preguntarle al cliente para poder decidir

1. **¿Qué hace hoy su bot?** Si son cosas ajenas al costeo, B queda descartada.
2. **¿Quién lo mantiene?** Si no hay nadie, A es frágil desde el día uno.
3. **¿Cuántas personas mandan datos?** Con dos o tres, el riesgo de C —escribir al número equivocado— es manejable. Con quince, no.

## Recomendación técnica, que no es la decisión

Si hubiera que elegir **solo** por criterio técnico, **C** es la más segura: es la única que no nos ata a un sistema ajeno ni nos hace responsables de funcionalidad que no escribimos, y es la más fácil de deshacer si sale mal.

Pero el costo de C lo paga el operario, no nosotros. **Esa parte de la decisión no es técnica.**

## Consecuencia mientras siga abierta

Hoy el webhook **existe y funciona para texto**. Lo que no se puede hacer todavía es procesar fotos ni responder al remitente, porque falta el token de acceso a la Graph API — y ese token depende de qué número se use, o sea, de esta decisión.

Mientras tanto, un mensaje no soportado **genera una alerta al equipo con los datos para actuar** en vez de desaparecer. Es la diferencia entre un dato perdido y un dato pendiente, pero **no reemplaza resolver esto**.
