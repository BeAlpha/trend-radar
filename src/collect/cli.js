// node src/collect/cli.js --country US [--date YYYY-MM-DD] [--smoke] [--data data]
import { parseArgs } from 'node:util';
import { makeAppleClient, COUNTRIES } from '../apple/clients.js';
import { makeRetry } from '../apple/net.js';
import { prefixesFor } from './prefixes.js';
import { runCountry } from './run-country.js';
import { todayUTC } from '../util/dates.js';

const { values } = parseArgs({
  options: {
    country: { type: 'string' },
    date: { type: 'string' },
    data: { type: 'string', default: 'data' },
    smoke: { type: 'boolean', default: false },
  },
});

const country = values.country?.toUpperCase();
if (!COUNTRIES.includes(country)) {
  console.error(`--country trebuie sa fie una din: ${COUNTRIES.join(', ')}`);
  process.exit(2);
}

// --smoke = rulare de proba: putine cereri, ca sa verificam ca totul merge cap-coada.
const budget = values.smoke
  ? { prefixes: prefixesFor(country).slice(0, 30), expandMax: 10, chartGenres: [6014, 6008], classifyMax: 20 }
  : {};

const apple = makeAppleClient({ retry: makeRetry({ log: console.log }) });
const summary = await runCountry({
  country, date: values.date ?? todayUTC(), dataDir: values.data, apple, budget, smoke: values.smoke,
});
// Iesim cu 0 si la zi incompleta: datele partiale tot se salveaza; finalize o marcheaza.
console.log(JSON.stringify(summary));
