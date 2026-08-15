/**
 * Validación de los mensajes de commit (Conventional Commits).
 * Corre en el hook `.husky/commit-msg` — si el mensaje no cumple, el commit se rechaza.
 *
 * Formato:  <tipo>(<scope>): <descripción en imperativo>
 * Ejemplo:  feat(costeo): agregar cálculo de producción equivalente
 *
 * Las reglas completas están en CLAUDE.md §3 y en CONTRIBUTING.md.
 *
 * Nota: los tres repos son ESM (`"type": "module"` en package.json), por eso esto es
 * `export default` y no `module.exports` — con CommonJS acá, commitlint explota.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
    // Escribimos en español: no exigimos minúscula estricta en el asunto.
    'subject-case': [0],
    // Los mensajes descriptivos son largos; 100 caracteres queda corto en español.
    'header-max-length': [2, 'always', 120],
    // El cuerpo del commit puede tener líneas largas (URLs, salidas de comandos).
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
