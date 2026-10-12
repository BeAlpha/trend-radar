// Teme din topuri: app-uri noi intrate / in urcare si cuvintele comune din titlurile lor.

export const MIN_CLIMB = 20;

// today: [{id, rank, name}], past: listele din ultimele 7 zile, weekAgo: lista de acum 7 zile (sau null)
export function chartMovers(today, past, weekAgo) {
  if (!past.length) return [];
  const seen = new Set(past.flat().map((x) => x.id));
  const oldRank = new Map((weekAgo ?? []).map((x) => [x.id, x.rank]));
  const out = [];
  for (const app of today) {
    if (!seen.has(app.id)) { out.push({ ...app, kind: 'new' }); continue; }
    const old = oldRank.get(app.id);
    if (old != null && old - app.rank >= MIN_CLIMB) out.push({ ...app, kind: 'up', climb: old - app.rank });
  }
  return out;
}

export const STOPWORDS = new Set(`
the and for with your you my of to in on an by at or from all one
app apps free pro lite plus new best game games hd
der die das und für mit dein deine von zu im auf ein eine den dem
le la les et pour avec de des du un une en votre ton ta mon ma
il lo gli per con di da una tuo tua
el los las para del tu mi
`.split(/\s+/).filter(Boolean));

export function tokenize(name) {
  return name.toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

// movers: [{id, name, ...}] -> [{theme, count, apps}] (doar teme cu >=2 app-uri distincte)
export function themes(movers) {
  const map = new Map(); // gram -> Map(id -> app)
  for (const app of movers) {
    const toks = tokenize(app.name);
    const grams = new Set([...toks, ...toks.slice(1).map((t, i) => `${toks[i]} ${t}`)]);
    for (const g of grams) {
      if (!map.has(g)) map.set(g, new Map());
      map.get(g).set(app.id, app);
    }
  }
  return [...map]
    .filter(([, apps]) => apps.size >= 2)
    .map(([theme, apps]) => ({ theme, count: apps.size, apps: [...apps.values()] }))
    .sort((x, y) => y.count - x.count || y.theme.split(' ').length - x.theme.split(' ').length);
}
