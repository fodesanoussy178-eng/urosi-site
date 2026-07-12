import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Deux pages :
//  - index.html : site vitrine + démo interactive (aucune donnée réelle)
//  - app.html   : l'application React (routes internes /app, /connexion, etc.)
//  - cgu.html / confidentialite.html : pages légales statiques
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        app: path.resolve(__dirname, 'app.html'),
        cgu: path.resolve(__dirname, 'cgu.html'),
        confidentialite: path.resolve(__dirname, 'confidentialite.html'),
      },
    },
  },
});
