import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Davenport',
      fileName: 'index',
      formats: ['es'],
    },
  },
  plugins: [dts({ rollupTypes: true })],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.ts'],
  },
});
