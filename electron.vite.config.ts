import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  main: { build: { outDir: 'dist/main', rollupOptions: { input: { index: 'src/main/index.ts', 'rename-worker': 'src/main/rename-worker.ts' } } } },
  preload: { build: { outDir: 'dist/preload' } },
  renderer: { plugins: [react()], build: { outDir: 'dist/renderer' } }
})
