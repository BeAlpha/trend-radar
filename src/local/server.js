// Server local (fara dependinte): API JSON + fisierele interfetei.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeViews } from './views.js';
import { importAll } from './db.js';
import { makeAppleClient, COUNTRIES } from '../apple/clients.js';
import { makeRetry } from '../apple/net.js';
import { genreName } from '../apple/genres.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const STALE_HOURS = 48;

const CSV_COLS = ['country', 'term', 'score', 'delta', 'then', 'categoryName', 'subgenreName', 'difficulty', 'confirmed', 'firstSeen'];
const csvCell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const toCsv = (rows) => [CSV_COLS.join(','), ...rows.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(','))].join('\n');

function readCloudStatus(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'status.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function createServer({ db, dataDir, refresh = async () => ({}), apple = makeAppleClient({ searchMs: 1500, retry: makeRetry({ retries: 1, baseDelayMs: 2000 }) }) }) {
  const views = makeViews(db);
  const appCache = new Map(); // `${cc}:${id}` -> app

  async function lookupApps(ids, cc) {
    const missing = ids.filter((id) => !appCache.has(`${cc}:${id}`));
    if (missing.length) {
      for (const a of await apple.lookup(missing, cc)) appCache.set(`${cc}:${a.id}`, a);
    }
    return ids.map((id) => appCache.get(`${cc}:${id}`)).filter(Boolean);
  }

  const routes = {
    '/api/status': () => {
      const cloud = readCloudStatus(dataDir);
      const ageHours = cloud?.finishedAt ? (Date.now() - Date.parse(cloud.finishedAt)) / 3.6e6 : null;
      return { cloud, stale: ageHours == null || ageHours > STALE_HOURS, ageHours, local: views.status() };
    },
    '/api/meta': () => ({ countries: COUNTRIES, categories: views.categories() }),
    '/api/view': (q) => views.view({ name: q.get('name'), country: q.get('country'), category: q.get('category'), period: q.get('period') }),
    '/api/themes': (q) => views.themeView({ country: q.get('country'), category: q.get('category') ?? 'all' }),
    '/api/term': (q) => views.termView(q.get('q') ?? ''),
    '/api/suggest': (q) => views.suggestTerms(q.get('q') ?? ''),
    '/api/apps': async (q) => {
      const ids = (q.get('ids') ?? '').split(',').map(Number).filter(Boolean).slice(0, 10);
      const cc = COUNTRIES.includes(q.get('country')) ? q.get('country') : 'US';
      return ids.length ? lookupApps(ids, cc) : [];
    },
    '/api/genre': (q) => ({ name: genreName(Number(q.get('id'))) }),
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/refresh' && req.method === 'POST') {
        const r = await refresh();
        views.invalidate();
        return sendJson(res, r);
      }
      if (url.pathname === '/api/csv') {
        const v = views.view({ name: url.searchParams.get('name'), country: url.searchParams.get('country'), category: url.searchParams.get('category'), period: url.searchParams.get('period') });
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="trend-radar-${url.searchParams.get('name')}.csv"` });
        return res.end(`﻿${toCsv(v.rows)}`);
      }
      const route = routes[url.pathname];
      if (route) return sendJson(res, await route(url.searchParams));
      return serveStatic(url.pathname, res);
    } catch (err) {
      console.error(err);
      sendJson(res, { error: err.message }, 500);
    }
  });
}

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(pathname, res) {
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

export { importAll };
