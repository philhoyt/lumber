import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the built dist/ folder runs from any static host or subfolder.
  base: './',
  server: { port: 5173, strictPort: true },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
