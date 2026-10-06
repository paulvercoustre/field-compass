import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['frontend/**/*.test.{ts,tsx}'],
    setupFiles: ['frontend/test-setup.ts'],
  },
});
