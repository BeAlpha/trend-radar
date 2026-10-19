// Colectarea zilnica pentru O tara: sugestii -> extindere long-tail -> topuri -> clasificare.
import { prefixesFor } from './prefixes.js';
import { CHART_TYPES } from '../apple/clients.js';
import { CHART_GENRES } from '../apple/genres.js';
import { scoreDay, difficulty, categorize } from '../metrics/score.js';
import { buildFromDays, applyClassifications } from '../metrics/build.js';
import { newTerms, rising } from '../metrics/trends.js';
import {
  dayPath, classifyPath, writeJsonGz, readCountryDays, readCountryClassifications,
} from '../data/files.js';
import { addDays } from '../util/dates.js';
import { collectAppMeta } from './app-meta.js';

const NEW_PRIORITY_DAYS = 7;
export const RECLASSIFY_DAYS = 30;
export const MAX_FAILURE_RATE = 0.1;

// Ce extindem azi: cuvintele noi de ieri + cele in crestere pe 7 zile, cele cu scor mare primele.
export function expansionPrefixes(series, index, max) {
  const latest = series.dates.at(-1);
  if (!latest) return [];
  const scoreOf = (t) => series.scores.get(latest).get(t) ?? 0;
  const terms = new Set([...newTerms(series, index, 1), ...rising(series, 7)].map((r) => r.term));
  const prefixes = [];
  for (const t of [...terms].sort((a, b) => scoreOf(b) - scoreOf(a))) {
    const p = `${t.split(' ')[0]} `;
    if (!prefixes.includes(p)) prefixes.push(p);
    if (prefixes.length >= max) break;
  }
  return prefixes;
}

// Cuvintele vazute azi, fara clasificare sau clasificate acum >30 zile; scor mare primele.
// Cuvintele aparute recent (sau azi, inca neindexate) primele: pentru ele vrem app-urile cat mai repede.
export function classificationQueue(index, todayScores, date) {
  const stale = addDays(date, -RECLASSIFY_DAYS);
  const recent = addDays(date, -NEW_PRIORITY_DAYS);
  const isNew = (t) => { const fs = index.get(t)?.firstSeen; return !fs || fs >= recent; };
  return [...todayScores.keys()]
    .filter((t) => { const c = index.get(t)?.classifiedAt; return !c || c <= stale; })
    .sort((a, b) => isNew(b) - isNew(a) || todayScores.get(b) - todayScores.get(a));
}

export async function runCountry({
  country, date, dataDir, apple,
  budget = {}, smoke = false, log = console.log, clock = Date.now,
}) {
  const {
    prefixes = prefixesFor(country),
    expandMax = 300,
    chartGenres = CHART_GENRES,
    classifyMs = 3 * 3600_000,
    classifyMax = Infinity,
    appMetaMax = Infinity,
  } = budget;
  const { counter } = apple;
  let aborted = false;
  const stop = () => {
    if (!aborted && counter.tooManyFailures(50, MAX_FAILURE_RATE)) {
      aborted = true;
      log(`[${country}] prea multe erori (${counter.stats.failures}/${counter.stats.requests}) -> opresc colectarea`);
    }
    return aborted;
  };

  // Istoricul dinainte de azi (din depozit).
  const { series, index } = buildFromDays(readCountryDays(dataDir, country, { before: date }));
  applyClassifications(index, readCountryClassifications(dataDir, country, { before: date }));

  // 1. Sugestii
  const suggest = [];
  const ask = async (prefix, kind) => {
    try {
      suggest.push({ prefix, kind, terms: await apple.suggest(prefix, country) });
    } catch (err) {
      log(`[${country}] hints "${prefix}" esuat: ${err.message}`);
    }
  };
  log(`[${country}] sugestii: ${prefixes.length} inceputuri`);
  for (const p of prefixes) { if (stop()) break; await ask(p, 'base'); }

  // 2. Extindere long-tail
  const expand = expansionPrefixes(series, index, expandMax).filter((p) => !prefixes.includes(p));
  log(`[${country}] extindere: ${expand.length} inceputuri`);
  for (const p of expand) { if (stop()) break; await ask(p, 'expand'); }

  // 3. Topuri
  const charts = [];
  log(`[${country}] topuri: ${chartGenres.length} genuri x ${CHART_TYPES.length}`);
  for (const genreId of chartGenres) {
    for (const type of CHART_TYPES) {
      if (stop()) break;
      try {
        charts.push({ type, genreId, apps: await apple.chart(country, type, genreId) });
      } catch (err) {
        log(`[${country}] rss ${type}/${genreId} esuat: ${err.message}`);
      }
    }
  }

  // 3b. Data lansarii pentru app-urile noi din topuri (pentru "Aplicatii noi")
  const appMeta = await collectAppMeta({ country, date, dataDir, apple, charts, log, stop, max: appMetaMax });

  // 4. Clasificare pe categorii (in limita de timp; restul ramane pe maine)
  const todayScores = scoreDay(suggest);
  const queue = classificationQueue(index, todayScores, date);
  const classified = {};
  const deadline = clock() + classifyMs;
  log(`[${country}] clasificare: ${queue.length} in coada`);
  for (const term of queue) {
    if (stop() || clock() > deadline || Object.keys(classified).length >= classifyMax) break;
    try {
      const apps = await apple.topApps(term, country);
      classified[term] = {
        ...categorize(apps),
        difficulty: difficulty(apps.map((a) => a.ratings)),
        topAppIds: apps.map((a) => a.id),
        classifiedAt: date,
      };
    } catch (err) {
      log(`[${country}] search "${term}" esuat: ${err.message}`);
    }
  }

  const { requests, failures } = counter.stats;
  // O rulare de proba acopera putine inceputuri: nu conteaza ca zi completa (ar strica trendurile).
  const complete = !smoke && !aborted && counter.failureRate() <= MAX_FAILURE_RATE && suggest.length > 0;
  writeJsonGz(dayPath(dataDir, date, country), {
    date, country, complete, smoke, requests, errors: failures, suggest, charts,
  });
  // Scris mereu (si gol), ca artefactul din GitHub sa pastreze structura data/days + data/classify.
  writeJsonGz(classifyPath(dataDir, date, country), classified);

  const summary = {
    country, date, complete, requests, errors: failures,
    terms: todayScores.size, expanded: expand.length, charts: charts.length,
    appMeta, classified: Object.keys(classified).length, queueLeft: queue.length - Object.keys(classified).length,
  };
  log(`[${country}] gata: ${JSON.stringify(summary)}`);
  return summary;
}
