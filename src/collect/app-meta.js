// Lookup zilnic pentru toate app-urile din topuri si din lansarile noi (loturi de 100):
//  - data/apps:  datele stabile (data lansarii etc.), doar pentru app-urile inca necunoscute;
//  - data/stats: cifrele zilei pentru toate: rating-uri (semnul descarcarilor), versiune, pret.
import { appsPath, statsPath, writeJsonGz, readCountryAppMeta } from '../data/files.js';

export const LOOKUP_BATCH = 100;
// Ordinea campurilor din data/stats (tablou compact, ca fisierul zilnic sa ramana mic).
export const STATS_FIELDS = ['ratings', 'ratingsCur', 'stars', 'version', 'updated', 'price'];

export async function collectAppMeta({ country, date, dataDir, apple, charts, extraIds = [], log = console.log, stop = () => false, max = Infinity }) {
  const known = readCountryAppMeta(dataDir, country, { before: date });
  const ids = [...new Set([...charts.flatMap((c) => c.apps.map((a) => a.id)), ...extraIds])]
    .filter(Boolean).slice(0, max);
  log(`[${country}] lookup: ${ids.length} app-uri (${ids.filter((id) => !known.has(id)).length} noi)`);
  const meta = {};
  const stats = {};
  for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
    if (stop()) break;
    const batch = ids.slice(i, i + LOOKUP_BATCH);
    try {
      for (const m of await apple.appMeta(batch, country)) {
        stats[m.id] = STATS_FIELDS.map((f) => m[f]);
        if (!known.has(m.id)) {
          meta[m.id] = { name: m.name, genreId: m.genreId, releaseDate: m.releaseDate, seller: m.seller, seenAt: date };
        }
      }
    } catch (err) {
      log(`[${country}] lookup app-uri esuat: ${err.message}`);
    }
  }
  // Scrise mereu (si goale), ca artefactul din GitHub sa pastreze structura.
  writeJsonGz(appsPath(dataDir, date, country), meta);
  writeJsonGz(statsPath(dataDir, date, country), stats);
  return { meta: Object.keys(meta).length, stats: Object.keys(stats).length };
}
