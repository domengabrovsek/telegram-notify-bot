import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    target: 'node24',
    outDir: 'dist',
    lib: {
      entry: resolve(import.meta.dirname, 'index.ts'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    rollupOptions: {
      external: [/^@aws-sdk\//, /^node:/, 'undici'],
    },
    minify: false,
    sourcemap: false,
  },
});
