// Every browser check for the extension, one after another (each starts its own Chrome).
//   node tools/extension-e2e/all.mjs        or, in Extension/:  npm run test:e2e
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = ['board', 'conflict', 'recur', 'reports', 'popup', 'drawer', 'lists', 'chat', 'stage6', 'sidepanel', 'appfocus'];
const failed = [];
for (const name of SCRIPTS) {
  console.log(`\n▶ ${name}`);
  const r = spawnSync(process.execPath, [path.join(here, `${name}.mjs`)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(name);
}
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : `\nAll ${SCRIPTS.length} browser checks passed.`);
process.exit(failed.length ? 1 : 0);
