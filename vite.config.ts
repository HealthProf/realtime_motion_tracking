import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative base so the build works at any GitHub Pages path.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        lab: resolve(import.meta.dirname, 'lab.html'),
        course: resolve(import.meta.dirname, 'course.html'),
      },
    },
  },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
