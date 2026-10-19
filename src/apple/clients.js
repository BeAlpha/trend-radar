// Clientii Apple: sugestii (hints), cautare (iTunes Search), topuri (RSS), lookup.
import { HttpError, makeThrottle, makeRetry, makeCounter } from './net.js';

export const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'IT', 'ES'];
export const STOREFRONTS = { US: 143441, GB: 143444, DE: 143443, FR: 143442, IT: 143450, ES: 143454 };
export const CHART_TYPES = ['topfreeapplications', 'toppaidapplications'];

const HINTS_URL = 'https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/hints?clientApplication=Software&term=';

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeXml = (s) => s.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-f]+));/gi,
  (_, n, d, h) => (n ? XML_ENT[n] : String.fromCodePoint(d ? Number(d) : parseInt(h, 16))));

// Raspunsul hints e un plist XML; luam doar <key>term</key><string>...</string>, in ordine.
export function parseHints(xml) {
  const out = [];
  const re = /<key>term<\/key>\s*<string>([\s\S]*?)<\/string>/g;
  for (let m; (m = re.exec(xml));) {
    const t = decodeXml(m[1]).trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function parseSearch(json) {
  return (json.results ?? []).slice(0, 10).map((r) => ({
    id: r.trackId,
    name: r.trackName ?? '',
    genreId: Number(r.primaryGenreId),
    subgenreId: (r.genreIds ?? []).map(Number).find((g) => g >= 7000 && g < 8000) ?? null,
    ratings: r.userRatingCount ?? 0,
  }));
}

export function parseChart(json) {
  let e = json?.feed?.entry;
  if (!e) return [];
  if (!Array.isArray(e)) e = [e];
  return e.map((x, i) => ({
    rank: i + 1,
    id: Number(x.id?.attributes?.['im:id']),
    name: x['im:name']?.label ?? '',
    genreId: Number(x.category?.attributes?.['im:id']),
  }));
}

// Date stabile ale unui app, pentru "Aplicatii noi": in primul rand data lansarii.
export function parseAppMeta(json) {
  return (json.results ?? []).filter((r) => r.trackId).map((r) => ({
    id: r.trackId,
    name: r.trackName ?? '',
    genreId: Number(r.primaryGenreId) || null,
    releaseDate: r.releaseDate ? r.releaseDate.slice(0, 10) : null,
    seller: r.sellerName ?? r.artistName ?? '',
  }));
}

export function parseLookup(json) {
  return (json.results ?? []).map((r) => ({
    id: r.trackId,
    name: r.trackName ?? '',
    icon: r.artworkUrl100 ?? r.artworkUrl60 ?? '',
    ratings: r.userRatingCount ?? 0,
    rating: r.averageUserRating ?? null,
    seller: r.sellerName ?? '',
    url: r.trackViewUrl ?? '',
  }));
}

// Metadata completa a unui app (iTunes Lookup).
export function parseAppDetail(r) {
  if (!r) return null;
  return {
    id: r.trackId, name: r.trackName ?? '', seller: r.sellerName ?? r.artistName ?? '',
    sellerUrl: r.artistViewUrl ?? '', url: r.trackViewUrl ?? '', bundleId: r.bundleId ?? '',
    icon: r.artworkUrl512 ?? r.artworkUrl100 ?? '', description: r.description ?? '',
    releaseNotes: r.releaseNotes ?? '', version: r.version ?? '',
    updated: r.currentVersionReleaseDate ?? null, released: r.releaseDate ?? null,
    price: r.formattedPrice ?? '', genres: r.genres ?? [], primaryGenreId: Number(r.primaryGenreId),
    rating: r.averageUserRating ?? null, ratings: r.userRatingCount ?? 0,
    ageRating: r.trackContentRating ?? r.contentAdvisoryRating ?? '',
    languages: r.languageCodesISO2A ?? [], sizeBytes: Number(r.fileSizeBytes) || null,
    minOs: r.minimumOsVersion ?? '', screenshots: r.screenshotUrls ?? [], ipadScreenshots: r.ipadScreenshotUrls ?? [],
  };
}

// Subtitlul nu e in Lookup: il luam din pagina web App Store (primul element "subtitle" = antetul app-ului).
export function parseSubtitle(html) {
  const m = /class="subtitle[^"]*"[^>]*>([^<]+)</.exec(html);
  return m ? decodeXml(m[1]).trim() : null;
}

// Throttle-uri separate: hints/RSS tolereaza ~50/min, iTunes Search ~20/min.
export function makeAppleClient({
  fetchImpl = fetch,
  lightMs = 1200,
  searchMs = 4000,
  retry = makeRetry(),
  counter = makeCounter(),
} = {}) {
  const light = makeThrottle(lightMs);
  const heavy = makeThrottle(searchMs);
  const call = (throttle, what, url, opts, parse) =>
    counter.track(() => retry(() => throttle(async () => {
      const res = await fetchImpl(url, opts);
      if (!res.ok) throw new HttpError(res.status, what);
      return parse(res);
    })));

  return {
    counter,
    suggest(prefix, country) {
      const sf = STOREFRONTS[country];
      if (!sf) throw new Error(`Tara necunoscuta: ${country}`);
      return call(light, 'hints', HINTS_URL + encodeURIComponent(prefix),
        { headers: { 'X-Apple-Store-Front': `${sf},29` } }, async (r) => parseHints(await r.text()));
    },
    topApps(term, country) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}`
        + `&country=${country.toLowerCase()}&media=software&entity=software&limit=10&lang=en_us`;
      return call(heavy, 'search', url, {}, async (r) => parseSearch(await r.json()));
    },
    chart(country, type, genreId) {
      const url = `https://itunes.apple.com/${country.toLowerCase()}/rss/${type}/limit=100/genre=${genreId}/json`;
      return call(light, 'rss', url, {}, async (r) => parseChart(await r.json()));
    },
    async appDetail(id, country) {
      const url = `https://itunes.apple.com/lookup?id=${id}&country=${country.toLowerCase()}`;
      const detail = await call(heavy, 'lookup', url, {}, async (r) => parseAppDetail((await r.json()).results?.[0]));
      if (!detail) return null;
      try {
        const res = await fetchImpl(`https://apps.apple.com/${country.toLowerCase()}/app/id${id}`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15' } });
        detail.subtitle = res.ok ? parseSubtitle(await res.text()) : null;
      } catch {
        detail.subtitle = null; // pagina web e optionala; restul metadatelor raman
      }
      return detail;
    },
    appMeta(ids, country) {
      const url = `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${country.toLowerCase()}`;
      return call(heavy, 'lookup', url, {}, async (r) => parseAppMeta(await r.json()));
    },
    lookup(ids, country) {
      const url = `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${country.toLowerCase()}`;
      return call(heavy, 'lookup', url, {}, async (r) => parseLookup(await r.json()));
    },
  };
}
