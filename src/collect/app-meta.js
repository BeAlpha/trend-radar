// Data lansarii (si cateva date stabile) pentru app-urile din topuri pe care nu le stim inca.
// Fiecare app e cerut o singura data pe tara; rezultatul se adauga in data/apps/<date>/<CC>.json.gz.
import { appsPath, writeJsonGz, readCountryAppMeta } from '../data/files.js';

export const LOOKUP_BATCH = 100;

export async function collectAppMeta({ country, date, dataDir, apple, charts, log = console.log, stop = () => false, max = Infinity }) {
  const known = readCountryAppMeta(dataDir, country, { before: date });
  const ids = [...new Set(charts.flatMap((c) => c.apps.map((a) => a.id)))]
    .filter((id) => id && !known.has(id)).slice(0, max);
  log(`[${country}] app-uri noi in topuri: ${ids.length}`);
  const out = {};
  for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
    if (stop()) break;
    const batch = ids.slice(i, i + LOOKUP_BATCH);
    try {
      for (const m of await apple.appMeta(batch, country)) {
        out[m.id] = { name: m.name, genreId: m.genreId, releaseDate: m.releaseDate, seller: m.seller, seenAt: date };
      }
    } catch (err) {
      log(`[${country}] lookup app-uri esuat: ${err.message}`);
    }
  }
  writeJsonGz(appsPath(dataDir, date, country), out);
  return Object.keys(out).length;
}
