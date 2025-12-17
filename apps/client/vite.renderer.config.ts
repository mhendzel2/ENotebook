import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../..', 'packages/shared/src')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
