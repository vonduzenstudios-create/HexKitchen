// Bundle a TS entry with rolldown (bundled with vite) and run it in node.
// Usage: node dev/run-node.mjs dev/g2p-test.ts [args]
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const entry = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), 'hk-'));
const out = join(dir, 'out.mjs');
execFileSync('npx', ['rolldown', entry, '-o', out, '-f', 'esm', '-p', 'node'], { stdio: ['ignore', 'ignore', 'inherit'] });
await import(out);
