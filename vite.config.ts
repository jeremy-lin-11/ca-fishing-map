import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { testTimeout: 120_000 }
} as Parameters<typeof defineConfig>[0]);
