import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // NOTE: do not add a `define` block that inlines secrets here. `define`
      // is a literal text substitution into the CLIENT bundle, so anything
      // placed in it is served in plaintext to every visitor. Values the
      // browser may legitimately see belong in VITE_-prefixed env vars.
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
