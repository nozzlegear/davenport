import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Davenport',
      fileName: 'index',
      formats: ['es'],
    },
  },
  plugins: [
    dts({ entryRoot: 'src' }),
    {
      name: 'copy-types',
      closeBundle() {
        copyFileSync(
          resolve(__dirname, 'src/types.d.ts'),
          resolve(__dirname, 'dist/types.d.ts')
        );
      },
    },
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.ts'],
  },
});
