import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

function localAppRoutes(): Plugin {
  return {
    name: 'urosi-local-app-routes',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = request.url ?? '';
        const [pathname, query] = url.split('?');
        if (pathname === '/demo') request.url = `/app.html${query ? `?${query}` : ''}`;
        next();
      });
    },
  };
}

// Deux pages :
//  - index.html : site vitrine + démo interactive (aucune donnée réelle)
//  - app.html   : l'application React (routes internes /app, /connexion, etc.)
//  - cgu.html / confidentialite.html : pages légales statiques
export default defineConfig({
  plugins: [localAppRoutes(), react()],
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
      output: {
        // Les gros vendors changent rarement : les isoler stabilise le cache
        // navigateur entre deux deploiements du code applicatif.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
