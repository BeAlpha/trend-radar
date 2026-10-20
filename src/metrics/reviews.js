// Rezumatul recenziilor recente: distributia notelor si de ce se plang oamenii (cuvintele frecvente din 1-2 stele).
import { STOPWORDS } from './themes.js';

// Cuvinte prea generale in recenzii (in toate limbile urmarite), pe langa STOPWORDS.
const REVIEW_STOP = new Set(`
this that it is was are be been have has had not but so if just get can cant can't don't dont im i'm me we they them
its it's very really too much more even will would could should when what why how there here than then only also
again still any some like love great good bad fun play played playing time make made use using want need please
after before because without about into over under every each many most lot lots ever never always first
other others out off down then once since which while being doing done going thing things way back keep
app apps game games spiel jeu gioco juego
ist nicht ich es sie wir aber auch noch nur sehr mehr wenn kann man sich mich mir hat habe sind war
je pas ne est il elle ce que qui sur plus très tout mais suis ai cest c'est
non che sono ho mi ma più molto anche questo
no es que lo me se pero muy más ya este esta
`.split(/\s+/).filter(Boolean));

const words = (text) => text.toLowerCase().replace(/[’`]/g, "'").split(/[^\p{L}\p{N}']+/u)
  .filter((w) => (w.length >= 3 || w === 'ad') && !STOPWORDS.has(w) && !REVIEW_STOP.has(w) && !/^\d+$/.test(w));

// Pluralul simplu se uneste cu singularul cand ambele apar ("levels" + "level" -> "level", "ads" -> "ad").
function mergePlurals(counts) {
  for (const [w, n] of [...counts]) {
    if (!w.endsWith('s')) continue;
    const one = [w.slice(0, -1), w.endsWith('es') ? w.slice(0, -2) : null].find((x) => x && x.length >= 2 && counts.has(x));
    if (one) {
      counts.set(one, (counts.get(one) ?? 0) + n);
      counts.delete(w);
    }
  }
  return counts;
}

export function summarizeReviews(reviews, topN = 12) {
  const dist = [0, 0, 0, 0, 0];
  for (const r of reviews) if (r.stars >= 1 && r.stars <= 5) dist[r.stars - 1]++;
  const bad = reviews.filter((r) => r.stars <= 2);
  const counts = new Map();
  for (const r of bad) {
    // Un cuvant se numara o data pe recenzie: "cate recenzii il pomenesc".
    const ws = new Set(words(`${r.title} ${r.text}`).map((w) => (w === 'ads' ? 'ad' : w)));
    for (const w of ws) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  mergePlurals(counts);
  const complaints = [...counts].filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topN)
    .map(([word, n]) => ({ word, n }));
  const avg = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.stars, 0) / reviews.length) * 10) / 10 : null;
  return {
    count: reviews.length, avg, dist, complaints, badCount: bad.length,
    bad: bad.slice(0, 15), good: reviews.filter((r) => r.stars >= 4).slice(0, 8),
    from: reviews.map((r) => r.date).sort()[0] ?? null,
  };
}
