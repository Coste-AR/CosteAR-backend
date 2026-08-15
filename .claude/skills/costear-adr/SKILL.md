---
name: costear-adr
description: >
  Crea un ADR (registro de decisión de arquitectura) numerado en docs/adr/ del repo actual de
  CosteAR, con contexto, alternativas descartadas y consecuencias.
  Trigger: "crear ADR", "nuevo ADR", "documentar la decisión", "registrar decisión",
  "adr", "por qué decidimos esto", o cuando se toma una decisión técnica no obvia.
---

# CosteAR — Crear ADR

Crea un ADR numerado en `docs/adr/` **del repo actual**, para que la decisión viaje junto al
código que la implementa y se revise en el mismo PR.

**Ejecuta directamente.**

---

## Cuándo corresponde un ADR

**Sí:**

- Se eligió entre dos librerías, patrones o enfoques
- La decisión le va a parecer rara a alguien sin el contexto
- Se hizo algo "mal a propósito" por una restricción real (tiempo, plata, plan de GitHub)
- Un cambio de modelo de datos que condiciona lo que viene
- Cualquier cosa que afecte plata del cliente o la matemática del costeo

**No:**

- Cómo se llama una variable
- Aplicar un patrón ya establecido en el repo
- Algo que el código explica solo

> Regla práctica: **si lo pensaste más de diez minutos o lo discutiste con alguien, es un ADR.**

---

## Pasos

```bash
# 1. Ver cuál es el próximo número (correlativo, 4 dígitos, nunca se reutiliza)
ls docs/adr/ | grep -E '^[0-9]{4}-' | sort | tail -1
```

```bash
# 2. Crear el archivo desde la plantilla
cp docs/adr/_template.md docs/adr/NNNN-<slug-en-imperativo>.md
```

3. Completar **todas** las secciones. Las dos que no se pueden dejar vacías son
   **Alternativas consideradas** y **Consecuencias / lo que aceptamos pagar** — son las que le
   dan valor al ADR dentro de seis meses.

4. Agregar la línea al índice de `docs/adr/README.md` (más reciente arriba).

5. Commitear **en el mismo PR que implementa la decisión**:

```bash
git add docs/adr/
git commit -m "docs(adr): registrar decisión sobre <tema>"
```

---

## Reglas

| Regla | Detalle |
| --- | --- |
| **Un ADR nunca se borra ni se reescribe** | Si la decisión cambió, se escribe uno nuevo y el viejo pasa a `Superada por NNNN`. La historia de por qué cambiamos de opinión es la parte más útil |
| **Numeración correlativa** | 4 dígitos, nunca se reutiliza un número |
| **Escrito para dentro de seis meses** | Quien lo lea no va a tener nada del contexto de hoy |
| **Las alternativas descartadas son obligatorias** | Si no evaluaste ninguna, escribí eso — también es información |
| **Toda decisión tiene un costo** | Si en "en contra" no encontrás nada, no la pensaste lo suficiente |
| **Va en el repo donde vive el código** | Si la decisión cruza repos, el ADR va donde está el grueso de la implementación y se referencia desde el otro |

---

## Estados

| Estado | Significa |
| --- | --- |
| `Propuesta` | Escrita, todavía no acordada |
| `Aceptada` | En vigencia |
| `Superada por NNNN` | Ya no aplica, se conserva para entender el cambio |
| `Descartada` | Se evaluó y se decidió no hacerlo |

---

## Gotchas conocidos

- **No confundir ADR con bitácora.** El ADR explica *por qué el código es así* y lo lee un dev;
  la bitácora cuenta *qué pasó en la sesión* y la lee todo el equipo. Ver `/costear-bitacora`.
- **`DECISIONES.md` en la raíz está cerrado.** Es el registro histórico de Trazabilidad Total v1.
  Nada nuevo va ahí.
- Si la decisión todavía no está tomada y estás explorando, **no es un ADR**: es un issue de
  research con time-box. El ADR se escribe cuando se decidió.
