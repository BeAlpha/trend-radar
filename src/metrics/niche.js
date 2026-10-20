// Nisa unui cuvant, din primele 10 app-uri din cautare: cat de greu e de intrat si cat loc e pentru nou-veniti.
import { median } from './score.js';
import { addDays } from '../util/dates.js';

export const FRESH_DAYS = 180;

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

// apps: [{name, ratings, stars, releaseDate}] -> { med, stars, fresh, title, n }
//   med   = mediana rating-urilor (cat de mari sunt cei din top); max = cel mai mare;
//   tmax  = cel mai mare dintre cele care au cuvantul in nume (traficul real al cuvantului)
//   stars = nota medie (sub ~4.2 = utilizatori nemultumiti, loc pentru ceva mai bun)
//   fresh = cate sunt lansate in ultimele 180 de zile (nou-venitii reusesc sa urce)
//   title = cate au cuvantul in titlu (concurenta care tinteste exact cuvantul)
//   brand = cautare dupa o aplicatie anume: doar primul rezultat are cuvantul in nume si e mult mai mare
//           decat restul (ex. "google meet") -> nu e o nisa in care sa intri
export function nicheStats(apps, term, date) {
  const top = apps.slice(0, 10);
  if (!top.length) return { n: 0, med: 0, max: 0, tmax: 0, stars: null, fresh: 0, title: 0, brand: false };
  const words = norm(term).split(/\s+/).filter(Boolean);
  const since = addDays(date, -FRESH_DAYS);
  const rated = top.filter((a) => a.stars != null);
  const titled = top.filter((a) => { const n = norm(a.name ?? ''); return words.every((w) => n.includes(w)); });
  return {
    n: top.length,
    med: Math.round(median(top.map((a) => a.ratings ?? 0))),
    max: Math.max(...top.map((a) => a.ratings ?? 0)),
    stars: rated.length ? Math.round((rated.reduce((s, a) => s + a.stars, 0) / rated.length) * 10) / 10 : null,
    fresh: top.filter((a) => a.releaseDate && a.releaseDate >= since).length,
    title: titled.length,
    tmax: titled.length ? Math.max(...titled.map((a) => a.ratings ?? 0)) : 0,
    brand: isBrand(top, titled),
  };
}

function isBrand(top, titled) {
  if (titled.length !== 1 || titled[0] !== top[0] || top.length < 2) return false;
  const rest = median(top.slice(1).map((a) => a.ratings ?? 0));
  return (top[0].ratings ?? 0) >= Math.max(1000, 10 * rest);
}

const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));

// Concurenta 0-100: marimea celor din top (log), cati tintesc exact cuvantul, cat de putini noi reusesc.
export function competition(n) {
  if (!n || !n.n) return null;
  const size = Math.min(1, Math.log10((n.med ?? 0) + 1) / 5); // 100k+ rating-uri = maxim
  const titled = n.title / n.n;
  const closed = 1 - n.fresh / n.n;
  return clamp(100 * (0.6 * size + 0.25 * titled + 0.15 * closed));
}

// Oportunitate 0-100: cerere (scorul cuvantului + cresterea) contra concurentei.
// delta = cresterea pe 7 zile (sau null); un cuvant nou conteaza ca in crestere.
export function opportunity({ score, delta = null, isNew = false, comp, brand = false }) {
  if (comp == null) return null;
  if (brand) return 0;
  const growth = isNew ? 15 : Math.max(0, Math.min(20, delta ?? 0));
  const demand = Math.min(100, (score ?? 0) + growth);
  return clamp(0.5 * demand + 0.5 * (100 - comp));
}
