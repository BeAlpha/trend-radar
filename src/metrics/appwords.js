// De unde "vine" un cuvant-cheie pentru un app: titlu, subtitlu sau (probabil) campul ascuns de keywords.
// Apple indexeaza titlul, subtitlul si campul ascuns de 100 caractere (nu descrierea).

export const words = (s) => (s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// Potrivire toleranta la plural simplu (friend/friends, game/games).
const stem = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const has = (set, w) => set.has(stem(w));

// 'title' | 'subtitle' | 'both' | 'partial' | 'hidden'
export function keywordSource(term, title, subtitle) {
  const tw = new Set(words(title).map(stem));
  const sw = new Set(words(subtitle).map(stem));
  const kw = words(term);
  if (!kw.length) return 'hidden';
  if (kw.every((w) => has(tw, w))) return 'title';
  if (kw.every((w) => has(sw, w))) return 'subtitle';
  if (kw.every((w) => has(tw, w) || has(sw, w))) return 'both';
  if (kw.some((w) => has(tw, w) || has(sw, w))) return 'partial';
  return 'hidden';
}
