import { defineComponentConfig } from '@keenmate/web-components-devkit/vite';

// Core is a LIBRARY: the package build is `npm run build` (tsc -p tsconfig.build.json
// → dist/, ESM + .d.ts per module). Vite is used only for the dev server
// (`npm run dev`, kmwc.ports.dev) and the static examples site
// (`npm run build:examples` → dist-examples/). `kmwc.library: false` makes the
// devkit refuse a plain `vite build` (its library mode would empty dist/).
export default defineComponentConfig({
  overrides: {
    // Dev dep-scan only the real pages — not stray HTML in test-results/ etc.
    optimizeDeps: { entries: ['index.html', 'examples-*.html', 'test/*.html'] },
  },
});
