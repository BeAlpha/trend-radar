// Pasul final din cloud: verifica fisierele zilei si scrie data/status.json.
// node src/collect/finalize.js --date YYYY-MM-DD [--data data]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { COUNTRIES } from '../apple/clients.js';
import { dayPath, readJsonGzSafe } from '../data/files.js';
import { todayUTC } from '../util/dates.js';

export function buildStatus(dataDir, date) {
  const countries = {};
  for (const cc of COUNTRIES) {
    const r = readJsonGzSafe(dayPath(dataDir, date, cc));
    countries[cc] = r.ok
      ? { complete: r.value.complete, requests: r.value.requests, errors: r.value.errors }
      : { missing: true, error: r.error };
  }
  return { lastRun: date, finishedAt: new Date().toISOString(), countries };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { date: { type: 'string' }, data: { type: 'string', default: 'data' } } });
  const status = buildStatus(values.data, values.date ?? todayUTC());
  fs.mkdirSync(values.data, { recursive: true });
  fs.writeFileSync(path.join(values.data, 'status.json'), `${JSON.stringify(status, null, 2)}\n`);
  console.log(JSON.stringify(status, null, 2));
}
