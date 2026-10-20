import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the deploy workflow sets BASE_PATH. Defaults to the domain root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  test: { testTimeout: 120_000 }
} as Parameters<typeof defineConfig>[0]);
