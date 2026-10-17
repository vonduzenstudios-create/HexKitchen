// Bundle a TS entry with rolldown (ships with vite) and run it in node.
// Usage: node dev/run-node.mjs dev/g2p-test.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(process.argv[2]);
const dir = mkdtempSync(join(tmpdir(), 'hk-'));
const out = join(dir, 'out.mjs');
execFileSync(join(root, 'node_modules/.bin/rolldown'), [entry, '-o', out, '-f', 'esm', '-p', 'node'], { stdio: ['ignore', 'ignore', 'inherit'], cwd: root });
await import(out);
