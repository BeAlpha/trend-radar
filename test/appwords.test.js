import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordSource, words } from '../src/metrics/appwords.js';

test('words: litere mici, fara semne, diacritice pastrate', () => {
  assert.deepEqual(words('Minecraft: Play with Friends!'), ['minecraft', 'play', 'with', 'friends']);
  assert.deepEqual(words('Fotobearbeitung & Filter'), ['fotobearbeitung', 'filter']);
});

test('keywordSource: titlu / subtitlu / combinat / partial / ascuns', () => {
  const t = 'Minecraft: Play with Friends', s = 'Explore, build, craft together';
  assert.equal(keywordSource('minecraft', t, s), 'title');
  assert.equal(keywordSource('craft together', t, s), 'subtitle');
  assert.equal(keywordSource('minecraft build', t, s), 'both');
  assert.equal(keywordSource('minecraft pe', t, s), 'partial');
  assert.equal(keywordSource('block games', t, s), 'hidden');
  assert.equal(keywordSource('friend', t, s), 'title'); // singular/plural simplu
  assert.equal(keywordSource('minecraft', t, null), 'title');
});
