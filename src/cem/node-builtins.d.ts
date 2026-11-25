// Minimal Node built-in typings for the build-time-only CEM plugins (SPEC §12.4)
// and the Node-side unit tests (src/contract.test.ts),
// so core can avoid a global `@types/node` dependency — which would leak Node
// globals (e.g. `NodeJS.Timeout` for `setTimeout`, `Buffer`) across the whole
// browser library's typecheck. This is a pure ambient declaration file (no
// imports/exports), so `declare module 'node:*'` reads as a standalone ambient
// module declaration rather than an augmentation of a missing module.

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function existsSync(path: string): boolean;
}

declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: string[],
    options: { cwd?: string; encoding: 'utf8' },
  ): { status: number | null; stdout: string; stderr: string; error?: Error };
}

declare module 'node:path' {
  export function resolve(...segments: string[]): string;
  export function dirname(path: string): string;
}

declare var process: { cwd(): string; execPath: string };
