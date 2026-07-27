// @ts-check
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

/**
 * Configuración de ESLint 9 (formato "flat").
 *
 * Por qué existe: el repo tenía `eslint` v9 en las dependencias y el script
 * `npm run lint`, pero ningún archivo de configuración — desde v9 el formato
 * `.eslintrc` dejó de leerse por defecto. Resultado: el script fallaba SIEMPRE,
 * con lo cual el linter no cubría nada y el único gate real era `tsc` + la suite.
 *
 * Criterio de esta config: que el linter aporte lo que `tsc` NO ve, sin
 * convertirse en un muro de ruido sobre código que ya está en producción. Las
 * reglas que dependen de información de tipos (`recommendedTypeChecked`) quedan
 * fuera a propósito: son valiosas pero exigen otra pasada de compilación y
 * dispararían cientos de hallazgos preexistentes de golpe. Se pueden sumar
 * después, archivo por archivo.
 */
export default [
  {
    // Nada de esto es código fuente del proyecto.
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'prisma/migrations/**',
      'graphify-out/**',
      '*.config.js',
    ],
  },

  {
    // Los `eslint-disable` del equipo apuntan a reglas que esta config todavía
    // no habilita (ej. `no-console`). Reportarlos como "sin usar" sería pedir
    // que se borren comentarios que vuelven a hacer falta apenas se suba el
    // nivel del linter.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },

  js.configs.recommended,

  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
      globals: { ...globals.node },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // Estas dos reglas base NO entienden TypeScript y dan falsos positivos:
      //   · `no-undef` no conoce los tipos ambiente (`RequestInit`, `NodeJS.*`)
      //     y los marca como variables inexistentes. `tsc` ya cubre esto, y
      //     mejor: si un identificador no existe, el build falla.
      //   · `no-redeclare` lee las SOBRECARGAS de función como redeclaraciones.
      // Desactivarlas es la recomendación oficial de typescript-eslint.
      'no-undef': 'off',
      'no-redeclare': 'off',

      // `tsc` ya reporta las variables sin usar con más precisión (y el build
      // falla por ellas). Acá solo se mantiene el prefijo `_` como forma
      // explícita de decir "esto se ignora a propósito".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // El código convive con formas de Prisma y payloads externos donde `any`
      // es una decisión tomada y comentada. Se avisa, no se corta el build.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Deja pasar `catch (e) {}` vacío solo si la variable va con `_`.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    // Los scripts de mantenimiento son JS plano de Node.
    files: ['scripts/**/*.mjs', 'prisma/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  {
    // La demo estática corre en el NAVEGADOR, no en Node: sus globales son
    // `document`, `location` y `fetch`, no `process`.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },

  {
    // En los tests se mockea con formas parciales a propósito.
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
];
