import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every --base-* fallback in src/ equals the @keenmate/base-css-variables contract default (713cb52);
// deliberate differences live in contract-check.json (read by the checker from the repo root).
const ROOT = process.cwd(); // vitest runs from the repo root (like styles.test.ts' manifest read)
const CHECKER = resolve(ROOT, 'node_modules/@keenmate/base-css-variables/bin/check-contract.mjs');

describe('base-css-variables contract', () => {
  it('src/ has no non-allowlisted contract findings', () => {
    expect(existsSync(CHECKER), `missing ${CHECKER} (devDependency @keenmate/base-css-variables)`).toBe(true);
    const run = spawnSync(process.execPath, [CHECKER, 'src'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.error).toBeUndefined();
    expect(run.status, `base-contract-check src failed:\n${run.stdout}\n${run.stderr}`).toBe(0);
  }, 60_000);
});
