// npm start: descarca datele noi (git pull) -> import in local.db -> porneste interfata.
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, importAll } from './db.js';
import { createServer } from './server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = process.env.DATA_DIR ?? path.join(ROOT, 'data');
const PORT = Number(process.env.PORT ?? 4800);

function gitPull() {
  try {
    const remote = execFileSync('git', ['remote'], { cwd: ROOT }).toString().trim();
    if (!remote) return { pulled: false, warning: 'Depozitul nu are inca remote GitHub (doar date locale).' };
    execFileSync('git', ['pull', '--ff-only', '--quiet'], { cwd: ROOT, stdio: 'pipe', timeout: 60_000 });
    return { pulled: true };
  } catch (err) {
    return { pulled: false, warning: `git pull a esuat, folosesc datele locale: ${err.message.split('\n')[0]}` };
  }
}

const db = openDb(process.env.DB_FILE ?? path.join(ROOT, 'local.db'));

async function refresh() {
  const git = gitPull();
  if (git.warning) console.warn(git.warning);
  const imported = importAll(db, DATA);
  console.log(`Import: ${JSON.stringify(imported)}`);
  return { ...git, imported };
}

await refresh();
createServer({ db, dataDir: DATA, refresh }).listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Trend Radar: ${url}`);
  if (!process.env.NO_OPEN) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
});
