// Datele pentru interfata: serie + index din SQLite -> functiile pure din metrics/.
import { COUNTRIES, CHART_TYPES, DOWNLOAD_TYPES } from '../apple/clients.js';
import { genreName, GENRES } from '../apple/genres.js';
import { newTerms, rising, falling, topTerms, disappeared, warmup } from '../metrics/trends.js';
import { chartMovers, themes } from '../metrics/themes.js';
import { addDays, diffDays } from '../util/dates.js';
import { competition, opportunity } from '../metrics/niche.js';
import { BIG_RATINGS } from '../metrics/score.js';

export const SERIES_DAYS = 45;
export const MAX_ROWS = 1500;

// Cuvintele cu trafic real dovedit: un app mare care are cuvantul in nume, in primele 10 din cautare.
// Ele pastreaza scorul intreg chiar daca apar doar dupa o combinatie rara de litere ("vpn", "nfl").
export function bigTerms(db, cc) {
  const big = new Set();
  for (const r of db.prepare('SELECT term, niche FROM class WHERE country=? AND niche IS NOT NULL').all(cc)) {
    if ((JSON.parse(r.niche).tmax ?? 0) >= BIG_RATINGS) big.add(r.term);
  }
  return big;
}
export const pickScore = (big, term, score, adj) => (big.has(term) || adj == null ? score : adj);

export function loadSeries(db, cc, days = SERIES_DAYS, big = bigTerms(db, cc)) {
  const dates = db.prepare(
    'SELECT date FROM days WHERE country=? AND complete=1 ORDER BY date DESC LIMIT ?',
  ).all(cc, days).map((r) => r.date).reverse();
  const scores = new Map(dates.map((d) => [d, new Map()]));
  if (dates.length) {
    const rows = db.prepare('SELECT date, term, score, score_adj FROM scores WHERE country=? AND date>=?').all(cc, dates[0]);
    for (const r of rows) scores.get(r.date)?.set(r.term, pickScore(big, r.term, r.score, r.score_adj));
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
    if (e) Object.assign(e, { category: r.category, subgenre: r.subgenre, difficulty: r.difficulty, topAppIds: JSON.parse(r.top_app_ids) });
  }
  return index;
}

// Cache pe tara, invalidat la fiecare import (versiune).
export function makeViews(db) {
  let version = 0;
  const cache = new Map();
  const ctx = (cc) => {
    const key = `${cc}:${version}`;
    if (!cache.has(key)) {
      const big = bigTerms(db, cc);
      cache.set(key, { big, series: loadSeries(db, cc, SERIES_DAYS, big), index: loadIndex(db, cc) });
    }
    return cache.get(key);
  };
  const bigOf = (cc) => ctx(cc).big;

  const enrich = (cc, index, r, withApps = false) => {
    const i = index.get(r.term) ?? {};
    return {
      country: cc, ...r,
      firstSeen: r.firstSeen ?? i.firstSeen ?? null,
      category: i.category ?? null,
      categoryName: i.category == null ? 'Neclasificat' : genreName(i.category),
      subgenreName: i.subgenre ? genreName(i.subgenre) : null,
      difficulty: i.difficulty ?? null,
      ...(withApps ? { apps: (i.topAppIds ?? []).slice(0, 3) } : {}),
    };
  };

  const matchCategory = (category) => (r) => {
    if (category === 'all' || category == null || category === '') return true;
    if (category === 'none') return r.category == null;
    return r.category === Number(category);
  };

  // Cuvant nou: "appeared" = aparut in sugestiile de baza (1-2 litere) sau intr-o extindere pe care o mai
  // intrebasem inainte si nu era acolo; "discovered" = gasit la prima intrebare a unei extinderi
  // (nou pentru noi, nu neaparat pentru lume).
  const firstObs = db.prepare('SELECT prefix FROM scores WHERE country=? AND date=? AND term=?');
  const askedBefore = db.prepare('SELECT 1 FROM queried WHERE country=? AND prefix=? AND date<? LIMIT 1');
  function origin(cc, term, firstSeen) {
    const prefix = firstObs.get(cc, firstSeen, term)?.prefix;
    if (prefix == null || [...prefix].length <= 2) return 'appeared';
    return askedBefore.get(cc, prefix, firstSeen) ? 'appeared' : 'discovered';
  }

  function view({ name, country = 'US', category = 'all', period = 7, origin: only = 'all', limit = MAX_ROWS }) {
    const ccs = country === 'ALL' ? COUNTRIES : [country];
    const p = Number(period) || 7;
    let rows = [];
    const meta = {};
    for (const cc of ccs) {
      const { series, index } = ctx(cc);
      meta[cc] = { warmup: warmup(series.dates), latest: series.dates.at(-1) ?? null };
      let list;
      if (name === 'new') {
        list = newTerms(series, index, p).map((r) => ({ ...r, origin: origin(cc, r.term, r.firstSeen) }));
        if (only === 'appeared' || only === 'discovered') list = list.filter((r) => r.origin === only);
      }
      else if (name === 'rising') list = rising(series, p >= 30 ? 30 : 7);
      else if (name === 'falling') list = falling(series, p >= 30 ? 30 : 7);
      else if (name === 'gone') list = disappeared(series);
      else list = topTerms(series);
      rows.push(...list.map((r) => enrich(cc, index, r, name === 'new')));
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
          // Un top colectat de curand n-are istoric: fara asta, toate app-urile din el ar parea "nou intrate".
          const pastLists = past.map((d) => chartList(cc, d, type, g)).filter((l) => l.length);
          if (!today.length || !pastLists.length) continue;
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
      const big = bigOf(cc);
      const history = db.prepare(`SELECT d.date, COALESCE(s.score, 0) AS score, s.score_adj FROM days d
        LEFT JOIN scores s ON s.country=d.country AND s.date=d.date AND s.term=?
        WHERE d.country=? AND d.complete=1 ORDER BY d.date DESC LIMIT 90`).all(t, cc).reverse()
        .map((h) => ({ date: h.date, score: pickScore(big, t, h.score, h.score_adj) }));
      const lastRow = db.prepare('SELECT date, prefix, position, score, score_adj FROM scores WHERE country=? AND term=? ORDER BY date DESC LIMIT 1').get(cc, t);
      const last = lastRow ? { date: lastRow.date, prefix: lastRow.prefix, position: lastRow.position,
        score: pickScore(big, t, lastRow.score, lastRow.score_adj), rare: !big.has(t) && lastRow.score_adj != null && lastRow.score_adj < lastRow.score } : null;
      const seen = db.prepare('SELECT first_seen, last_seen FROM seen WHERE country=? AND term=?').get(cc, t);
      const cls = db.prepare('SELECT * FROM class WHERE country=? AND term=?').get(cc, t);
      return {
        country: cc, history, last: last ?? null,
        firstSeen: seen?.first_seen ?? null, lastSeen: seen?.last_seen ?? null,
        category: cls ? genreName(cls.category) : null,
        subgenre: cls?.subgenre ? genreName(cls.subgenre) : null,
        difficulty: cls?.difficulty ?? null,
        topAppIds: cls ? JSON.parse(cls.top_app_ids) : [],
        niche: cls?.niche ? JSON.parse(cls.niche) : null,
        competition: cls?.niche ? competition(JSON.parse(cls.niche)) : null,
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
      const big = bigOf(cc);
      const rows = db.prepare(`SELECT c.term, c.top_app_ids, c.classified_at, c.category, s.score, s.score_adj
        FROM class c LEFT JOIN scores s ON s.country=c.country AND s.term=c.term AND s.date=?
        WHERE c.country=? AND instr(',' || substr(c.top_app_ids, 2, length(c.top_app_ids) - 2) || ',', ',' || ? || ',') > 0`)
        .all(latest, cc, id);
      for (const r of rows) {
        const position = JSON.parse(r.top_app_ids).map(String).indexOf(id) + 1;
        if (position > 0) {
          out.push({ country: cc, term: r.term, position, score: r.score == null ? 0 : pickScore(big, r.term, r.score, r.score_adj), classifiedAt: r.classified_at, categoryName: genreName(r.category) });
        }
      }
    }
    return out.sort((a, b) => b.score - a.score || a.position - b.position);
  }

  // Rating-urile unui app: cate are acum si cate a primit pe zi (fata de cea mai veche zi din ultimele 7).
  const statsSince = db.prepare('SELECT date, ratings, stars, price FROM app_stats WHERE country=? AND id=? AND date>=? AND date<=? ORDER BY date');
  function ratingTrend(cc, id, latest) {
    const pts = statsSince.all(cc, id, addDays(latest, -7), latest);
    if (!pts.length) return { ratings: null, perDay: null, stars: null, price: null };
    const now = pts.at(-1);
    const then = pts[0];
    const days = diffDays(now.date, then.date);
    return {
      ratings: now.ratings, stars: now.stars, price: now.price,
      perDay: days > 0 ? Math.round(((now.ratings - then.ratings) / days) * 10) / 10 : null,
    };
  }

  // Ziua din care urmarim topurile unei tari: "ajunsa in top in N zile" are sens doar pentru app-urile lansate dupa.
  const trackStart = (cc) => db.prepare('SELECT MIN(date) d FROM charts WHERE country=?').get(cc).d;
  const typeOk = (type) => (t) => (type === 'free' ? t === 'topfreeapplications'
    : type === 'paid' ? t === 'toppaidapplications'
      : type === 'grossing' ? t === 'topgrossingapplications' : true);

  // Aplicatii noi in topuri: lansate in ultimele `launched` zile si prezente in topurile de azi.
  // Pentru fiecare: cel mai bun loc (si in ce top), urcarea fata de acum 7 zile in ACELASI top, in cate tari,
  // locul in topul incasarilor ("face bani"), rating-urile pe zi (semnul descarcarilor).
  // source='feed': lansarile noi ale Apple care NU sunt (inca) in topuri, cele cu rating-uri rapide primele.
  function newApps({ country = 'US', category = 'all', type = 'all', launched = 90, source = 'charts', limit = MAX_ROWS }) {
    if (source === 'feed') return feedApps({ country, category, launched, limit });
    const ccs = country === 'ALL' ? COUNTRIES : [country];
    const days = Number(launched) || 90;
    const byId = new Map();
    for (const cc of ccs) {
      const latest = db.prepare('SELECT MAX(date) d FROM charts WHERE country=?').get(cc).d;
      if (!latest) continue;
      const since = addDays(latest, -days);
      const weekAgo = addDays(latest, -7);
      const start = trackStart(cc);
      const rows = db.prepare(`SELECT c.app_id id, c.type, c.genre_id, c.rank, c.name, m.genre_id app_genre,
          m.release_date, m.seller
        FROM charts c JOIN app_meta m ON m.country=c.country AND m.id=c.app_id
        WHERE c.country=? AND c.date=? AND m.release_date>=?`).all(cc, latest, since);
      const rankThen = db.prepare('SELECT rank FROM charts WHERE country=? AND date=? AND type=? AND genre_id=? AND app_id=?');
      const chartThen = db.prepare('SELECT 1 FROM charts WHERE country=? AND date=? AND type=? AND genre_id=? LIMIT 1');
      const firstIn = db.prepare('SELECT MIN(date) d FROM charts WHERE country=? AND app_id=?');
      const best = new Map();
      const gross = new Map(); // id -> cel mai bun loc in topul incasarilor
      for (const r of rows) {
        if (r.type === 'topgrossingapplications' && (!gross.has(r.id) || r.rank < gross.get(r.id).rank)) gross.set(r.id, r);
        if (!typeOk(type)(r.type)) continue;
        const hist = !!chartThen.get(cc, weekAgo, r.type, r.genre_id);
        const dl = DOWNLOAD_TYPES.includes(r.type);
        const b = best.get(r.id);
        if (!b) best.set(r.id, { ...r, dl, charts: 1, hist: hist ? r : null });
        else {
          b.charts++;
          // Cel mai bun loc se ia din topurile de descarcari; incasarile doar daca nu e in niciunul.
          if ((dl && !b.dl) || (dl === b.dl && r.rank < b.rank)) Object.assign(b, { type: r.type, genre_id: r.genre_id, rank: r.rank, dl });
          if (hist && (!b.hist || r.rank < b.hist.rank)) b.hist = r;
        }
      }
      for (const b of best.values()) {
        // Urcarea se masoara in cel mai bun top care exista si acum 7 zile (topurile noi n-au inca istoric).
        const h = b.hist;
        const then = h ? rankThen.get(cc, weekAgo, h.type, h.genre_id, b.id)?.rank ?? null : null;
        const since0 = firstIn.get(cc, b.id).d;
        const g = gross.get(b.id);
        const entry = {
          country: cc, bestRank: b.rank, type: b.type, chartGenre: b.genre_id, charts: b.charts,
          climb: then == null ? null : then - h.rank, newInChart: !!h && then == null,
          climbChart: h && (h.type !== b.type || h.genre_id !== b.genre_id) ? { genre: h.genre_id, type: h.type, rank: h.rank } : null,
          inTopSince: since0,
          daysToTop: b.release_date && b.release_date >= start ? Math.max(0, diffDays(since0, b.release_date)) : null,
          gross: g ? { rank: g.rank, genre: g.genre_id } : null,
          ...ratingTrend(cc, b.id, latest),
        };
        const cur = byId.get(b.id);
        if (!cur) {
          byId.set(b.id, { id: b.id, name: b.name, seller: b.seller, genreId: b.app_genre, releaseDate: b.release_date, best: entry, all: [entry] });
        } else {
          cur.all.push(entry);
          if (entry.bestRank < cur.best.bestRank) cur.best = entry;
        }
      }
    }
    let out = [...byId.values()].map((a) => {
      const g = a.all.filter((e) => e.gross).sort((x, y) => x.gross.rank - y.gross.rank)[0];
      const perDays = a.all.map((e) => e.perDay).filter((v) => v != null);
      const dtt = a.all.map((e) => e.daysToTop).filter((v) => v != null);
      return {
        id: a.id, name: a.name, seller: a.seller, releaseDate: a.releaseDate,
        genreId: a.genreId, categoryName: genreName(a.genreId),
        country: a.best.country, countries: a.all.map((e) => e.country), countryCount: a.all.length,
        bestRank: a.best.bestRank, type: a.best.type, bestChartName: genreName(a.best.chartGenre),
        climb: a.best.climb, newInChart: a.best.newInChart,
        climbChartName: a.best.climbChart ? `${genreName(a.best.climbChart.genre)} #${a.best.climbChart.rank}` : null,
        charts: a.best.charts, inTopSince: a.best.inTopSince,
        daysToTop: dtt.length ? Math.min(...dtt) : null,
        grossRank: g ? g.gross.rank : null, grossChartName: g ? genreName(g.gross.genre) : null, grossCountry: g?.country ?? null,
        grossCountries: a.all.filter((e) => e.gross).length,
        ratings: a.all.reduce((n, e) => n + (e.ratings ?? 0), 0),
        ratingsPerDay: perDays.length ? Math.round(perDays.reduce((n, v) => n + v, 0) * 10) / 10 : null,
        stars: a.best.stars, price: a.best.price,
      };
    });
    if (category !== 'all' && category != null && category !== '') out = out.filter((a) => a.genreId === Number(category));
    out.sort((a, b) => b.countryCount - a.countryCount || a.bestRank - b.bestRank);
    return { total: out.length, rows: out.slice(0, limit) };
  }

  // Lansarile noi ale Apple (din prima zi) care inca nu sunt in topurile urmarite.
  function feedApps({ country = 'US', category = 'all', launched = 90, limit = MAX_ROWS }) {
    const ccs = country === 'ALL' ? COUNTRIES : [country];
    const days = Number(launched) || 90;
    const byId = new Map();
    for (const cc of ccs) {
      const latest = db.prepare('SELECT MAX(date) d FROM days WHERE country=?').get(cc).d;
      if (!latest) continue;
      const inCharts = new Set(db.prepare('SELECT DISTINCT app_id FROM charts WHERE country=? AND date=?').all(cc, latest).map((r) => r.app_id));
      const rows = db.prepare(`SELECT f.app_id id, MIN(f.date) first_feed, MAX(f.date) last_feed, MAX(f.type) type,
          m.name, m.genre_id, m.release_date, m.seller
        FROM new_feed f JOIN app_meta m ON m.country=f.country AND m.id=f.app_id
        WHERE f.country=? AND f.date>=? GROUP BY f.app_id`).all(cc, addDays(latest, -days));
      for (const r of rows) {
        if (inCharts.has(r.id)) continue;
        const entry = { country: cc, firstInFeed: r.first_feed, type: r.type, ...ratingTrend(cc, r.id, latest) };
        const cur = byId.get(r.id);
        if (!cur) byId.set(r.id, { r, all: [entry] });
        else cur.all.push(entry);
      }
    }
    let out = [...byId.values()].map(({ r, all }) => {
      const perDays = all.map((e) => e.perDay).filter((v) => v != null);
      const best = [...all].sort((x, y) => (y.perDay ?? -1) - (x.perDay ?? -1) || (y.ratings ?? 0) - (x.ratings ?? 0))[0];
      return {
        id: r.id, name: r.name, seller: r.seller, releaseDate: r.release_date, genreId: r.genre_id, categoryName: genreName(r.genre_id),
        country: best.country, countries: all.map((e) => e.country), countryCount: all.length,
        type: r.type === 'newpaidapplications' ? 'toppaidapplications' : 'topfreeapplications',
        firstInFeed: all.map((e) => e.firstInFeed).sort()[0],
        ratings: all.reduce((n, e) => n + (e.ratings ?? 0), 0),
        ratingsPerDay: perDays.length ? Math.round(perDays.reduce((n, v) => n + v, 0) * 10) / 10 : null,
        stars: best.stars, price: best.price,
      };
    });
    if (category !== 'all' && category != null && category !== '') out = out.filter((a) => a.genreId === Number(category));
    out.sort((a, b) => (b.ratingsPerDay ?? -1) - (a.ratingsPerDay ?? -1) || b.ratings - a.ratings || (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
    return { total: out.length, rows: out.slice(0, limit) };
  }

  // Pentru graficele de pe pagina aplicatiei: locul in topurile de descarcari, in topul incasarilor si rating-urile, pe zile.
  function appRanks(appId) {
    const id = Number(appId);
    const q = (types) => db.prepare(`SELECT date, MIN(rank) score FROM charts WHERE app_id=? AND country=?
      AND type IN (${types.map(() => '?').join(',')}) GROUP BY date ORDER BY date`);
    const dl = q(DOWNLOAD_TYPES);
    const gr = q(['topgrossingapplications']);
    const st = db.prepare('SELECT date, ratings score FROM app_stats WHERE id=? AND country=? ORDER BY date');
    const pts = (rows) => rows.map((r) => ({ date: r.date, score: r.score }));
    return {
      downloads: COUNTRIES.map((cc) => ({ country: cc, points: pts(dl.all(id, cc, ...DOWNLOAD_TYPES)) })),
      grossing: COUNTRIES.map((cc) => ({ country: cc, points: pts(gr.all(id, cc, 'topgrossingapplications')) })),
      ratings: COUNTRIES.map((cc) => ({ country: cc, points: pts(st.all(id, cc)) })),
    };
  }

  // Nise calde: cuvintele noi si cele in crestere, cu concurenta din primele 10 app-uri si cine face bani acolo.
  function nicheView({ country = 'US', category = 'all', period = 14, brands = false, limit = MAX_ROWS }) {
    const ccs = country === 'ALL' ? COUNTRIES : [country];
    const p = Number(period) || 14;
    const rows = [];
    for (const cc of ccs) {
      const { series, index } = ctx(cc);
      const latestChart = db.prepare('SELECT MAX(date) d FROM charts WHERE country=?').get(cc).d;
      const grossing = new Set(db.prepare("SELECT DISTINCT app_id FROM charts WHERE country=? AND date=? AND type='topgrossingapplications'")
        .all(cc, latestChart).map((r) => r.app_id));
      const fresh = db.prepare('SELECT release_date FROM app_meta WHERE country=? AND id=?');
      const nicheOf = db.prepare('SELECT niche FROM class WHERE country=? AND term=?');
      const cand = new Map();
      for (const r of newTerms(series, index, p)) cand.set(r.term, { ...r, isNew: true, delta: null });
      for (const r of rising(series, 7)) if (!cand.has(r.term)) cand.set(r.term, { ...r, isNew: false });
      const recent = series.dates.length ? addDays(series.dates.at(-1), -180) : null;
      for (const r of cand.values()) {
        const i = index.get(r.term) ?? {};
        const nRow = nicheOf.get(cc, r.term)?.niche;
        const niche = nRow ? JSON.parse(nRow) : null;
        const comp = competition(niche);
        const top = i.topAppIds ?? [];
        const moneyApps = top.filter((id) => grossing.has(id));
        const newApps = top.filter((id) => { const d = fresh.get(cc, id)?.release_date; return d && recent && d >= recent; });
        rows.push(enrich(cc, index, {
          term: r.term, score: r.score, delta: r.delta ?? null, isNew: r.isNew, firstSeen: r.firstSeen ?? null,
          preliminary: r.preliminary ?? false,
          competition: comp, brand: !!niche?.brand, opportunity: opportunity({ score: r.score, delta: r.delta, isNew: r.isNew, comp, brand: niche?.brand }),
          niche, moneyApps: moneyApps.length, freshApps: niche ? niche.fresh : newApps.length,
          apps: top.slice(0, 3), moneyIds: moneyApps.slice(0, 3),
        }));
      }
    }
    const out = rows.filter(matchCategory(category)).filter((r) => brands || !r.brand)
      .sort((a, b) => (b.opportunity ?? -1) - (a.opportunity ?? -1) || b.score - a.score);
    return { total: out.length, rows: out.slice(0, limit), measured: out.filter((r) => r.competition != null).length };
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
    view, themeView, termView, suggestTerms, appKeywords, newApps, appRanks, nicheView, categories, status,
    invalidate: () => { version++; cache.clear(); },
  };
}
