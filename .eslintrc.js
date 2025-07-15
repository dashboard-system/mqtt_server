module.exports = {
  env: {
    browser: false,
    commonjs: true,
    es2021: true,
    node: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'off', // Allow console.log for server applications
    'prefer-const': 'error',
    'no-var': 'error',
    eqeqeq: 'error',
    curly: 'error',
    'no-multi-spaces': 'error',
    'no-trailing-spaces': 'error',
    'comma-dangle': ['error', 'always-multiline'],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'never'],
    indent: ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'max-len': ['warn', { code: 100, ignoreUrls: true }],
  },
  globals: {
    process: 'readonly',
    Buffer: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
  },
}