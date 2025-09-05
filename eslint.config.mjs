// Minimal ESLint v9 flat config for this repo
// Docs: https://eslint.org/docs/latest/use/configure/configuration-files-new

export default [
  // Ignore generated and runtime folders
  {
    ignores: [
      'node_modules',
      'data',
      'data-backup',
      'logs',
      'logs-backup',
      'public/dist',
      'public/vendor'
    ]
  },

  // Node.js (backend, tools)
  {
    files: ['server.js', 'src/**/*.js', 'tools/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node globals
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart']
    }
  },

  // Browser (frontend)
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Browser globals used in the app
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        // Standard browser APIs
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        URLSearchParams: 'readonly',
        location: 'readonly',
        confirm: 'readonly',
        AbortController: 'readonly',
        // Third-party libs loaded via script tags
        DOMPurify: 'readonly',
        marked: 'readonly',
        Prism: 'readonly',
        // App singletons exposed globally by other scripts
        UIManager: 'readonly',
        StateManager: 'readonly',
        MarkdownProcessor: 'readonly',
        CONFIG: 'readonly',
        // Optional hooks used by UI when present
        sendMessage: 'readonly',
        module: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart']
    }
  }
];
