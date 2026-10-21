import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Build version for problem reports: the commit (CI sets GITHUB_SHA), else the local commit, else 'dev'.
const version = (() => {
  try { return (process.env.GITHUB_SHA || execSync('git rev-parse HEAD').toString()).trim().slice(0, 7); } catch { return 'dev'; }
})();

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the deploy workflow sets BASE_PATH. Defaults to the domain root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: { testTimeout: 120_000 }
} as Parameters<typeof defineConfig>[0]);
