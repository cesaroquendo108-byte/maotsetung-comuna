import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://uroprofin.vercel.app',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            if (id.includes('leaflet') || id.includes('react-leaflet')) {
              return 'vendor-leaflet';
            }
            if (id.includes('pocketbase')) {
              return 'vendor-pocketbase';
            }
            if (id.includes('echarts') || id.includes('zrender')) {
              return 'vendor-echarts';
            }
            return 'vendor';
          }
        },
      },
    },
  },
});
