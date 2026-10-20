import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCountry, classificationQueue, expansionPrefixes } from '../src/collect/run-country.js';
import { prefixesFor } from '../src/collect/prefixes.js';
import { makeCounter } from '../src/apple/net.js';
import { readJsonGz, dayPath, classifyPath, appsPath, statsPath, writeJsonGz } from '../src/data/files.js';
import { addDays } from '../src/util/dates.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'));

function fakeApple({ failSuggest = () => false } = {}) {
  const counter = makeCounter();
  const calls = { suggest: [], topApps: [], chart: 0 };
  return {
    calls,
    counter,
    suggest: (p, cc) => counter.track(async () => {
      calls.suggest.push(p);
      if (failSuggest(p)) throw new Error('boom');
      return [`${p.trim()} one`, `${p.trim()} two`];
    }),
    topApps: (t) => counter.track(async () => {
      calls.topApps.push(t);
      return [1, 2, 3, 4, 5].map((id) => ({ id, name: `A${id}`, genreId: 6003, subgenreId: null, ratings: 100, stars: 4, releaseDate: '2020-01-01' }));
    }),
    newFeed: () => counter.track(async () => []),
    chart: () => counter.track(async () => { calls.chart++; return [{ rank: 1, id: 9, name: 'Z', genreId: 6003 }]; }),
    appMeta: (ids) => counter.track(async () => {
      calls.appMeta = [...(calls.appMeta ?? []), ids];
      return ids.map((id) => ({ id, name: `App ${id}`, genreId: 6003, releaseDate: '2026-10-01', seller: 'S',
        ratings: id * 10, ratingsCur: id, stars: 4.5, version: '1.0', updated: '2026-10-10', price: 0 }));
    }),
  };
}

test('prefixesFor: 702 + litere locale', () => {
  assert.equal(prefixesFor('US').length, 702);
  assert.equal(prefixesFor('DE').length, 705);
  assert.equal(prefixesFor('ES').length, 708);
});

test('runCountry scrie fisierul zilei si clasificarile', async () => {
  const dir = tmp();
  const apple = fakeApple();
  const s = await runCountry({
    country: 'US', date: '2026-10-12', dataDir: dir, apple, log: () => {},
    budget: { prefixes: ['a', 'b'], chartGenres: [6003], classifyMax: 3 },
  });
  const day = readJsonGz(dayPath(dir, '2026-10-12', 'US'));
  assert.equal(day.complete, true);
  assert.deepEqual(day.suggest.map((x) => x.prefix), ['a', 'b']);
  assert.equal(day.charts.length, 3); // free + paid + grossing
  assert.deepEqual(day.newFeed.map((f) => f.type), ['newfreeapplications', 'newpaidapplications']);
  const cls = readJsonGz(classifyPath(dir, '2026-10-12', 'US'));
  assert.equal(Object.keys(cls).length, 3);
  assert.equal(cls['a one'].category, 6003);
  assert.equal(cls['a one'].difficulty, 1);
  assert.deepEqual(cls['a one'].niche, { n: 5, med: 100, stars: 4, fresh: 0, title: 0, brand: false });
  assert.equal(s.queueLeft, 1);
});

test('runCountry: prea multe erori => zi incompleta si oprire', async () => {
  const dir = tmp();
  const apple = fakeApple({ failSuggest: () => true });
  const prefixes = prefixesFor('US').slice(0, 200);
  const s = await runCountry({
    country: 'US', date: '2026-10-12', dataDir: dir, apple, log: () => {},
    budget: { prefixes, chartGenres: [6003] },
  });
  assert.equal(s.complete, false);
  assert.ok(apple.calls.suggest.length < 200, 'trebuia sa se opreasca devreme');
  assert.equal(readJsonGz(dayPath(dir, '2026-10-12', 'US')).complete, false);
});

test('runCountry nu reclasifica ce a fost clasificat recent', async () => {
  const dir = tmp();
  writeJsonGz(classifyPath(dir, '2026-10-01', 'US'), { 'a one': { category: 6003, classifiedAt: '2026-10-01' } });
  const apple = fakeApple();
  await runCountry({
    country: 'US', date: '2026-10-12', dataDir: dir, apple, log: () => {},
    budget: { prefixes: ['a'], chartGenres: [] },
  });
  assert.deepEqual(apple.calls.topApps, ['a two']);
});

test('classificationQueue: reclasifica dupa 30 de zile, scor mare primul', () => {
  const index = new Map([['vechi', { classifiedAt: '2026-09-01' }], ['recent', { classifiedAt: '2026-10-10' }]]);
  const today = new Map([['vechi', 40], ['recent', 90], ['nou', 70]]);
  assert.deepEqual(classificationQueue(index, today, '2026-10-12'), ['nou', 'vechi']);
});

test('classificationQueue: cuvintele aparute recent inaintea celor vechi cu scor mare', () => {
  const index = new Map([['vechi', { firstSeen: '2026-09-01' }], ['ieri', { firstSeen: '2026-10-11' }]]);
  const today = new Map([['vechi', 90], ['ieri', 20], ['azi', 10]]);
  assert.deepEqual(classificationQueue(index, today, '2026-10-12'), ['ieri', 'azi', 'vechi']);
});

test('expansionPrefixes: primul cuvant + spatiu, fara dubluri, cu limita', () => {
  const dates = Array.from({ length: 10 }, (_, i) => addDays('2026-01-01', i));
  const scores = new Map(dates.map((d, i) => [d, new Map(i === 9
    ? [['ai photo', 60], ['ai baby', 50], ['zoo app', 40], ['vechi', 10]]
    : [['vechi', 10]])]));
  const index = new Map([
    ['ai photo', { firstSeen: '2026-01-10' }], ['ai baby', { firstSeen: '2026-01-10' }],
    ['zoo app', { firstSeen: '2026-01-10' }], ['vechi', { firstSeen: '2026-01-01' }],
  ]);
  assert.deepEqual(expansionPrefixes({ dates, scores }, index, 5), ['ai ', 'zoo ']);
  assert.deepEqual(expansionPrefixes({ dates, scores }, index, 1), ['ai ']);
});

test('runCountry: rularea de proba (smoke) nu e zi completa', async () => {
  const dir = tmp();
  const s = await runCountry({
    country: 'US', date: '2026-10-12', dataDir: dir, apple: fakeApple(), smoke: true, log: () => {},
    budget: { prefixes: ['a'], chartGenres: [] },
  });
  assert.equal(s.complete, false);
  assert.equal(readJsonGz(dayPath(dir, '2026-10-12', 'US')).smoke, true);
});

test('runCountry: lookup pentru toate app-urile din topuri + lansari noi; data lansarii doar pentru cele necunoscute', async () => {
  const dir = tmp();
  writeJsonGz(appsPath(dir, '2026-10-01', 'US'), { 8: { name: 'Vechi', releaseDate: '2020-01-01' } });
  const apple = fakeApple();
  apple.chart = () => apple.counter.track(async () => [{ rank: 1, id: 9, name: 'Z', genreId: 6003 }, { rank: 2, id: 8, name: 'V', genreId: 6003 }]);
  apple.newFeed = (cc, type) => apple.counter.track(async () => (type === 'newfreeapplications' ? [{ rank: 1, id: 4, name: 'N', genreId: 6014 }] : []));
  const s = await runCountry({
    country: 'US', date: '2026-10-12', dataDir: dir, apple, log: () => {},
    budget: { prefixes: ['a'], chartGenres: [6003], classifyMax: 0 },
  });
  assert.deepEqual(apple.calls.appMeta, [[9, 8, 4]]);
  assert.deepEqual(s.appMeta, { meta: 2, stats: 3 });
  const meta = readJsonGz(appsPath(dir, '2026-10-12', 'US'));
  assert.deepEqual(Object.keys(meta).sort(), ['4', '9']);
  assert.equal(meta[9].releaseDate, '2026-10-01');
  assert.deepEqual(readJsonGz(statsPath(dir, '2026-10-12', 'US'))[8], [80, 8, 4.5, '1.0', '2026-10-10', 0]);
  assert.equal(readJsonGz(dayPath(dir, '2026-10-12', 'US')).newFeed[0].apps[0].id, 4);
});

test('classificationQueue: cuvintele in crestere fara scor de nisa se refac, dupa cele noi', () => {
  const index = new Map([
    ['vechi', { firstSeen: '2026-09-01', classifiedAt: '2026-10-10' }],
    ['urca', { firstSeen: '2026-09-01', classifiedAt: '2026-10-10' }],
    ['urca2', { firstSeen: '2026-09-01', classifiedAt: '2026-10-10', niche: { n: 10 } }],
    ['nou', { firstSeen: '2026-10-11' }],
  ]);
  const today = new Map([['vechi', 90], ['urca', 50], ['urca2', 60], ['nou', 10]]);
  assert.deepEqual(classificationQueue(index, today, '2026-10-12', new Set(['urca', 'urca2'])), ['nou', 'urca']);
});
