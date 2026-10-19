// Calcule de trend pe o serie de zile COMPLETE ale unei tari.
// series = { dates: ['YYYY-MM-DD' crescator], scores: Map(date -> Map(term -> scor)) }
// index  = Map(term -> { firstSeen, ... })  (firstSeen calculat din TOATE zilele, si cele incomplete)
import { addDays } from '../util/dates.js';

export const WARMUP_DAYS = 7;
export const MIN_DELTA = 5;
const round1 = (x) => Math.round(x * 10) / 10;

export function warmup(dates) {
  const done = dates.length >= WARMUP_DAYS;
  return { done, count: Math.min(dates.length, WARMUP_DAYS), endDate: done ? dates[WARMUP_DAYS - 1] : null };
}

const scoreOn = (series, date, term) => series.scores.get(date)?.get(term) ?? 0;

export function isConfirmed(series, term, firstSeen) {
  const end = addDays(firstSeen, 6);
  let n = 0;
  for (const d of series.dates) {
    if (d >= firstSeen && d <= end && series.scores.get(d).has(term)) n++;
  }
  return n >= 2;
}

// Zilele complete (de la firstSeen pana la ultima) si in cate dintre ele a fost vazut cuvantul.
export function seenSince(series, term, firstSeen) {
  let seen = 0, of = 0;
  for (const d of series.dates) {
    if (d < firstSeen) continue;
    of++;
    if (series.scores.get(d).has(term)) seen++;
  }
  return { seenDays: seen, ofDays: of };
}

// periodDays: 1 = doar ultima zi, 7, 30.
// Cu cel putin o zi DUPA perioada de pornire: nou = aparut dupa primele 7 zile.
// Pana atunci (>= 2 zile): PRELIMINAR, nou = nevazut in prima zi de colectare
// (si in ziua a 7-a, altfel lista ar fi goala exact cand se termina pornirea).
export function newTerms(series, index, periodDays) {
  const n = series.dates.length;
  if (n < 2) return [];
  const strict = n > WARMUP_DAYS;
  const baseEnd = strict ? series.dates[WARMUP_DAYS - 1] : series.dates[0];
  const latest = series.dates.at(-1);
  const from = addDays(latest, -(periodDays - 1));
  const out = [];
  for (const [term, info] of index) {
    const fs = info.firstSeen;
    if (!fs || fs <= baseEnd || fs < from || fs > latest) continue;
    out.push({
      term, firstSeen: fs, preliminary: !strict,
      confirmed: isConfirmed(series, term, fs), ...seenSince(series, term, fs),
      score: scoreOn(series, latest, term),
    });
  }
  return out.sort((a, b) => b.score - a.score || (a.firstSeen < b.firstSeen ? 1 : -1));
}

function avg(series, dates, term) {
  let s = 0;
  for (const d of dates) s += scoreOn(series, d, term);
  return s / dates.length;
}

// windowDays 7: "acum" = ultimele 3 zile complete, "atunci" = zilele complete din d-9..d-7.
export function deltas(series, windowDays) {
  const latest = series.dates.at(-1);
  if (!latest) return [];
  const nowDates = series.dates.slice(-3);
  const lo = addDays(latest, -(windowDays + 2));
  const hi = addDays(latest, -windowDays);
  const thenDates = series.dates.filter((d) => d >= lo && d <= hi);
  if (!thenDates.length) return [];
  const terms = new Set();
  for (const d of [...nowDates, ...thenDates]) for (const t of series.scores.get(d).keys()) terms.add(t);
  const out = [];
  for (const term of terms) {
    const now = avg(series, nowDates, term);
    const then = avg(series, thenDates, term);
    out.push({ term, score: round1(now), then: round1(then), delta: round1(now - then) });
  }
  return out;
}

// Doar cuvinte prezente in AMBELE ferestre: ce n-a existat "atunci" e la "Nou",
// ce nu mai exista "acum" e la "Disparute".
export const rising = (series, w, min = MIN_DELTA) =>
  deltas(series, w).filter((r) => r.then > 0 && r.score > 0 && r.delta >= min).sort((a, b) => b.delta - a.delta);

export const falling = (series, w, min = MIN_DELTA) =>
  deltas(series, w).filter((r) => r.then > 0 && r.score > 0 && r.delta <= -min).sort((a, b) => a.delta - b.delta);

// Vazut in >=5 din cele 7 zile complete dinaintea ultimelor 3 si absent din toate ultimele 3.
export function disappeared(series) {
  if (!warmup(series.dates).done) return [];
  const last3 = series.dates.slice(-3);
  const prior = series.dates.slice(-10, -3);
  if (last3.length < 3 || prior.length < 7) return [];
  const recent = new Set();
  for (const d of last3) for (const t of series.scores.get(d).keys()) recent.add(t);
  const seen = new Map(); // term -> { n, lastSeen, best }
  for (const d of prior) {
    for (const [t, s] of series.scores.get(d)) {
      const e = seen.get(t) ?? { n: 0, lastSeen: d, best: 0 };
      e.n++; e.lastSeen = d; e.best = Math.max(e.best, s);
      seen.set(t, e);
    }
  }
  const out = [];
  for (const [term, e] of seen) {
    if (e.n >= 5 && !recent.has(term)) out.push({ term, seenDays: e.n, lastSeen: e.lastSeen, score: e.best });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Top trafic: media ultimelor 3 zile complete.
export function topTerms(series) {
  const nowDates = series.dates.slice(-3);
  if (!nowDates.length) return [];
  const terms = new Set();
  for (const d of nowDates) for (const t of series.scores.get(d).keys()) terms.add(t);
  return [...terms]
    .map((term) => ({ term, score: round1(avg(series, nowDates, term)) }))
    .sort((a, b) => b.score - a.score);
}
