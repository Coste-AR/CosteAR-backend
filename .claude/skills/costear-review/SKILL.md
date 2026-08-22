---
name: costear-review
description: >
  Revisa un PR o un diff de CosteAR contra las convenciones del equipo y los antipatrones
  conocidos, clasificando cada hallazgo en CRITICAL, WARNING o SUGGESTION.
  Trigger: "revisar PR", "code review", "revisar el código", "está bien esto", "validar PR",
  "revisá el diff", o cuando hay un PR o un cambio que revisar antes de mergear.
---

# CosteAR — Code Review

Revisa un PR o el diff local contra las convenciones del equipo, los antipatrones ya vistos y
las reglas duras del dominio. Reporta **CRITICAL** (bloquea el merge) / **WARNING** (habría que
arreglarlo) / **SUGGESTION** (opcional).

---

## Cómo correrlo

```bash
# Opción A — un PR por número
gh pr diff <N>
gh pr view <N> --json body --jq '.body'

# Opción B — los cambios locales
git diff origin/dev...HEAD

# Opción C — un archivo puntual
```

Después aplicar los checklists de abajo **en orden**.

---

## 1. Reglas duras del dominio (backend) — CRITICAL

Vienen de la spec de Trazabilidad Total v1 y de la auditoría del motor. Violar una de estas es
bloqueante sin discusión.

- [ ] **Nada se pisa:** ningún `DELETE` ni `UPDATE` destructivo sobre datos cargados. Los costos
      se **versionan**; el borrado es lógico.
- [ ] **Toda mutación escribe su bitácora en la misma transacción** (rollback conjunto).
- [ ] Timestamps del **servidor**, en `timestamptz`. Nunca la hora del cliente.
- [ ] **Ningún 500 crudo al usuario:** errores de cálculo o validación → 422 con
      `{code, message, field}` en español accionable.
- [ ] **Migraciones aditivas.** Nada de `DROP` sobre tablas con datos.
- [ ] Si el diff toca el **motor de cálculo**: los fixtures de "Piezas mecánicas de precisión" y
      los tres casos de ITCS de la cátedra siguen dando exactamente lo mismo.
- [ ] Si el diff toca **aislamiento entre empresas**: hay cobertura en la suite de integración,
      no solo tests con Prisma mockeado. *Un mock confirma que se llamó a `findFirst` con cierto
      `where`; no prueba que la base no devuelva las filas del otro inquilino.*

---

## 2. Antipatrones generales

**CRITICAL**

- [ ] Errores tragados: `catch {}` sin re-lanzar, loguear ni manejar
- [ ] Secretos, tokens o credenciales hardcodeados
- [ ] Bloques de código comentado (código muerto) que quedaron
- [ ] Patrón N+1: un loop que consulta la base por iteración habiendo consulta en lote
- [ ] `console.log` de debug olvidado

**WARNING**

- [ ] Funciones o archivos que hacen cosas sin relación entre sí
- [ ] Números o strings mágicos repetidos 3+ veces sin constante con nombre
- [ ] Anidamiento de 4+ niveles donde un `return` temprano aplanaría
- [ ] Lógica duplicada que ya existe en el repo (**buscala antes de marcarlo**)
- [ ] Nombres que no siguen la convención de los archivos de al lado
- [ ] Variable de entorno nueva sin agregar a `.env.example`

**SUGGESTION**

- [ ] Los nombres comunican la intención sin necesitar comentario
- [ ] Un condicional complejo podría ser un booleano con nombre

---

## 3. Backend

**CRITICAL**

- [ ] No se accede a `process.env` fuera de los módulos de configuración
- [ ] Ninguna ruta nueva se saltea la autenticación sin marcarla explícitamente como pública
- [ ] No se instancia el cliente de Prisma inline — se usa el que ya está inyectado
- [ ] Los cambios de schema traen su archivo de migración

**WARNING**

- [ ] Cada service nuevo tiene su archivo de tests al lado
- [ ] Los DTOs nuevos validan la entrada
- [ ] La paginación usa el helper compartido, no `page`/`limit` propios

---

## 4. Frontend

**CRITICAL**

- [ ] Nada de `fetch` o `axios` directo dentro de componentes — todo por hooks de TanStack Query
- [ ] Zustand no guarda estado del servidor (es para sesión y UI)
- [ ] Ninguna URL de API hardcodeada
- [ ] El access token no se guarda en `localStorage` (decisión de seguridad tomada)
- [ ] Ningún `.env` commiteado

**WARNING**

- [ ] Las rutas nuevas siguen la estructura de TanStack Router
- [ ] Notificaciones con la librería de toasts del proyecto, no `alert()`
- [ ] Los números que se muestran vienen del backend — **el frontend no recalcula costos**

---

## 5. Reutilización y design system

La parte que casi todos saltean, y la que más deuda genera.

**CRITICAL**

- [ ] El componente nuevo **no duplica** una primitiva que ya existe (botón, input, modal, card).
      Buscar en la carpeta de UI compartida **antes** de aprobar uno nuevo.
- [ ] Sin colores en hex crudo, spacing arbitrario ni tamaños de fuente sueltos donde hay token
      de Tailwind. La identidad es el granate de "Identidad Visual v1.0".
- [ ] Sin bloques de JSX copiados y pegados >80% idénticos a un componente existente

**WARNING**

- [ ] El componente nuevo tiene los estados que corresponden: default, hover, focus-visible,
      active, disabled, loading, error
- [ ] Accesibilidad básica: foco visible, navegación por teclado, contraste
- [ ] Si el componente es genérico, va a la librería compartida y no enterrado en una feature
      (si no, se duplica de nuevo en dos meses)

---

## 6. Proceso

**CRITICAL**

- [ ] El PR apunta a `dev` (no a `main` ni a `staging`, salvo que sea una promoción)
- [ ] Tiene issue vinculado, con `Closes #N` o `part of #N` según corresponda

**WARNING**

- [ ] Los commits son convencionales y atómicos
- [ ] Hay una decisión no trivial sin ADR en `docs/adr/`
- [ ] El PR es tan grande que no se puede revisar de verdad — proponer partirlo

---

## Formato de salida

```
### CRITICAL
1. [archivo:línea] hallazgo — por qué bloquea

### WARNING
1. [archivo:línea] hallazgo

### SUGGESTION
1. [archivo:línea] hallazgo

### PASSED ✅
<una línea de resumen>
```

Si no hay hallazgos, solo `### PASSED ✅` con el resumen.

---

## Gotchas conocidos

- **No marques como duplicado sin haber buscado.** Antes de decir "esto ya existe", corré el
  `grep`. Una acusación falsa de duplicación hace perder más tiempo del que ahorra.
- **Los tests en verde no son evidencia de que el flujo ande.** Si el PR toca UI o flujo y el
  checklist manual está vacío, eso solo ya es un WARNING.
- Un diff que solo reformatea igual hay que **mirarlo crudo**: ya pasó que se colara un cambio
  de lógica dentro de un "solo prettier".
