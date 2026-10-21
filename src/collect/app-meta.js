// Lookup zilnic pentru toate app-urile din topuri si din lansarile noi (loturi de 100):
//  - data/apps:  datele stabile (data lansarii etc.), doar pentru app-urile inca necunoscute;
//  - data/stats: cifrele zilei pentru toate: rating-uri (semnul descarcarilor), versiune, pret;
//  - data/changes: ce s-a schimbat fata de ziua precedenta: nume (test de cuvinte cheie), versiune noua
//    (cu textul noutatilor doar la app-urile din topul incasarilor, ca fisierul sa ramana mic).
import {
  appsPath, statsPath, changesPath, writeJsonGz, readCountryAppMeta, readCountryNames, readLatestStats,
} from '../data/files.js';

export const LOOKUP_BATCH = 100;
// Ordinea campurilor din data/stats (tablou compact, ca fisierul zilnic sa ramana mic).
export const STATS_FIELDS = ['ratings', 'ratingsCur', 'stars', 'version', 'updated', 'price'];
export const NOTES_MAX = 600;
const VERSION = STATS_FIELDS.indexOf('version');

export async function collectAppMeta({ country, date, dataDir, apple, charts, extraIds = [], log = console.log, stop = () => false, max = Infinity }) {
  const known = readCountryAppMeta(dataDir, country, { before: date });
  const names = readCountryNames(dataDir, country, { before: date, known });
  const prev = readLatestStats(dataDir, country, { before: date }) ?? {};
  const grossing = new Set(charts.filter((c) => c.type === 'topgrossingapplications').flatMap((c) => c.apps.map((a) => a.id)));
  const ids = [...new Set([...charts.flatMap((c) => c.apps.map((a) => a.id)), ...extraIds])]
    .filter(Boolean).slice(0, max);
  log(`[${country}] lookup: ${ids.length} app-uri (${ids.filter((id) => !known.has(id)).length} noi)`);
  const meta = {};
  const stats = {};
  const changes = [];
  for (let i = 0; i < ids.length; i += LOOKUP_BATCH) {
    if (stop()) break;
    const batch = ids.slice(i, i + LOOKUP_BATCH);
    try {
      for (const m of await apple.appMeta(batch, country)) {
        stats[m.id] = STATS_FIELDS.map((f) => m[f]);
        const oldName = names.get(m.id);
        if (oldName && m.name && oldName !== m.name) changes.push({ id: m.id, field: 'name', from: oldName, to: m.name });
        const oldVersion = prev[m.id]?.[VERSION];
        if (oldVersion && m.version && oldVersion !== m.version) {
          changes.push({
            id: m.id, field: 'version', from: oldVersion, to: m.version,
            ...(grossing.has(m.id) && m.notes ? { notes: m.notes.slice(0, NOTES_MAX) } : {}),
          });
        }
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
  writeJsonGz(changesPath(dataDir, date, country), changes);
  return { meta: Object.keys(meta).length, stats: Object.keys(stats).length, changes: changes.length };
}
