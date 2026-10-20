// Fisierele de date din depozit. Se ADAUGA zilnic, nu se rescriu (istoric git mic).
//   data/days/<date>/<CC>.json.gz      sugestii + topuri ale zilei
//   data/classify/<date>/<CC>.json.gz  cuvintele clasificate in acea zi
//   data/apps/<date>/<CC>.json.gz      app-urile din topuri vazute prima data in acea zi (data lansarii etc.)
//   data/stats/<date>/<CC>.json.gz     cifrele zilei pentru app-urile din topuri: rating-uri, versiune, pret
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isDate } from '../util/dates.js';

export const dayPath = (dataDir, date, cc) => path.join(dataDir, 'days', date, `${cc}.json.gz`);
export const classifyPath = (dataDir, date, cc) => path.join(dataDir, 'classify', date, `${cc}.json.gz`);
export const appsPath = (dataDir, date, cc) => path.join(dataDir, 'apps', date, `${cc}.json.gz`);
export const statsPath = (dataDir, date, cc) => path.join(dataDir, 'stats', date, `${cc}.json.gz`);

export function writeJsonGz(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, gzipSync(JSON.stringify(obj)));
  fs.renameSync(`${file}.tmp`, file);
}

export const readJsonGz = (file) => JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8'));

// { ok: true, value } | { ok: false, error: 'missing' | 'corrupt' }
export function readJsonGzSafe(file) {
  try {
    return { ok: true, value: readJsonGz(file) };
  } catch (err) {
    return { ok: false, error: err.code === 'ENOENT' ? 'missing' : 'corrupt' };
  }
}

export function listDates(dataDir, kind = 'days') {
  const dir = path.join(dataDir, kind);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(isDate).sort();
}

// Toate zilele unei tari (optional doar inainte de `before`). Fisierele stricate sunt sarite.
export function readCountryDays(dataDir, cc, { before = null } = {}) {
  const out = [];
  for (const date of listDates(dataDir, 'days')) {
    if (before && date >= before) continue;
    const r = readJsonGzSafe(dayPath(dataDir, date, cc));
    if (r.ok) out.push(r.value);
  }
  return out;
}

export function readCountryClassifications(dataDir, cc, { before = null } = {}) {
  const out = [];
  for (const date of listDates(dataDir, 'classify')) {
    if (before && date >= before) continue;
    const r = readJsonGzSafe(classifyPath(dataDir, date, cc));
    if (r.ok) out.push(r.value);
  }
  return out;
}

// Toate app-urile deja descrise pentru o tara (inainte de `before`): Map(id -> meta).
export function readCountryAppMeta(dataDir, cc, { before = null } = {}) {
  const out = new Map();
  for (const date of listDates(dataDir, 'apps')) {
    if (before && date >= before) continue;
    const r = readJsonGzSafe(appsPath(dataDir, date, cc));
    if (r.ok) for (const [id, m] of Object.entries(r.value)) out.set(Number(id), m);
  }
  return out;
}
