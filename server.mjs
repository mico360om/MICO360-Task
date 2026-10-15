// Starts MICO360 Tasks from the repository root: brings the database up to date, then starts the
// API, which also serves the web app. `npm start` runs this, and so do hosts that start an app by
// running one file with Node (a Hostinger Node.js web app: framework "Fastify", entry file
// "server.mjs"). Build first with `npm run build`.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(root, 'Web Portal', 'backend');

// The API reads its .env and resolves relative paths (uploads, the web app) from its own folder,
// whatever folder the host started Node in.
process.chdir(backend);
// Serve the built web app from the same address unless the host's settings say otherwise.
process.env.WEB_ROOT ||= path.join(root, 'Web Portal', 'frontend', 'dist');

// Apply any pending database migrations (none on most starts) before serving.
const prismaCli = createRequire(path.join(backend, 'package.json')).resolve('prisma/build/index.js');
const migrate = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { stdio: 'inherit' });
if (migrate.status !== 0) {
  console.error('The database could not be brought up to date, so the server was not started.');
  process.exit(migrate.status ?? 1);
}

await import(pathToFileURL(path.join(backend, 'dist', 'src', 'server.js')).href);
