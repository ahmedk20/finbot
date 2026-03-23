import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    // Sequential execution — integration tests share a real DB
    maxWorkers:  1,
    minWorkers:  1,
    setupFiles:  ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include:  ['src/**/*.ts'],
      exclude:  ['src/**/*.test.ts', 'src/shared/db/**', 'src/types/**', 'src/test/**'],
    },
  },
});
