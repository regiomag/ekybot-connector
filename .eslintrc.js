module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    // Code quality
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'off', // CLI tool needs console output
    'prefer-const': 'error',
    'no-var': 'error',

    // Security
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',

    // Async/Await
    'prefer-promise-reject-errors': 'error',
    'no-async-promise-executor': 'error',

    // Best practices
    eqeqeq: ['error', 'always'],
    curly: ['error', 'all'],
    'no-throw-literal': 'error',
  },
  overrides: [
    {
      files: ['scripts/*.js'],
      rules: {
        'no-process-exit': 'off', // CLI scripts can use process.exit
      },
    },
  ],
};
