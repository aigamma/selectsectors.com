import { defineConfig } from 'vitest/config';

// Vitest config for the function-layer tests. Frontend tests would use
// the jsdom or happy-dom environment; backend pure-logic tests run in
// the default node environment. Add a separate workspace later if we
// ever need both.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'netlify/functions/**/__tests__/**/*.test.mts',
      'src/__tests__/**/*.test.ts',
    ],
    // .mts files import each other with explicit extensions which the
    // Vitest resolver needs help with on Node 22.
    server: {
      deps: {
        inline: ['@netlify/functions', '@netlify/blobs'],
      },
    },
  },
});
