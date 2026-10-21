// Nisa unui cuvant, din primele 10 app-uri din cautare: cat de greu e de intrat si cat loc e pentru nou-veniti.
import { median } from './score.js';
import { addDays } from '../util/dates.js';

export const FRESH_DAYS = 180;
export const FLOOD_DAYS = 90;
export const WEAK_RATINGS = 1000;
export const STALE_DAYS = 365;

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

// apps: [{name, ratings, stars, releaseDate}] -> { med, stars, fresh, title, n }
//   med   = mediana rating-urilor (cat de mari sunt cei din top); max = cel mai mare;
//   tmax  = cel mai mare dintre cele care au cuvantul in nume (traficul real al cuvantului)
//   stars = nota medie (sub ~4.2 = utilizatori nemultumiti, loc pentru ceva mai bun)
//   fresh = cate sunt lansate in ultimele 180 de zile (nou-venitii reusesc sa urce)
//   title = cate au cuvantul in titlu (concurenta care tinteste exact cuvantul)
//   weak  = cate au sub 1.000 de rating-uri (locuri tinute de app-uri mici: le poti lua)
//   fresh90 = cate sunt lansate in ultimele 90 de zile (cat de repede se umple nisa)
//   stale = cate n-au mai fost actualizate de un an (concurenti abandonati)
//   brand = cautare dupa o aplicatie anume: doar primul rezultat are cuvantul in nume si e mult mai mare
//           decat restul (ex. "google meet") -> nu e o nisa in care sa intri
export function nicheStats(apps, term, date) {
  const top = apps.slice(0, 10);
  if (!top.length) return { n: 0, med: 0, max: 0, tmax: 0, stars: null, fresh: 0, title: 0, brand: false, weak: 0, fresh90: 0, stale: 0 };
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
    weak: top.filter((a) => (a.ratings ?? 0) < WEAK_RATINGS).length,
    fresh90: top.filter((a) => a.releaseDate && a.releaseDate >= addDays(date, -FLOOD_DAYS)).length,
    stale: top.filter((a) => a.updated && a.updated < addDays(date, -STALE_DAYS)).length,
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

// Sansa unei aplicatii NOI (0 rating-uri) sa intre in primele 10, 0-100.
// Conteaza: locuri tinute de app-uri mici, nou-veniti care au reusit, concurenti abandonati,
// utilizatori nemultumiti (nota mica) si cati tintesc exact cuvantul in titlu.
// Clasificarile vechi n-au weak/fresh90/stale: atunci estimam din concurenta (approx = true).
export function chance(n) {
  if (!n || !n.n) return null;
  if (n.brand) return { value: 0, approx: false };
  if (n.weak == null) return { value: 100 - competition(n), approx: true };
  const stars = n.stars == null ? 0.5 : n.stars < 4.2 ? 1 : n.stars < 4.5 ? 0.5 : 0;
  const s = 0.4 * (n.weak / n.n) + 0.2 * (n.fresh90 / n.n) + 0.15 * (n.stale / n.n)
    + 0.1 * stars + 0.15 * (1 - n.title / n.n);
  return { value: clamp(100 * s), approx: false };
}

// Nisa se umple: 3+ din primele 10 lansate in ultimele 90 de zile (cursa e deja pornita).
export const FLOOD_MIN = 3;
export const isFlooding = (n) => (n?.fresh90 ?? 0) >= FLOOD_MIN;

// Categorii pe care Apple le respinge din start (App Review Guidelines 4.3(b), verificat 21 oct 2026),
// in cele 6 limbi urmarite. 'ban' = de evitat complet, 'hard' = doar cu ceva clar diferit.
const SATURATED = [
  ['hard', 'dating', /\b(dating|date app|citas|rencontres?|incontri|partnersuche|single ?b(o|ö)rse)\b/],
  ['hard', 'lanternă', /\b(flashlight|torch|taschenlampe|linterna|lampe torche|torcia)\b/],
  ['hard', 'efecte sonore', /\b(sound effects?|soundboard|sound board|soundeffekte?|efectos de sonido|effets sonores|effetti sonori)\b/],
  ['hard', 'wallpaper', /\b(wallpapers?|hintergrundbilder|fondos? de pantalla|fonds? d.(e|é)cran|sfondi)\b/],
  ['hard', 'timer simplu', /^(timer|countdown|stopwatch|chrono(m(e|è)tre)?|cron(o|ó)metro|temporizador|stoppuhr|minuteur)( app)?$/],
  ['hard', 'ghicit / horoscop', /\b(fortune tell\w*|horoscopes?|horoskop|hor(o|ó)scopo|oroscopo|tarot|palm reading|wahrsag\w*|voyance)\b/],
  ['ban', 'jocuri de băut', /\b(drinking games?|trinkspiele?|juegos? para beber|jeux? (a|à) boire|giochi alcolici)\b/],
  ['ban', 'kama sutra', /\bkama ?sutra\b/],
  ['ban', 'fart / burp', /\b(farts?|burps?|furz\w*|pupsen|pedorr\w*|rutti?|scoregg\w*)\b/],
];
export function saturated(term) {
  const t = norm(term);
  for (const [level, label, re] of SATURATED) if (re.test(t)) return { level, label };
  return null;
}

// Banii dintr-o nisa, estimati din rating-urile pe zi ale primelor app-uri (singurul semn public de descarcari).
//  - descarcari ~ rating-uri x 70 (1-2% dintre cei care descarca lasa rating; interval x0.5 - x2)
//  - venit ~ descarcari x 0.34 $ (venitul median pe descarcare la 60 de zile, RevenueCat 2026, app-uri cu abonament)
// E o estimare grosiera: o arata ca interval, nu ca cifra exacta.
export const DOWNLOADS_PER_RATING = 70;
export const REVENUE_PER_DOWNLOAD = 0.34;
export function marketEstimate(ratingsPerDay) {
  if (ratingsPerDay == null) return null;
  const downloadsDay = ratingsPerDay * DOWNLOADS_PER_RATING;
  const month = downloadsDay * 30 * REVENUE_PER_DOWNLOAD;
  return { downloadsDay: Math.round(downloadsDay), month: Math.round(month), low: Math.round(month / 2), high: Math.round(month * 2) };
}
