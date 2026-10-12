import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartMovers, tokenize, themes } from '../src/metrics/themes.js';

const a = (id, rank, name = `App ${id}`) => ({ id, rank, name });

test('chartMovers: app nou intrat si urcare >=20 pozitii', () => {
  const weekAgo = [a(1, 50), a(2, 10), a(3, 30)];
  const past = [weekAgo, [a(1, 40), a(2, 10), a(3, 25)]];
  const today = [a(1, 25), a(2, 9), a(3, 20), a(4, 60)];
  const m = chartMovers(today, past, weekAgo);
  assert.deepEqual(m.map((x) => [x.id, x.kind]), [[1, 'up'], [4, 'new']]);
  assert.equal(m[0].climb, 25);
});

test('chartMovers: fara istoric nu marcheaza nimic (altfel totul ar fi "nou")', () => {
  assert.deepEqual(chartMovers([a(1, 1)], [], null), []);
});

test('tokenize: scoate stopwords si semne', () => {
  assert.deepEqual(tokenize('AI Photo Editor - Free & Pro App'), ['ai', 'photo', 'editor']);
  assert.deepEqual(tokenize('Fotobearbeitung für dein Handy'), ['fotobearbeitung', 'handy']);
});

test('themes: cuvinte si perechi comune la >=2 app-uri distincte', () => {
  const t = themes([
    { id: 1, name: 'AI Baby Generator' },
    { id: 2, name: 'Baby Generator: Face Maker' },
    { id: 3, name: 'Calm Sleep' },
    { id: 1, name: 'AI Baby Generator' }, // acelasi app din alt top nu se numara de doua ori
  ]);
  const byTheme = Object.fromEntries(t.map((x) => [x.theme, x.count]));
  assert.equal(byTheme['baby generator'], 2);
  assert.equal(byTheme.baby, 2);
  assert.equal(byTheme.ai, undefined);
  assert.equal(t[0].theme, 'baby generator'); // la egalitate, perechea inaintea cuvantului simplu
});
