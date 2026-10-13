import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/util/dates.js';
import {
  warmup, newTerms, isConfirmed, deltas, rising, falling, disappeared, topTerms,
} from '../src/metrics/trends.js';

// Construieste o serie din { 'YYYY-MM-DD': { term: score } } (doar zile complete).
function series(byDate) {
  const dates = Object.keys(byDate).sort();
  return { dates, scores: new Map(dates.map((d) => [d, new Map(Object.entries(byDate[d]))])) };
}
const days = (start, n, fn) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [addDays(start, i), fn(i)]));

test('warmup: nu e gata sub 7 zile complete', () => {
  assert.deepEqual(warmup(['2026-01-01', '2026-01-02']), { done: false, count: 2, endDate: null });
  const w = warmup(Object.keys(days('2026-01-01', 8, () => ({}))));
  assert.equal(w.done, true);
  assert.equal(w.endDate, '2026-01-07');
});

test('newTerms: ignora ce a aparut in perioada de pornire', () => {
  const s = series(days('2026-01-01', 10, (i) => (i >= 8 ? { vechi: 50, nou: 60 } : { vechi: 50 })));
  const index = new Map([
    ['vechi', { firstSeen: '2026-01-01' }],
    ['nou', { firstSeen: '2026-01-09' }],
  ]);
  const r = newTerms(s, index, 7);
  assert.deepEqual(r.map((x) => x.term), ['nou']);
  assert.equal(r[0].confirmed, true); // vazut 09 si 10
  assert.equal(r[0].score, 60);
});

test('newTerms: perioada 1 = doar ziua ultima', () => {
  const s = series(days('2026-01-01', 10, () => ({})));
  const index = new Map([
    ['ieri', { firstSeen: '2026-01-09' }],
    ['azi', { firstSeen: '2026-01-10' }],
  ]);
  assert.deepEqual(newTerms(s, index, 1).map((x) => x.term), ['azi']);
  assert.deepEqual(newTerms(s, index, 7).map((x) => x.term).sort(), ['azi', 'ieri']);
});

test('newTerms: in perioada de pornire = preliminar, fata de prima zi', () => {
  const s = series(days('2026-01-01', 3, (i) => (i === 0 ? { x: 10 } : { x: 10, y: 20 })));
  const index = new Map([['x', { firstSeen: '2026-01-01' }], ['y', { firstSeen: '2026-01-02' }]]);
  const r = newTerms(s, index, 7);
  assert.deepEqual(r.map((t) => t.term), ['y']);
  assert.equal(r[0].preliminary, true);
  assert.equal(r[0].seenDays, 2);
  assert.equal(r[0].ofDays, 2);
});

test('newTerms: o singura zi colectata = nimic', () => {
  const s = series(days('2026-01-01', 1, () => ({ x: 10 })));
  assert.deepEqual(newTerms(s, new Map([['x', { firstSeen: '2026-01-01' }]]), 7), []);
});

test('isConfirmed: o singura zi = neconfirmat', () => {
  const s = series(days('2026-01-01', 10, (i) => (i === 9 ? { x: 10 } : {})));
  assert.equal(isConfirmed(s, 'x', '2026-01-10'), false);
});

test('deltas 7z: compara media ultimelor 3 zile cu d-9..d-7', () => {
  // ultima zi = 2026-01-20; "atunci" = 11..13; "acum" = 18..20
  const s = series(days('2026-01-01', 20, (i) => (i >= 17 ? { up: 60, down: 10 } : { up: 20, down: 50 })));
  const d = new Map(deltas(s, 7).map((r) => [r.term, r]));
  assert.equal(d.get('up').delta, 40);
  assert.equal(d.get('down').delta, -40);
  assert.deepEqual(rising(s, 7).map((r) => r.term), ['up']);
  assert.deepEqual(falling(s, 7).map((r) => r.term), ['down']);
});

test('deltas: zilele incomplete (lipsa din serie) NU conteaza ca scor 0', () => {
  const byDate = days('2026-01-01', 20, () => ({ stabil: 50 }));
  delete byDate['2026-01-19']; // zi incompleta: nu apare in seria de zile complete
  const s = series(byDate);
  const r = deltas(s, 7).find((x) => x.term === 'stabil');
  assert.equal(r.delta, 0);
});

test('deltas: fara zile in fereastra "atunci" => lista goala', () => {
  const s = series(days('2026-01-01', 5, () => ({ x: 10 })));
  assert.deepEqual(deltas(s, 30), []);
});

test('rising: sub +5 nu intra', () => {
  const s = series(days('2026-01-01', 20, (i) => (i >= 17 ? { mic: 24 } : { mic: 20 })));
  assert.deepEqual(rising(s, 7), []);
});

test('disappeared: vazut >=5 din 7 zile anterioare si 0 in ultimele 3', () => {
  const s = series(days('2026-01-01', 12, (i) => {
    if (i >= 9) return { ramas: 30 };
    return { disparut: 40, ramas: 30, rar: i === 5 ? 10 : undefined };
  }));
  for (const m of s.scores.values()) for (const [k, v] of m) if (v === undefined) m.delete(k);
  const r = disappeared(s);
  assert.deepEqual(r.map((x) => x.term), ['disparut']);
  assert.equal(r[0].lastSeen, '2026-01-09');
});

test('topTerms: media ultimelor 3 zile, descrescator', () => {
  const s = series(days('2026-01-01', 3, (i) => ({ a: 90, b: 30 + i * 30 })));
  assert.deepEqual(topTerms(s).map((r) => [r.term, r.score]), [['a', 90], ['b', 60]]);
});
