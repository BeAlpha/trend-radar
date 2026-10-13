// Datele pentru interfata: serie + index din SQLite -> functiile pure din metrics/.
import { COUNTRIES, CHART_TYPES } from '../apple/clients.js';
import { genreName, GENRES } from '../apple/genres.js';
import { newTerms, rising, falling, topTerms, disappeared, warmup } from '../metrics/trends.js';
import { chartMovers, themes } from '../metrics/themes.js';
import { addDays } from '../util/dates.js';

export const SERIES_DAYS = 45;
export const MAX_ROWS = 1500;

export function loadSeries(db, cc, days = SERIES_DAYS) {
  const dates = db.prepare(
    'SELECT date FROM days WHERE country=? AND complete=1 ORDER BY date DESC LIMIT ?',
  ).all(cc, days).map((r) => r.date).reverse();
  const scores = new Map(dates.map((d) => [d, new Map()]));
  if (dates.length) {
    const rows = db.prepare('SELECT date, term, score FROM scores WHERE country=? AND date>=?').all(cc, dates[0]);
    for (const r of rows) scores.get(r.date)?.set(r.term, r.score);
  }
  return { dates, scores };
}

export function loadIndex(db, cc) {
  const index = new Map();
  for (const r of db.prepare('SELECT term, first_seen, last_seen FROM seen WHERE country=?').all(cc)) {
    index.set(r.term, { firstSeen: r.first_seen, lastSeen: r.last_seen });
  }
  for (const r of db.prepare('SELECT * FROM class WHERE country=?').all(cc)) {
    const e = index.get(r.term);
    if (e) Object.assign(e, { category: r.category, subgenre: r.subgenre, difficulty: r.difficulty });
  }
  return index;
}

// Cache pe tara, invalidat la fiecare import (versiune).
export function makeViews(db) {
  let version = 0;
  const cache = new Map();
  const ctx = (cc) => {
    const key = `${cc}:${version}`;
    if (!cache.has(key)) cache.set(key, { series: loadSeries(db, cc), index: loadIndex(db, cc) });
    return cache.get(key);
  };

  const enrich = (cc, index, r) => {
    const i = index.get(r.term) ?? {};
    return {
      country: cc, ...r,
      firstSeen: r.firstSeen ?? i.firstSeen ?? null,
      category: i.category ?? null,
      categoryName: i.category == null ? 'Neclasificat' : genreName(i.category),
      subgenreName: i.subgenre ? genreName(i.subgenre) : null,
      difficulty: i.difficulty ?? null,
    };
  };

  const matchCategory = (category) => (r) => {
    if (category === 'all' || category == null || category === '') return true;
    if (category === 'none') return r.category == null;
    return r.category === Number(category);
  };

  function view({ name, country = 'US', category = 'all', period = 7, limit = MAX_ROWS }) {
    const ccs = country === 'ALL' ? COUNTRIES : [country];
    const p = Number(period) || 7;
    let rows = [];
    const meta = {};
    for (const cc of ccs) {
      const { series, index } = ctx(cc);
      meta[cc] = { warmup: warmup(series.dates), latest: series.dates.at(-1) ?? null };
      let list;
      if (name === 'new') list = newTerms(series, index, p);
      else if (name === 'rising') list = rising(series, p >= 30 ? 30 : 7);
      else if (name === 'falling') list = falling(series, p >= 30 ? 30 : 7);
      else if (name === 'gone') list = disappeared(series);
      else list = topTerms(series);
      rows.push(...list.map((r) => enrich(cc, index, r)));
    }
    rows = rows.filter(matchCategory(category));
    return { total: rows.length, rows: rows.slice(0, limit), meta };
  }

  function chartList(cc, date, type, genreId) {
    return db.prepare(
      'SELECT rank, app_id AS id, name, app_genre AS genreId FROM charts WHERE country=? AND date=? AND type=? AND genre_id=? ORDER BY rank',
    ).all(cc, date, type, genreId);
  }

  function themeView({ country = 'US', category = 'all' }) {
    const ccs = country === 'ALL' ? COUNTRIES : [country];
    const out = [];
    for (const cc of ccs) {
      const dates = db.prepare('SELECT DISTINCT date FROM charts WHERE country=? ORDER BY date DESC LIMIT 8')
        .all(cc).map((r) => r.date);
      const latest = dates[0];
      if (!latest) continue;
      const past = dates.slice(1).filter((d) => d >= addDays(latest, -7));
      const weekAgoDate = past.find((d) => d === addDays(latest, -7)) ?? null;
      const genres = db.prepare('SELECT DISTINCT genre_id FROM charts WHERE country=? AND date=?')
        .all(cc, latest).map((r) => r.genre_id);
      for (const g of genres) {
        if (category !== 'all' && Number(category) !== g) continue;
        const movers = [];
        for (const type of CHART_TYPES) {
          const today = chartList(cc, latest, type, g);
          const pastLists = past.map((d) => chartList(cc, d, type, g));
          const weekAgo = weekAgoDate ? chartList(cc, weekAgoDate, type, g) : null;
          movers.push(...chartMovers(today, pastLists, weekAgo).map((m) => ({ ...m, type })));
        }
        out.push({
          country: cc, genreId: g, genreName: genreName(g), date: latest,
          historyDays: past.length, movers, themes: themes(movers),
        });
      }
    }
    return out.sort((a, b) => b.themes.length - a.themes.length || b.movers.length - a.movers.length);
  }

  function termView(term) {
    const t = term.trim().toLowerCase();
    const perCountry = COUNTRIES.map((cc) => {
      const history = db.prepare(`SELECT d.date, COALESCE(s.score, 0) AS score FROM days d
        LEFT JOIN scores s ON s.country=d.country AND s.date=d.date AND s.term=?
        WHERE d.country=? AND d.complete=1 ORDER BY d.date DESC LIMIT 90`).all(t, cc).reverse();
      const last = db.prepare('SELECT date, prefix, position, score FROM scores WHERE country=? AND term=? ORDER BY date DESC LIMIT 1').get(cc, t);
      const seen = db.prepare('SELECT first_seen, last_seen FROM seen WHERE country=? AND term=?').get(cc, t);
      const cls = db.prepare('SELECT * FROM class WHERE country=? AND term=?').get(cc, t);
      return {
        country: cc, history, last: last ?? null,
        firstSeen: seen?.first_seen ?? null, lastSeen: seen?.last_seen ?? null,
        category: cls ? genreName(cls.category) : null,
        subgenre: cls?.subgenre ? genreName(cls.subgenre) : null,
        difficulty: cls?.difficulty ?? null,
        topAppIds: cls ? JSON.parse(cls.top_app_ids) : [],
      };
    });
    return { term: t, countries: perCountry };
  }

  // Cuvintele pe care app-ul apare in primele 10 (din clasificarile noastre), pe tari.
  function appKeywords(appId) {
    const id = String(Number(appId));
    const out = [];
    for (const cc of COUNTRIES) {
      const latest = db.prepare('SELECT MAX(date) d FROM days WHERE country=? AND complete=1').get(cc).d;
      const rows = db.prepare(`SELECT c.term, c.top_app_ids, c.classified_at, c.category, s.score
        FROM class c LEFT JOIN scores s ON s.country=c.country AND s.term=c.term AND s.date=?
        WHERE c.country=? AND instr(',' || substr(c.top_app_ids, 2, length(c.top_app_ids) - 2) || ',', ',' || ? || ',') > 0`)
        .all(latest, cc, id);
      for (const r of rows) {
        const position = JSON.parse(r.top_app_ids).map(String).indexOf(id) + 1;
        if (position > 0) {
          out.push({ country: cc, term: r.term, position, score: r.score ?? 0, classifiedAt: r.classified_at, categoryName: genreName(r.category) });
        }
      }
    }
    return out.sort((a, b) => b.score - a.score || a.position - b.position);
  }

  function suggestTerms(q) {
    return db.prepare('SELECT DISTINCT term FROM seen WHERE term LIKE ? ORDER BY length(term) LIMIT 15')
      .all(`${q.trim().toLowerCase()}%`).map((r) => r.term);
  }

  function categories() {
    const used = new Set(db.prepare('SELECT DISTINCT category FROM class').all().map((r) => r.category));
    return [
      ...Object.keys(GENRES).map(Number).filter((g) => used.has(g)).map((g) => ({ id: g, name: genreName(g) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      ...(used.has(0) ? [{ id: 0, name: 'Mixt' }] : []),
    ];
  }

  function status() {
    const countries = {};
    for (const cc of COUNTRIES) {
      const s = loadSeries(db, cc, 1000);
      const all = db.prepare('SELECT COUNT(*) n FROM days WHERE country=?').get(cc).n;
      const incomplete = db.prepare('SELECT date FROM days WHERE country=? AND complete=0 ORDER BY date DESC LIMIT 10').all(cc).map((r) => r.date);
      const terms = db.prepare('SELECT COUNT(*) n FROM seen WHERE country=?').get(cc).n;
      const classified = db.prepare('SELECT COUNT(*) n FROM class WHERE country=?').get(cc).n;
      countries[cc] = { warmup: warmup(s.dates), latest: s.dates.at(-1) ?? null, days: all, incomplete, terms, classified };
    }
    const problems = db.prepare('SELECT * FROM problems').all();
    return { countries, problems };
  }

  return {
    view, themeView, termView, suggestTerms, appKeywords, categories, status,
    invalidate: () => { version++; cache.clear(); },
  };
}
