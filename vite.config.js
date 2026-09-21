import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // чтобы dist/index.html открывался через file://
  server: { port: Number(process.env.DEV_PORT) || 5173, strictPort: true },
});
