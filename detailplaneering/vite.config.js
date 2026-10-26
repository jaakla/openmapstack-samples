import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './', server: {watch: {ignored: ['**/.venv/**', '**/data/source/**', '**/data/derived/**', '**/runs/**', '**/validation/**']}}, build: {chunkSizeWarningLimit: 3000,rollupOptions:{output:{inlineDynamicImports:true}}} });
