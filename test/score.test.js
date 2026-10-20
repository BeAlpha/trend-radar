import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandScore, scoreDay, difficulty, median, categorize } from '../src/metrics/score.js';

test('bandScore: 1 caracter = 70-100', () => {
  assert.equal(bandScore(1, 1), 100);
  assert.equal(bandScore(1, 10), 73);
  assert.equal(bandScore(1, 25), 70); // pozitii peste 10 nu coboara sub capatul de jos
});

test('bandScore: 2 caractere = 40-69, >=3 = 10-39', () => {
  assert.equal(bandScore(2, 1), 69);
  assert.equal(bandScore(2, 10), 43);
  assert.equal(bandScore(3, 1), 39);
  assert.equal(bandScore(12, 10), 13);
});

test('scoreDay ia cea mai buna aparitie a fiecarui cuvant', () => {
  const m = scoreDay([
    { prefix: 'a', terms: ['airbnb', 'ai chat'] },
    { prefix: 'ai', terms: ['ai chat', 'ai photo'] },
    { prefix: 'ai ', terms: ['ai photo', 'ai photo editor'] },
  ]);
  assert.equal(m.get('airbnb'), 100);
  assert.equal(m.get('ai chat'), 97);   // a, pozitia 2
  assert.equal(m.get('ai photo'), 66);  // ai, pozitia 2 (bate 'ai ' pozitia 1 = 39)
  assert.equal(m.get('ai photo editor'), 36);
});

test('scoreDay: prefixul cu diacritice se numara pe caractere, nu pe bytes', () => {
  // 'ü' = 1 caracter (nu 2 bytes); fiind litera locala, are banda de 2 litere
  assert.equal(scoreDay([{ prefix: 'ü', terms: ['überweisung'] }]).get('überweisung'), 69);
  assert.equal(scoreDay([{ prefix: 'üb', terms: ['überweisung'] }]).get('überweisung'), 69);
});

test('median si difficulty', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(difficulty([]), null);
  assert.equal(difficulty([10, 20, 900]), 1);
  assert.equal(difficulty([1000, 2000, 30000]), 2);
  assert.equal(difficulty([60000, 70000, 10]), 3);
});

const app = (genreId, subgenreId = null) => ({ genreId, subgenreId });

test('categorize: gen majoritar cu >=4 aplicatii', () => {
  const apps = [app(6003), app(6003), app(6003), app(6003), app(6010), app(6000)];
  assert.deepEqual(categorize(apps), { category: 6003, subgenre: null });
});

test('categorize: sub 4 la orice gen => Mixt (0)', () => {
  const apps = [app(6003), app(6003), app(6003), app(6010), app(6010), app(6000)];
  assert.deepEqual(categorize(apps), { category: 0, subgenre: null });
  assert.deepEqual(categorize([]), { category: 0, subgenre: null });
});

test('categorize: la Games pastreaza subgenul majoritar', () => {
  const apps = [app(6014, 7012), app(6014, 7012), app(6014, 7003), app(6014, 7012), app(6017)];
  assert.deepEqual(categorize(apps), { category: 6014, subgenre: 7012 });
});

test('litera locala singura are scorul unui inceput de 2 litere', async () => {
  const { scoreDay } = await import('../src/metrics/score.js');
  const m = scoreDay([{ prefix: 'ñ', terms: ['ñam'] }, { prefix: 'a', terms: ['amazon'] }]);
  assert.equal(m.get('ñam'), 69);
  assert.equal(m.get('amazon'), 100);
});

test('combinatiile rare de 2 litere: penalizate, dar un inceput normal castiga', async () => {
  const { naturalPrefix, scoreDayAdjusted, RARE_PENALTY } = await import('../src/metrics/score.js');
  assert.deepEqual(['ab', 'st', 'sch', 'ä', 'tr', '8 ', 'jt', 'zg', 'mt', 'qk'].map(naturalPrefix), [true, true, true, true, true, true, false, false, false, false]);
  const m = scoreDayAdjusted([
    { prefix: 'jt', terms: ['jt rides'] },
    { prefix: 'vp', terms: ['vpn'] },
    { prefix: 'mt', terms: ['mtg arena'] }, { prefix: 'ma', terms: ['x', 'mtg arena'] },
  ]);
  assert.equal(m.get('jt rides'), 69 - RARE_PENALTY);
  assert.equal(m.get('mtg arena'), 66); // "ma" pozitia 2 bate "mt" pozitia 1 penalizat
});
