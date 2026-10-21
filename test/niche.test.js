import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nicheStats, competition, opportunity } from '../src/metrics/niche.js';

test('nicheStats: mediana, nota, noi si cuvantul in titlu (fara diacritice)', () => {
  const apps = [
    { name: 'Cat Game: Café', ratings: 10, stars: 4, releaseDate: '2026-09-01' },
    { name: 'Puzzle', ratings: 1000, stars: 3, releaseDate: '2019-01-01' },
    { name: 'CAT café game', ratings: 50, stars: null, releaseDate: '2026-01-01' },
  ];
  assert.deepEqual(nicheStats(apps, 'cat cafe', '2026-10-12'), { n: 3, med: 50, max: 1000, tmax: 50, stars: 3.5, fresh: 1, title: 2, brand: false, weak: 2, fresh90: 1, stale: 0 });
  assert.deepEqual(nicheStats([], 'x', '2026-10-12'), { n: 0, med: 0, max: 0, tmax: 0, stars: null, fresh: 0, title: 0, brand: false, weak: 0, fresh90: 0, stale: 0 });
});

test('competition / opportunity', () => {
  const giants = { n: 10, med: 200000, stars: 4.7, fresh: 0, title: 10 };
  const open = { n: 10, med: 5, stars: 3.9, fresh: 6, title: 1 };
  assert.equal(competition(giants), 100);
  assert.ok(competition(open) < 20);
  assert.equal(competition({ n: 0 }), null);
  assert.equal(opportunity({ score: 40, isNew: true, comp: competition(open) }) > opportunity({ score: 40, delta: 0, comp: 100 }), true);
  assert.equal(opportunity({ score: 50, delta: 10, comp: 40 }), 60);
  assert.equal(opportunity({ score: 50, comp: null }), null);
});

test('summarizeReviews: distributie + cuvintele frecvente din recenziile proaste', async () => {
  const { summarizeReviews } = await import('../src/metrics/reviews.js');
  const r = (stars, text, date = '2026-10-10') => ({ stars, title: '', text, date });
  const s = summarizeReviews([
    r(1, 'Too many ads, ads everywhere'), r(2, 'Crashes after the update, ads'), r(1, 'crash constantly, every level'),
    r(5, 'Love it'), r(4, 'Nice puzzles', '2026-10-01'),
  ]);
  assert.deepEqual(s.dist, [2, 1, 0, 1, 1]);
  assert.equal(s.avg, 2.6);
  assert.deepEqual(s.complaints, [{ word: 'ad', n: 2 }, { word: 'crash', n: 2 }]);
  assert.equal(s.badCount, 3);
  assert.equal(s.from, '2026-10-01');
});

test('nicheStats: marca = doar primul are numele si e urias fata de rest', () => {
  const brand = nicheStats([{ name: 'Google Meet', ratings: 900000 }, { name: 'Zoom', ratings: 500000 }, { name: 'Teams', ratings: 2000 }, { name: 'Webex', ratings: 30000 }], 'google meet', '2026-10-12');
  assert.equal(brand.brand, true);
  const notBrand = nicheStats([{ name: 'Noise App', ratings: 9000 }, { name: 'White noise', ratings: 8000 }, { name: 'Sleep', ratings: 7000 }], 'noise app', '2026-10-12');
  assert.equal(notBrand.brand, false); // restul sunt la fel de mari
  const b2 = nicheStats([{ name: 'MNET Plus', ratings: 50000 }, { name: 'K-pop fan', ratings: 300 }, { name: 'Idol vote', ratings: 1000 }], 'mnet', '2026-10-12');
  assert.equal(b2.brand, true);
  assert.equal(opportunity({ score: 80, comp: 10, brand: true }), 0);
  const niche = nicheStats([{ name: 'Cat cafe', ratings: 50 }, { name: 'Cat cafe 2', ratings: 40 }], 'cat cafe', '2026-10-12');
  assert.equal(niche.brand, false);
});

test('chance / saturated / marketEstimate / opportunity cu categoriile respinse de Apple', async () => {
  const { chance, saturated, marketEstimate, opportunity, isFlooding } = await import('../src/metrics/niche.js');
  assert.deepEqual(chance({ n: 10, med: 200000, stars: 4.7, fresh: 0, title: 10, weak: 0, fresh90: 0, stale: 0 }), { value: 0, approx: false });
  assert.equal(chance({ n: 10, med: 5, stars: 3.9, fresh: 6, title: 1, weak: 10, fresh90: 5, stale: 5 }).value, 81);
  assert.equal(chance({ n: 10, med: 5, stars: 3.9, fresh: 6, title: 1 }).approx, true); // clasificare veche
  assert.equal(chance({ n: 0 }), null);
  assert.equal(isFlooding({ fresh90: 3 }), true);
  assert.equal(saturated('flashlight app').label, 'lanternă');
  assert.equal(saturated('fondos de pantalla').label, 'wallpaper');
  assert.equal(saturated('fart sounds').level, 'ban');
  assert.equal(saturated('pet games'), null);
  assert.equal(saturated('kitchen timer for cooking'), null);
  assert.equal(saturated('ai photo'), null);
  assert.deepEqual(marketEstimate(10), { downloadsDay: 700, month: 7140, low: 3570, high: 14280 });
  assert.equal(opportunity({ score: 50, comp: 40, sat: { level: 'ban' } }), 0);
  assert.equal(opportunity({ score: 50, delta: 10, comp: 40, sat: { level: 'hard' } }), 30);
  assert.equal(opportunity({ score: 50, delta: 10, comp: 40, chance: { value: 80, approx: false } }), 70);
});
