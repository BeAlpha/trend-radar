import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHints, parseSearch, parseChart, makeAppleClient } from '../src/apple/clients.js';
import { makeThrottle, makeRetry, makeCounter, HttpError } from '../src/apple/net.js';

const HINTS = `<?xml version="1.0"?><plist version="1.0"><dict><key>title</key><string>Suggestions</string>
<key>hints</key><array>
<dict><key>term</key><string>AI Chat</string><key>url</key><string>https://x?a=1&amp;b=2</string></dict>
<dict><key>term</key><string>tom &amp; jerry</string><key>url</key><string>u</string></dict>
<dict><key>term</key><string>ai chat</string><key>url</key><string>u</string></dict>
</array></dict></plist>`;

test('parseHints: ordine, decodare entitati, litere mici, fara dubluri', () => {
  assert.deepEqual(parseHints(HINTS), ['ai chat', 'tom & jerry']);
  assert.deepEqual(parseHints('<plist><dict><key>hints</key><array></array></dict></plist>'), []);
});

test('parseSearch: gen principal si subgen de joc', () => {
  const r = parseSearch({ results: [
    { trackId: 1, trackName: 'X', primaryGenreId: 6014, genreIds: ['6014', '7012', '6016'], userRatingCount: 5 },
    { trackId: 2, trackName: 'Y', primaryGenreId: '6003', genreIds: ['6003'] },
  ] });
  assert.deepEqual(r, [
    { id: 1, name: 'X', genreId: 6014, subgenreId: 7012, ratings: 5 },
    { id: 2, name: 'Y', genreId: 6003, subgenreId: null, ratings: 0 },
  ]);
});

test('parseChart: lista, intrare unica si feed gol', () => {
  const entry = (id) => ({ id: { attributes: { 'im:id': String(id) } }, 'im:name': { label: `A${id}` },
    category: { attributes: { 'im:id': '6008' } } });
  assert.deepEqual(parseChart({ feed: { entry: [entry(5), entry(7)] } }).map((x) => [x.rank, x.id]), [[1, 5], [2, 7]]);
  assert.equal(parseChart({ feed: { entry: entry(9) } })[0].genreId, 6008);
  assert.deepEqual(parseChart({ feed: {} }), []);
});

test('throttle: o eroare nu blocheaza apelurile urmatoare', async () => {
  const t = makeThrottle(0);
  await assert.rejects(t(async () => { throw new Error('x'); }));
  assert.equal(await t(async () => 42), 42);
});

test('retry: reincearca la 429, nu la 404', async () => {
  const sleeps = [];
  const retry = makeRetry({ retries: 3, baseDelayMs: 10, sleep: async (ms) => sleeps.push(ms) });
  let n = 0;
  assert.equal(await retry(async () => { if (++n < 3) throw new HttpError(429, 't'); return 'ok'; }), 'ok');
  assert.deepEqual(sleeps, [10, 20]);
  let m = 0;
  await assert.rejects(retry(async () => { m++; throw new HttpError(404, 't'); }));
  assert.equal(m, 1);
});

test('counter: tooManyFailures peste 10% dupa minim 50 cereri', async () => {
  const c = makeCounter();
  for (let i = 0; i < 44; i++) await c.track(async () => 1);
  for (let i = 0; i < 6; i++) await c.track(async () => { throw new Error('x'); }).catch(() => {});
  assert.equal(c.tooManyFailures(), true); // 6/50 = 12%
  assert.equal(makeCounter().tooManyFailures(), false);
});

test('client.suggest trimite storefront-ul tarii', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, text: async () => HINTS }; };
  const apple = makeAppleClient({ fetchImpl, lightMs: 0, retry: makeRetry({ retries: 0 }) });
  assert.deepEqual(await apple.suggest('ai', 'DE'), ['ai chat', 'tom & jerry']);
  assert.equal(seen.opts.headers['X-Apple-Store-Front'], '143443,29');
  assert.match(seen.url, /term=ai$/);
  assert.equal(apple.counter.stats.requests, 1);
});

test('parseSubtitle: primul subtitlu din pagina (antetul app-ului)', async () => {
  const { parseSubtitle } = await import('../src/apple/clients.js');
  const html = '<h1>X</h1><h2 class="subtitle svelte-kps97o">Explore, build &amp; craft</h2><p class="subtitle svelte-1">Altceva</p>';
  assert.equal(parseSubtitle(html), 'Explore, build & craft');
  assert.equal(parseSubtitle('<html></html>'), null);
});
