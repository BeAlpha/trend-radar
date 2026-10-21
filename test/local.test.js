import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, importAll } from '../src/local/db.js';
import { makeViews } from '../src/local/views.js';
import { writeJsonGz, dayPath, classifyPath, appsPath, statsPath, changesPath } from '../src/data/files.js';
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
  assert.deepEqual(importAll(db, dir), { days: 12, classify: 1, apps: 0, stats: 0, changes: 0, problems: 0 });
  assert.deepEqual(importAll(db, dir), { days: 0, classify: 0, apps: 0, stats: 0, changes: 0, problems: 0 }, 'a doua oara nu reimporta');

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

test('appKeywords: cuvintele unde app-ul e in top 10, cu pozitie si scor', () => {
  const dir = fixture();
  const db = openDb();
  importAll(db, dir);
  const v = makeViews(db);
  assert.deepEqual(v.appKeywords(8).map((k) => [k.country, k.term, k.position, k.score]), [['US', 'ai baby', 2, 100]]);
  assert.deepEqual(v.appKeywords(80), []); // 80 nu trebuie sa se potriveasca cu 8
});

test('Nou: apărut (sugestii de bază sau extindere deja întrebată) vs descoperit (prima întrebare a extinderii)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  for (let i = 0; i < 12; i++) {
    const date = addDays('2026-01-01', i);
    const suggest = [{ prefix: 'a', kind: 'base', terms: i >= 10 ? ['ai baby', 'amazon'] : ['amazon'] }];
    if (i >= 8) suggest.push({ prefix: 'ai ', kind: 'expand', terms: i >= 10 ? ['ai photo', 'ai video'] : ['ai photo'] });
    if (i === 10) suggest.push({ prefix: 'zoo ', kind: 'expand', terms: ['zoo park'] });
    writeJsonGz(dayPath(dir, date, 'US'), { date, country: 'US', complete: true, requests: 1, errors: 0, suggest, charts: [] });
  }
  const db = openDb();
  importAll(db, dir);
  const v = makeViews(db);
  const origin = (o) => Object.fromEntries(v.view({ name: 'new', country: 'US', period: 30, origin: o }).rows.map((r) => [r.term, r.origin]));
  assert.deepEqual(origin('all'), { 'ai baby': 'appeared', 'ai video': 'appeared', 'ai photo': 'discovered', 'zoo park': 'discovered' });
  assert.deepEqual(Object.keys(origin('appeared')).sort(), ['ai baby', 'ai video']);
  assert.deepEqual(Object.keys(origin('discovered')).sort(), ['ai photo', 'zoo park']);
});

test('baza veche (fara tabela queried) => reimport complet la deschidere', () => {
  const dir = fixture();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trl-')), 'x.db');
  const db = openDb(file);
  importAll(db, dir);
  db.exec('PRAGMA user_version = 1');
  db.close();
  assert.equal(importAll(openDb(file), dir).days, 12);
});

test('newApps: lansate recent, cel mai bun loc, urcare pe 7 zile, in cate tari', async () => {
  const { appsPath } = await import('../src/data/files.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  for (let i = 0; i < 9; i++) {
    const date = addDays('2026-01-01', i);
    for (const cc of ['US', 'GB']) {
      const apps = [{ rank: 1, id: 1, name: 'Vechi', genreId: 6014 }];
      if (i === 1) apps.push({ rank: 50, id: 2, name: 'Joc Nou', genreId: 6014 });
      if (i === 8) apps.push({ rank: 3, id: 2, name: 'Joc Nou', genreId: 6014 });
      if (i === 8 && cc === 'US') apps.push({ rank: 9, id: 3, name: 'Abia Intrat', genreId: 6014 });
      writeJsonGz(dayPath(dir, date, cc), { date, country: cc, complete: true, requests: 1, errors: 0, suggest: [],
        charts: [{ type: 'topfreeapplications', genreId: 7012, apps }] });
    }
  }
  for (const cc of ['US', 'GB']) {
    writeJsonGz(appsPath(dir, '2026-01-09', cc), {
      1: { name: 'Vechi', genreId: 6014, releaseDate: '2019-05-01' },
      2: { name: 'Joc Nou', genreId: 6014, releaseDate: '2025-12-20' },
      3: { name: 'Abia Intrat', genreId: 6014, releaseDate: '2025-11-01' },
    });
  }
  const db = openDb();
  importAll(db, dir);
  const v = makeViews(db);
  const us = v.newApps({ country: 'US', launched: 30 });
  assert.deepEqual(us.rows.map((r) => r.id), [2]);
  assert.equal(us.rows[0].bestRank, 3);
  assert.equal(us.rows[0].climb, 47);
  assert.equal(us.rows[0].bestChartName, 'Puzzle');
  const all = v.newApps({ country: 'ALL', launched: 90 });
  assert.deepEqual(all.rows.map((r) => [r.id, r.countries.length]), [[2, 2], [3, 1]]);
  assert.equal(all.rows[1].climb, null); // intrat azi in top
  assert.equal(all.rows[1].newInChart, true);
  const ranks = v.appRanks(2);
  assert.deepEqual(ranks.downloads.find((s) => s.country === 'US').points.map((p) => [p.date, p.score]), [['2026-01-02', 50], ['2026-01-09', 3]]);
});

test('newApps: daca cel mai bun top e nou (fara istoric), urcarea vine din topul cu istoric', async () => {
  const { appsPath } = await import('../src/data/files.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  for (let i = 0; i < 9; i++) {
    const date = addDays('2026-01-01', i);
    const charts = [{ type: 'toppaidapplications', genreId: 6014, apps: [{ rank: i === 8 ? 4 : 16, id: 2, name: 'Joc', genreId: 6014 }] }];
    if (i === 8) charts.push({ type: 'toppaidapplications', genreId: 7001, apps: [{ rank: 1, id: 2, name: 'Joc', genreId: 6014 }] });
    writeJsonGz(dayPath(dir, date, 'US'), { date, country: 'US', complete: true, requests: 1, errors: 0, suggest: [], charts });
  }
  writeJsonGz(appsPath(dir, '2026-01-09', 'US'), { 2: { name: 'Joc', genreId: 6014, releaseDate: '2025-12-30' } });
  const db = openDb();
  importAll(db, dir);
  const [r] = makeViews(db).newApps({ country: 'US', launched: 30 }).rows;
  assert.equal(r.bestRank, 1);
  assert.equal(r.bestChartName, 'Action');
  assert.equal(r.climb, 12);
  assert.equal(r.newInChart, false);
  assert.equal(r.climbChartName, 'Games #4');
});

test('newApps: face bani (incasari), rating-uri pe zi, zile pana in top; lansari noi in afara topului', async () => {
  const { appsPath, statsPath } = await import('../src/data/files.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  for (let i = 0; i < 8; i++) {
    const date = addDays('2026-01-01', i);
    const charts = [{ type: 'topfreeapplications', genreId: 6014, apps: [{ rank: 1, id: 1, name: 'Vechi', genreId: 6014 }] }];
    if (i >= 3) charts[0].apps.push({ rank: 5, id: 2, name: 'Joc', genreId: 6014 });
    if (i === 7) charts.push({ type: 'topgrossingapplications', genreId: 6014, apps: [{ rank: 9, id: 2, name: 'Joc', genreId: 6014 }] });
    writeJsonGz(dayPath(dir, date, 'US'), { date, country: 'US', complete: true, requests: 1, errors: 0, suggest: [], charts,
      newFeed: [{ type: 'newfreeapplications', apps: [{ rank: 1, id: 3, name: 'Abia lansat', genreId: 6014 }] }] });
    writeJsonGz(statsPath(dir, date, 'US'), { 2: [100 + i * 20, 5, 4.5, '1.0', '2026-01-01', 0], 3: [i * 3, 0, null, '1.0', '2026-01-01', 0] });
  }
  writeJsonGz(appsPath(dir, '2026-01-01', 'US'), {
    1: { name: 'Vechi', genreId: 6014, releaseDate: '2019-05-01' },
    2: { name: 'Joc', genreId: 6014, releaseDate: '2026-01-02' },
    3: { name: 'Abia lansat', genreId: 6014, releaseDate: '2026-01-01' },
  });
  const db = openDb();
  importAll(db, dir);
  const v = makeViews(db);
  const [r] = v.newApps({ country: 'US', launched: 30 }).rows;
  assert.equal(r.id, 2);
  assert.equal(r.bestRank, 5); // locul din descarcari, nu din incasari
  assert.equal(r.type, 'topfreeapplications');
  assert.equal(r.grossRank, 9);
  assert.equal(r.ratings, 240);
  assert.equal(r.ratingsPerDay, 20);
  assert.equal(r.daysToTop, 2); // lansat pe 2 ian, in top din 4 ian
  assert.deepEqual(v.newApps({ country: 'US', launched: 30, type: 'grossing' }).rows.map((x) => [x.id, x.bestRank]), [[2, 9]]);
  const feed = v.newApps({ country: 'US', launched: 30, source: 'feed' }).rows;
  assert.deepEqual(feed.map((x) => [x.id, x.ratingsPerDay, x.firstInFeed]), [[3, 3, '2026-01-01']]);
  const ranks = v.appRanks(2);
  assert.deepEqual(ranks.grossing.find((s) => s.country === 'US').points, [{ date: '2026-01-08', score: 9 }]);
  assert.equal(ranks.ratings.find((s) => s.country === 'US').points.length, 8);
});

test('nicheView: cuvintele noi/in crestere cu concurenta, oportunitate si cine face bani', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  for (let i = 0; i < 10; i++) {
    const date = addDays('2026-01-01', i);
    const terms = ['amazon'];
    if (i >= 8) terms.push('cat cafe');
    writeJsonGz(dayPath(dir, date, 'US'), { date, country: 'US', complete: true, requests: 1, errors: 0,
      suggest: [{ prefix: 'a', kind: 'base', terms }, { prefix: 'ca', kind: 'base', terms: i >= 8 ? ['cat cafe'] : [] }],
      charts: [{ type: 'topgrossingapplications', genreId: 6014, apps: [{ rank: 3, id: 7, name: 'Cat Cafe', genreId: 6014 }] }] });
  }
  writeJsonGz(classifyPath(dir, '2026-01-09', 'US'), {
    'cat cafe': { category: 6014, difficulty: 1, topAppIds: [7, 8], classifiedAt: '2026-01-09', niche: { n: 10, med: 5, stars: 3.9, fresh: 6, title: 1 } },
  });
  const db = openDb();
  importAll(db, dir);
  const r = makeViews(db).nicheView({ country: 'US', period: 14 });
  const row = r.rows.find((x) => x.term === 'cat cafe');
  assert.equal(row.isNew, true);
  assert.ok(row.competition < 20);
  assert.ok(row.opportunity > 60);
  assert.equal(row.moneyApps, 1);
  assert.equal(row.freshApps, 6);
  assert.equal(row.categoryName, 'Games');
});

test('scorul ajustat: combinatie rara penalizata, dar nu daca in top e un app mare', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  for (let i = 0; i < 3; i++) {
    const date = addDays('2026-01-01', i);
    writeJsonGz(dayPath(dir, date, 'US'), { date, country: 'US', complete: true, requests: 1, errors: 0,
      suggest: [{ prefix: 'jt', kind: 'base', terms: ['jt rides'] }, { prefix: 'vp', kind: 'base', terms: ['vpn'] }], charts: [] });
  }
  writeJsonGz(classifyPath(dir, '2026-01-02', 'US'), {
    vpn: { category: 6007, difficulty: 1, topAppIds: [1], classifiedAt: '2026-01-02', niche: { n: 10, med: 500, max: 900000, tmax: 900000 } },
    'jt rides': { category: 6003, difficulty: 3, topAppIds: [2], classifiedAt: '2026-01-02', niche: { n: 10, med: 90000, max: 900000, tmax: 40 } },
  });
  const db = openDb();
  importAll(db, dir);
  const v = makeViews(db);
  const top = v.view({ name: 'top', country: 'US' }).rows;
  assert.equal(top.find((r) => r.term === 'vpn').score, 69);
  assert.equal(top.find((r) => r.term === 'jt rides').score, 44);
  const t = v.termView('jt rides').countries.find((c) => c.country === 'US');
  assert.equal(t.last.score, 44);
  assert.equal(t.last.rare, true);
  assert.equal(t.history.at(-1).score, 44);
});

// Cifrele zilnice: [ratings, ratingsCur, stars, version, updated, price]
const stat = (ratings, version = '1.0', price = 0) => [ratings, 0, 4.5, version, '2026-01-01', price];

test('nicheView: sansa ta, banii din nisa (din rating-urile zilnice), se umple, Apple respinge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  for (let i = 0; i < 10; i++) {
    const date = addDays('2026-01-01', i);
    writeJsonGz(dayPath(dir, date, 'US'), { date, country: 'US', complete: true, requests: 1, errors: 0,
      suggest: [{ prefix: 'a', kind: 'base', terms: ['amazon'] }, { prefix: 'ca', kind: 'base', terms: i >= 8 ? ['cat cafe', 'cat wallpaper'] : [] }], charts: [] });
  }
  const niche = { n: 10, med: 50, stars: 3.9, fresh: 6, title: 1, weak: 8, fresh90: 4, stale: 2 };
  writeJsonGz(classifyPath(dir, '2026-01-09', 'US'), {
    'cat cafe': { category: 6014, topAppIds: [7, 8], classifiedAt: '2026-01-09', niche },
    'cat wallpaper': { category: 6014, topAppIds: [7], classifiedAt: '2026-01-09', niche },
  });
  writeJsonGz(statsPath(dir, '2026-01-08', 'US'), { 7: stat(100), 8: stat(10) });
  writeJsonGz(statsPath(dir, '2026-01-10', 'US'), { 7: stat(120), 8: stat(30) });
  const db = openDb();
  importAll(db, dir);
  const rows = makeViews(db).nicheView({ country: 'US', period: 14 }).rows;
  const cafe = rows.find((x) => x.term === 'cat cafe');
  assert.equal(cafe.chance, 67); // 0.4*0.8 + 0.2*0.4 + 0.15*0.2 + 0.1*1 + 0.15*0.9
  assert.equal(cafe.chanceApprox, false);
  assert.equal(cafe.flooding, true);
  assert.equal(cafe.marketApps, 2);
  assert.equal(cafe.market.downloadsDay, 1400); // (10 + 10 rating-uri/zi) x 70
  const wall = rows.find((x) => x.term === 'cat wallpaper');
  assert.equal(wall.sat.label, 'wallpaper');
  assert.ok(wall.opportunity <= Math.ceil(cafe.opportunity / 2) + 1, "categoria respinsa de Apple: jumatate");
});

test('breakoutView: app-urile care primesc brusc mult mai multe rating-uri decat de obicei', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  const date = '2026-03-01';
  writeJsonGz(dayPath(dir, date, 'US'), { date, country: 'US', complete: true, requests: 1, errors: 0, suggest: [],
    charts: [{ type: 'topfreeapplications', genreId: 6014, apps: [{ rank: 4, id: 1, name: 'Boom', genreId: 6014 }] }] });
  writeJsonGz(appsPath(dir, '2026-02-01', 'US'), {
    3: { name: 'Blip', genreId: 6014, releaseDate: '2025-03-01' },
    1: { name: 'Boom', genreId: 6014, releaseDate: '2025-03-01' }, // ~1 rating/zi de la lansare, acum 50/zi
    2: { name: 'Steady', genreId: 6014, releaseDate: '2025-03-01' }, // 100/zi mereu
  });
  writeJsonGz(statsPath(dir, '2026-02-26', 'US'), { 1: stat(365), 2: stat(36500), 3: stat(365) });
  writeJsonGz(statsPath(dir, '2026-02-27', 'US'), { 1: stat(415), 2: stat(36600), 3: stat(365) });
  writeJsonGz(statsPath(dir, '2026-03-01', 'US'), { 1: stat(515), 2: stat(36800), 3: stat(665) }); // 3: salt de o zi
  const db = openDb();
  importAll(db, dir);
  const r = makeViews(db).breakoutView({ country: 'US' });
  assert.equal(r.measured, 3);
  assert.deepEqual(r.rows.map((x) => x.name), ['Boom']);
  assert.equal(r.rows[0].recent, 50);
  assert.equal(r.rows[0].baselineKind, 'lifetime');
  assert.equal(r.rows[0].bestRank, 4);
  assert.equal(r.rows[0].estimate.downloadsDay, 3500);
});

test('changesView: nume nou, versiune cu noutati, pret; implicit doar cei care fac bani', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trl-'));
  for (const date of ['2026-03-01', '2026-03-02']) {
    writeJsonGz(dayPath(dir, date, 'US'), { date, country: 'US', complete: true, requests: 1, errors: 0, suggest: [],
      charts: [{ type: 'topgrossingapplications', genreId: 6014, apps: [{ rank: 2, id: 1, name: 'Money', genreId: 6014 }] }] });
  }
  writeJsonGz(appsPath(dir, '2026-03-01', 'US'), { 1: { name: 'Money', genreId: 6014 }, 2: { name: 'Free', genreId: 6014 } });
  writeJsonGz(statsPath(dir, '2026-03-01', 'US'), { 1: stat(10, '1.0', 0), 2: stat(10, '1.0', 0) });
  writeJsonGz(statsPath(dir, '2026-03-02', 'US'), { 1: stat(10, '1.1', 2.99), 2: stat(10, '2.0', 0) });
  writeJsonGz(changesPath(dir, '2026-03-02', 'US'), [
    { id: 1, field: 'name', from: 'Money', to: 'Money: AI Photo' },
    { id: 1, field: 'version', from: '1.0', to: '1.1', notes: 'Paywall nou' },
    { id: 2, field: 'version', from: '1.0', to: '2.0' },
  ]);
  const db = openDb();
  importAll(db, dir);
  const v = makeViews(db);
  const money = v.changesView({ country: 'US' }).rows;
  assert.deepEqual(money.map((r) => r.field).sort(), ['name', 'price', 'version']);
  assert.equal(money.find((r) => r.field === 'price').to, 2.99);
  assert.equal(money.find((r) => r.field === 'version').notes, 'Paywall nou');
  assert.equal(v.changesView({ country: 'US', who: 'all' }).rows.length, 4);
  const extra = v.appExtra(1);
  assert.equal(extra.changes.length, 2);
});
