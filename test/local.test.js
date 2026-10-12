import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, importAll } from '../src/local/db.js';
import { makeViews } from '../src/local/views.js';
import { writeJsonGz, dayPath, classifyPath } from '../src/data/files.js';
import { addDays } from '../src/util/dates.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  for (let i = 0; i < 12; i++) {
    const date = addDays('2026-01-01', i);
    const terms = ['amazon', 'airbnb'];
    if (i >= 10) terms.unshift('ai baby'); // nou in ultimele 2 zile, pe primul loc
    writeJsonGz(dayPath(dir, date, 'US'), {
      date, country: 'US', complete: i !== 5, requests: 10, errors: 0,
      suggest: [{ prefix: 'a', kind: 'base', terms }],
      charts: [{ type: 'topfreeapplications', genreId: 6008, apps: [
        { rank: 1, id: 1, name: 'Photo One', genreId: 6008 },
        ...(i === 11 ? [{ rank: 2, id: 7, name: 'Baby Face AI', genreId: 6008 }, { rank: 3, id: 8, name: 'Baby Face Maker', genreId: 6008 }] : []),
      ] }],
    });
  }
  writeJsonGz(classifyPath(dir, '2026-01-11', 'US'), {
    'ai baby': { category: 6008, subgenre: null, difficulty: 1, topAppIds: [7, 8], classifiedAt: '2026-01-11' },
  });
  return dir;
}

test('import incremental + vederi', () => {
  const dir = fixture();
  const db = openDb();
  assert.deepEqual(importAll(db, dir), { days: 12, classify: 1, problems: 0 });
  assert.deepEqual(importAll(db, dir), { days: 0, classify: 0, problems: 0 }, 'a doua oara nu reimporta');

  const v = makeViews(db);
  const nou = v.view({ name: 'new', country: 'US', period: 7 });
  assert.deepEqual(nou.rows.map((r) => r.term), ['ai baby']);
  assert.equal(nou.rows[0].categoryName, 'Photo & Video');
  assert.equal(nou.rows[0].confirmed, true);
  assert.equal(nou.meta.US.warmup.done, true);

  const foto = v.view({ name: 'top', country: 'US', category: '6008' });
  assert.deepEqual(foto.rows.map((r) => r.term), ['ai baby']);
  const neclasificat = v.view({ name: 'top', country: 'US', category: 'none' });
  assert.deepEqual(neclasificat.rows.map((r) => r.term).sort(), ['airbnb', 'amazon']);

  const term = v.termView('AI Baby');
  const us = term.countries.find((c) => c.country === 'US');
  assert.equal(us.firstSeen, '2026-01-11');
  assert.equal(us.history.length, 11); // doar zilele complete
  assert.equal(us.last.prefix, 'a');

  const th = v.themeView({ country: 'US' });
  assert.equal(th[0].genreId, 6008);
  assert.deepEqual(th[0].themes.map((t) => t.theme), ['baby face', 'baby', 'face']);

  assert.deepEqual(v.suggestTerms('ai b'), ['ai baby']);
  assert.deepEqual(v.suggestTerms('ai'), ['airbnb', 'ai baby']);
  assert.equal(v.status().countries.US.incomplete[0], '2026-01-06');
});

test('fisier stricat => apare la probleme, restul se importa', () => {
  const dir = fixture();
  fs.writeFileSync(dayPath(dir, '2026-01-03', 'US'), 'nu e gzip');
  const db = openDb();
  const s = importAll(db, dir);
  assert.equal(s.problems, 1);
  assert.equal(s.days, 11);
  assert.equal(makeViews(db).status().problems[0].error, 'corrupt');
});
