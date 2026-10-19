// Baza SQLite locala (local.db, ignorata de git) + importul incremental din data/.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { COUNTRIES } from '../apple/clients.js';
import { listDates, dayPath, classifyPath, readJsonGzSafe } from '../data/files.js';
import { bestObservations } from '../metrics/score.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS imported (kind TEXT, date TEXT, country TEXT, size INTEGER,
  PRIMARY KEY (kind, date, country));
CREATE TABLE IF NOT EXISTS days (country TEXT, date TEXT, complete INTEGER, requests INTEGER, errors INTEGER,
  PRIMARY KEY (country, date));
CREATE TABLE IF NOT EXISTS scores (country TEXT, date TEXT, term TEXT, score INTEGER, prefix TEXT, position INTEGER,
  PRIMARY KEY (country, date, term));
CREATE INDEX IF NOT EXISTS scores_term ON scores (term, country, date);
CREATE TABLE IF NOT EXISTS seen (country TEXT, term TEXT, first_seen TEXT, last_seen TEXT,
  PRIMARY KEY (country, term));
CREATE TABLE IF NOT EXISTS class (country TEXT, term TEXT, category INTEGER, subgenre INTEGER, difficulty INTEGER,
  top_app_ids TEXT, classified_at TEXT, PRIMARY KEY (country, term));
CREATE TABLE IF NOT EXISTS charts (country TEXT, date TEXT, type TEXT, genre_id INTEGER, rank INTEGER,
  app_id INTEGER, name TEXT, app_genre INTEGER);
CREATE INDEX IF NOT EXISTS charts_cd ON charts (country, date);
CREATE TABLE IF NOT EXISTS problems (path TEXT PRIMARY KEY, error TEXT);
CREATE TABLE IF NOT EXISTS queried (country TEXT, date TEXT, prefix TEXT, PRIMARY KEY (country, prefix, date));
`;
// 2 = tabela `queried` (inceputurile de extindere intrebate in fiecare zi).
// 3 = literele locale singure punctate ca 2 litere (scorurile se recalculeaza).
const SCHEMA_VERSION = 3;

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  // Baza mai veche: fisierele deja importate nu au completat tabelele noi -> reimportam tot.
  if (db.prepare('PRAGMA user_version').get().user_version < SCHEMA_VERSION) {
    db.exec(`DELETE FROM imported; PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  return db;
}

const tx = (db, fn) => {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
};

function importDay(db, day) {
  const { country: cc, date } = day;
  db.prepare('DELETE FROM scores WHERE country=? AND date=?').run(cc, date);
  db.prepare('DELETE FROM charts WHERE country=? AND date=?').run(cc, date);
  db.prepare('DELETE FROM queried WHERE country=? AND date=?').run(cc, date);
  const insQueried = db.prepare('INSERT OR IGNORE INTO queried VALUES (?,?,?)');
  for (const s of day.suggest ?? []) if (s.kind === 'expand') insQueried.run(cc, date, s.prefix);
  db.prepare('INSERT OR REPLACE INTO days VALUES (?,?,?,?,?)')
    .run(cc, date, day.complete ? 1 : 0, day.requests ?? 0, day.errors ?? 0);
  const insScore = db.prepare('INSERT INTO scores VALUES (?,?,?,?,?,?)');
  const upSeen = db.prepare(`INSERT INTO seen VALUES (?,?,?,?) ON CONFLICT (country, term) DO UPDATE SET
    first_seen = MIN(first_seen, excluded.first_seen), last_seen = MAX(last_seen, excluded.last_seen)`);
  for (const [term, o] of bestObservations(day.suggest ?? [])) {
    insScore.run(cc, date, term, o.score, o.prefix, o.position);
    upSeen.run(cc, term, date, date);
  }
  const insChart = db.prepare('INSERT INTO charts VALUES (?,?,?,?,?,?,?,?)');
  for (const c of day.charts ?? []) {
    for (const a of c.apps) insChart.run(cc, date, c.type, c.genreId, a.rank, a.id, a.name, a.genreId);
  }
}

function importClassify(db, cc, file) {
  const up = db.prepare('INSERT OR REPLACE INTO class VALUES (?,?,?,?,?,?,?)');
  for (const [term, c] of Object.entries(file)) {
    up.run(cc, term, c.category, c.subgenre ?? null, c.difficulty ?? null,
      JSON.stringify(c.topAppIds ?? []), c.classifiedAt);
  }
}

// Importa doar fisierele noi sau schimbate (dupa marime). Fisierele stricate ajung in `problems`.
export function importAll(db, dataDir) {
  const stats = { days: 0, classify: 0, problems: 0 };
  const done = db.prepare('SELECT size FROM imported WHERE kind=? AND date=? AND country=?');
  const mark = db.prepare('INSERT OR REPLACE INTO imported VALUES (?,?,?,?)');
  const problem = db.prepare('INSERT OR REPLACE INTO problems VALUES (?,?)');
  for (const kind of ['days', 'classify']) {
    for (const date of listDates(dataDir, kind)) {
      for (const cc of COUNTRIES) {
        const file = kind === 'days' ? dayPath(dataDir, date, cc) : classifyPath(dataDir, date, cc);
        if (!fs.existsSync(file)) continue;
        const size = fs.statSync(file).size;
        if (done.get(kind, date, cc)?.size === size) continue;
        const r = readJsonGzSafe(file);
        if (!r.ok) {
          problem.run(path.relative(dataDir, file), r.error);
          stats.problems++;
          continue;
        }
        tx(db, () => {
          if (kind === 'days') importDay(db, r.value); else importClassify(db, cc, r.value);
          mark.run(kind, date, cc, size);
        });
        stats[kind]++;
      }
    }
  }
  return stats;
}
