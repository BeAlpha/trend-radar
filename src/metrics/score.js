// Scor estimat de trafic din sugestiile App Store (NU volumul oficial Apple).
// Cu cat un cuvant apare dupa mai putine litere si mai sus in lista, cu atat e mai cautat.

const BANDS = {
  1: { top: 100, bottom: 70 },
  2: { top: 69, bottom: 40 },
  3: { top: 39, bottom: 10 }, // >=3 caractere (extindere long-tail)
};

export function bandScore(prefixLen, position) {
  const b = BANDS[Math.min(Math.max(prefixLen, 1), 3)];
  const s = b.top - (position - 1) * ((b.top - b.bottom) / 10);
  return Math.max(b.bottom, Math.round(s));
}

// entries: [{ prefix, terms: [...] }] -> Map(term -> cel mai bun scor)
export function scoreDay(entries) {
  const best = new Map();
  for (const { prefix, terms } of entries) {
    const len = [...prefix].length;
    terms.forEach((t, i) => {
      const s = bandScore(len, i + 1);
      if (s > (best.get(t) ?? 0)) best.set(t, s);
    });
  }
  return best;
}

// Ca scoreDay, dar pastreaza si unde a aparut cuvantul (pentru "Cauta kw").
export function bestObservations(entries) {
  const best = new Map();
  for (const { prefix, terms } of entries) {
    const len = [...prefix].length;
    terms.forEach((t, i) => {
      const s = bandScore(len, i + 1);
      if (s > (best.get(t)?.score ?? 0)) best.set(t, { score: s, prefix, position: i + 1 });
    });
  }
  return best;
}

export function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// 1 = usor (●○○), 2 = mediu (●●○), 3 = greu (●●●); null = fara date
export function difficulty(ratingCounts) {
  if (!ratingCounts.length) return null;
  const m = median(ratingCounts);
  return m < 1000 ? 1 : m < 50000 ? 2 : 3;
}

const majority = (ids) => {
  const counts = new Map();
  for (const id of ids) if (id != null) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best = null, n = 0;
  for (const [id, c] of counts) if (c > n) { best = id; n = c; }
  return { id: best, count: n };
};

export const MIN_GENRE_VOTES = 4;
export const GAMES = 6014;

// apps: primele app-uri din cautare [{ genreId, subgenreId }]. Categoria 0 = "Mixt".
export function categorize(apps) {
  const { id, count } = majority(apps.map((a) => a.genreId));
  if (count < MIN_GENRE_VOTES) return { category: 0, subgenre: null };
  const subgenre = id === GAMES
    ? majority(apps.filter((a) => a.genreId === GAMES).map((a) => a.subgenreId)).id
    : null;
  return { category: id, subgenre };
}
