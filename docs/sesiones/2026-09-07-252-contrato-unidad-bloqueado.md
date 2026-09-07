# Bitácora de sesión — #252 contrato de unidad bloqueado

## Recursos y verificaciones

- Tokens: no informado.
- `npm.cmd run briefing`: salida 0; confirmó que la copia inicial estaba siete commits detrás de
  `origin/dev`.
- `gh issue list --repo Coste-AR/CosteAR-backend --state open --label listo --json number,title --limit 100`:
  devolvió solamente `#252`.
- `gh issue view 251` y `git log HEAD..origin/dev`: #251 cerró el ajuste del perfil avícola; los
  siete commits posteriores en `dev` son dependencias, el barrido de desbloqueo y métricas.
- `git show origin/dev:prisma/schema.prisma` y
  `git grep -n -i -E "unidadGestion|gestion.*unidad|management.*unit" origin/dev -- prisma src tests docs`:
  no existe un selector de unidad de gestión por empresa en `origin/dev`.

## Decisión

- No se implementó #252. La alternativa habría sido tomar `IndustryProfile.measurementUnit` como
  unidad del tenant; se descartó porque es una configuración por perfil y no una declaración del
  tenant. Habría vuelto a introducir el valor por defecto que el issue prohíbe.
- No se agregó otro comentario al issue: ya existe uno que enumera la misma ausencia de contrato
  y pide definir cómo representar una referencia inexistente. Repetirlo no aporta información.

## Dónde el issue no alcanza

- Falta un contrato persistido que identifique la unidad de gestión de `Company` (por ejemplo, una
  FK a `UnidadMedida` o un código explícito) y el comportamiento HTTP cuando esa referencia es
  inválida. Sin ambos no se puede devolver la unidad ni probar el camino de falla sin inventar
  datos.

## Fuera de alcance

- No se cambió el motor, el esquema, endpoints, tests ni etiquetas.
- No se abrió PR para #252: no hay una implementación honesta que pueda cerrarlo.
