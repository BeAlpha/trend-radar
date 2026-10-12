// Construieste structurile de calcul (serie + index) din inregistrarile zilnice.
import { scoreDay } from './score.js';

// days: [{ date, complete, suggest }] -> { series (doar zile complete), index Map(term -> {firstSeen,lastSeen}) }
export function buildFromDays(days) {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const series = { dates: [], scores: new Map() };
  const index = new Map();
  for (const day of sorted) {
    const scores = scoreDay(day.suggest ?? []);
    for (const term of scores.keys()) {
      const e = index.get(term);
      if (e) e.lastSeen = day.date;
      else index.set(term, { firstSeen: day.date, lastSeen: day.date });
    }
    if (day.complete) {
      series.dates.push(day.date);
      series.scores.set(day.date, scores);
    }
  }
  return { series, index };
}

// classifyFiles: [{ term: {category, ...} }] in ordine cronologica -> ultima clasificare castiga
export function applyClassifications(index, classifyFiles) {
  for (const file of classifyFiles) {
    for (const [term, c] of Object.entries(file)) {
      const e = index.get(term) ?? {};
      index.set(term, { ...e, ...c });
    }
  }
  return index;
}
