// Completare o singura data: data lansarii pentru app-urile din topurile unei zile deja colectate.
// node src/collect/app-meta-cli.js --date YYYY-MM-DD [--data data]
import { parseArgs } from 'node:util';
import { makeAppleClient, COUNTRIES } from '../apple/clients.js';
import { makeRetry } from '../apple/net.js';
import { dayPath, readJsonGz } from '../data/files.js';
import { collectAppMeta } from './app-meta.js';

const { values } = parseArgs({ options: { date: { type: 'string' }, data: { type: 'string', default: 'data' } } });
const apple = makeAppleClient({ retry: makeRetry({ log: console.log }) });
for (const country of COUNTRIES) {
  const day = readJsonGz(dayPath(values.data, values.date, country));
  const n = await collectAppMeta({ country, date: values.date, dataDir: values.data, apple, charts: day.charts ?? [] });
  console.log(`${country}: ${n} app-uri`);
}
