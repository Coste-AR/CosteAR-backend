---
paths:
  - "prisma/**"
  - "src/domain/**"
  - "src/application/**"
---

# Reglas duras del dominio de costeo (no negociables)

> Extraído de `CLAUDE.md` el 22-08-2026 (Pieza 1: partir el archivo raíz por rutas). Antes se cargaba
> en TODAS las sesiones; ahora carga solo cuando se toca el motor de costeo o el schema — que es
> exactamente cuando importa. Vienen de la especificación de Trazabilidad Total v1 y de la auditoría
> del motor de cálculo.

|ID|Regla|
|---|---|
|**DOM-01**|**Nada se pisa.** Los valores de costos se **versionan** (append-only). Borrado = lógico. Jamás un `DELETE` o `UPDATE` destructivo sobre datos ya cargados.|
|**DOM-02**|**Toda mutación escribe su entrada de bitácora en la misma transacción** (rollback conjunto).|
|**DOM-03**|Timestamps del **servidor**, en `timestamptz`. Nunca la hora del cliente.|
|**DOM-04**|**Ningún 500 crudo al usuario.** Errores de cálculo o validación → 422 con `{code, message, field}` en español accionable.|
|**DOM-05**|**Regresión cero en la matemática.** Los fixtures del caso "Piezas mecánicas de precisión" y los tres casos de ITCS de la cátedra tienen que seguir dando exactamente lo mismo después de cualquier cambio en el motor.|
|**DOM-06**|Migraciones **siempre aditivas** (`CREATE TABLE`, `ALTER ADD COLUMN`). Nada de `DROP` sobre tablas con datos.|
|**DOM-07**|El aislamiento entre empresas depende de **RLS en Postgres**, no de TypeScript. Un test con Prisma mockeado no prueba aislamiento — por eso existe la suite de integración con un rol sin `BYPASSRLS`.|

---
