import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

// Build version for problem reports: the commit (CI sets GITHUB_SHA), else the local commit, else 'dev'.
const version = (() => {
  try { return (process.env.GITHUB_SHA || execSync('git rev-parse HEAD').toString()).trim().slice(0, 7); } catch { return 'dev'; }
})();

// Writes the build's file list and version into dist/sw.js (public/sw.js), so the service worker precaches the app
// on its first install and every deploy installs a fresh worker. Lake tiles aren't precached: saved areas keep their own.
function precacheServiceWorker(): Plugin {
  let files: string[] = [], outDir = 'dist';
  return {
    name: 'precache-service-worker',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    generateBundle(_, bundle) { files = Object.keys(bundle).filter(f => !f.endsWith('.map')); },
    closeBundle() {
      const sw = join(outDir, 'sw.js');
      if (!existsSync(sw)) return;
      const list = ['places.json', ...files.filter(f => f !== 'index.html')].map(f => `./${f}`);
      writeFileSync(sw, readFileSync(sw, 'utf8')
        .replace("const BUILD = 'dev';", `const BUILD = '${version}-${Date.now().toString(36)}';`)
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(list)};`));
    }
  };
}

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the deploy workflow sets BASE_PATH. Defaults to the domain root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), precacheServiceWorker()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: { testTimeout: 120_000 }
} as Parameters<typeof defineConfig>[0]);
