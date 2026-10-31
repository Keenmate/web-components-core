import { defineComponentConfig } from '@keenmate/web-components-devkit/vite';

// Core is a LIBRARY: the package build is `npm run build` (tsc -p tsconfig.build.json
// → dist/, ESM + .d.ts per module). Vite is used only for the dev server
// (`npm run dev`, kmwc.ports.dev) and the static examples site
// (`npm run build:examples` → dist-examples/). The devkit's plain `vite build`
// is its library mode (UMD bundle into dist/, emptyOutDir) — refused here so it
// can't clobber the tsc output.
export default defineComponentConfig({
  overrides: {
    // Dev dep-scan only the real pages — not stray HTML in test-results/ etc.
    optimizeDeps: { entries: ['index.html', 'examples-*.html', 'test/*.html'] },
  },
  getOverridesCallback: (env) => {
    if (env.command === 'build' && env.mode !== 'examples') {
      throw new Error(
        'web-components-core: plain `vite build` is not the package build. ' +
          'Use `npm run build` (tsc → dist/) or `npm run build:examples` (examples site).',
      );
    }
    return {};
  },
});
