import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Works whether npm workspaces hoist react to the repo root or keep it in client/node_modules
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '0.0.0.0', // Allow connections from phone/tablet on local WiFi
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
      },
    },
  },
});

