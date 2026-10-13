import { lineChart } from './chart.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
};

// ---------- tooltip "?" ----------
const tipEl = $('#tip');
const tip = {
  show(html, x, y) {
    tipEl.innerHTML = html; tipEl.hidden = false;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = `${Math.min(x + 14, innerWidth - w - 8)}px`;
    tipEl.style.top = `${y + h + 20 > innerHeight ? y - h - 10 : y + 16}px`;
  },
  hide() { tipEl.hidden = true; },
};
document.addEventListener('mouseover', (e) => {
  const q = e.target.closest('[data-tip]');
  if (q) tip.show(esc(q.dataset.tip), e.clientX, e.clientY);
});
document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) tip.hide(); });
const q = (text) => `<span class="q" data-tip="${esc(text)}">?</span>`;

const HELP = {
  score: 'Scor estimat 0–100 din sugestiile App Store: 70–100 = apare după o singură literă, 40–69 = după 2 litere, 10–39 = doar după un cuvânt + spațiu. Mai sus în listă = scor mai mare. NU e volumul oficial Apple.',
  delta: 'Diferența dintre media scorului din ultimele 3 zile și media de acum 7 (sau 30) de zile. Zilele cu colectare incompletă nu se pun la socoteală.',
  then: 'Media scorului în fereastra de comparație (acum 7–9 zile, sau 30–32 zile).',
  category: 'Categoria majoritară a primelor 10 app-uri din căutarea pentru acest cuvânt (minim 4 din 10). „Mixt” = rezultate amestecate. „Neclasificat” = în coada de clasificare.',
  difficulty: 'Mediana numărului de rating-uri ale primelor 10 app-uri: ●○○ sub 1.000, ●●○ sub 50.000, ●●● peste.',
  confirmed: 'Confirmat = cuvântul a fost văzut din nou în cel puțin încă o zi din prima săptămână. Neconfirmat poate fi zgomot de o zi.',
  firstSeen: 'Prima zi în care cuvântul a apărut în sugestii în această țară, de când colectăm.',
  seenDays: 'În câte din cele 7 zile dinaintea ultimelor 3 a fost văzut.',
};

// ---------- stare ----------
const VIEWS = {
  new: { title: 'Nou', periods: [[1, 'Ultimele 24h'], [7, 'Ultimele 7 zile'], [30, 'Ultimele 30 zile']], def: 7 },
  rising: { title: 'În creștere', periods: [[7, 'față de acum 7 zile'], [30, 'față de acum 30 zile']], def: 7 },
  falling: { title: 'În scădere', periods: [[7, 'față de acum 7 zile'], [30, 'față de acum 30 zile']], def: 7 },
  top: { title: 'Top trafic', periods: null },
  gone: { title: 'Dispărute', periods: null },
  themes: { title: 'Teme topuri', periods: null },
  search: { title: 'Caută kw', periods: null },
  app: { title: 'Aplicație', periods: null },
};
const state = { view: 'new', country: 'US', category: 'all', period: 7, text: '', sort: null, rows: [], term: '', appId: null, appCountry: 'US', appKwAll: false };

const COLS = {
  country: { label: 'Țara' },
  term: { label: 'Cuvânt' },
  score: { label: 'Scor*', num: true, help: 'score' },
  then: { label: 'Atunci', num: true, help: 'then' },
  delta: { label: 'Δ', num: true, help: 'delta' },
  categoryName: { label: 'Categorie', help: 'category' },
  difficulty: { label: 'Dificultate', help: 'difficulty' },
  confirmed: { label: 'Stare', help: 'confirmed' },
  firstSeen: { label: 'Prima apariție', help: 'firstSeen' },
  seenDays: { label: 'Zile văzut', num: true, help: 'seenDays' },
  lastSeen: { label: 'Ultima dată' },
};
const VIEW_COLS = {
  new: ['term', 'score', 'categoryName', 'difficulty', 'confirmed', 'firstSeen'],
  rising: ['term', 'score', 'then', 'delta', 'categoryName', 'difficulty', 'firstSeen'],
  falling: ['term', 'score', 'then', 'delta', 'categoryName', 'difficulty'],
  top: ['term', 'score', 'categoryName', 'difficulty', 'firstSeen'],
  gone: ['term', 'score', 'seenDays', 'lastSeen', 'categoryName'],
};

const diffDots = (d) => (d == null ? '<span class="muted">–</span>' : `<span class="diff">${'●'.repeat(d)}${'○'.repeat(3 - d)}</span>`);
function cell(col, r) {
  const v = r[col];
  switch (col) {
    case 'term': return `<td class="term"><a data-term="${esc(r.term)}">${esc(r.term)}</a></td>`;
    case 'score': return `<td class="num">${v ?? '–'}<span class="scorebar"><i style="width:${Math.max(0, Math.min(100, v ?? 0))}%"></i></span></td>`;
    case 'delta': return `<td class="num ${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v}</td>`;
    case 'then': case 'seenDays': return `<td class="num">${v ?? '–'}</td>`;
    case 'categoryName': return `<td>${esc(v)}${r.subgenreName ? ` <span class="muted">· ${esc(r.subgenreName)}</span>` : ''}</td>`;
    case 'difficulty': return `<td>${diffDots(v)}</td>`;
    case 'confirmed': return `<td>${v ? '<span class="badge ok">confirmat</span>' : '<span class="badge new">nou</span>'}</td>`;
    default: return `<td>${esc(v ?? '–')}</td>`;
  }
}

// ---------- status ----------
async function loadStatus() {
  const s = await api('/api/status');
  const parts = [];
  if (!s.cloud) {
    parts.push('<span class="pill warn">Nicio colectare din cloud încă</span>');
  } else {
    const age = s.ageHours != null ? `acum ${s.ageHours < 1 ? '<1' : Math.round(s.ageHours)}h` : '';
    parts.push(`<span class="pill ${s.stale ? 'warn' : 'ok'}">Ultima colectare: ${esc(s.cloud.lastRun)} ${age}</span>`);
    if (s.stale) parts.push('<span class="pill warn">Mai veche de 48h: colectarea din cloud nu a mai rulat</span>');
    const missing = Object.entries(s.cloud.countries).filter(([, c]) => c.missing || !c.complete).map(([cc]) => cc);
    if (missing.length) parts.push(`<span class="pill bad">Incomplet azi: ${missing.join(', ')}</span>`);
  }
  for (const [cc, c] of Object.entries(s.local.countries)) {
    if (c.days && !c.warmup.done) parts.push(`<span class="pill">${cc}: se adună baza ${c.warmup.count}/7 zile</span>`);
  }
  if (s.local.problems.length) parts.push(`<span class="pill bad" data-tip="${esc(s.local.problems.map((p) => `${p.path}: ${p.error}`).join('; '))}">${s.local.problems.length} fișiere cu probleme</span>`);
  $('#status').innerHTML = parts.join('');
  state.status = s;
}

async function loadMeta() {
  const m = await api('/api/meta');
  $('#f-country').innerHTML = [...m.countries.map((c) => `<option>${c}</option>`), '<option value="ALL">Toate 6</option>'].join('');
  $('#f-country').value = state.country;
  $('#f-category').innerHTML = ['<option value="all">Toate</option>',
    ...m.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`),
    '<option value="none">Neclasificat</option>'].join('');
  $('#f-category').value = state.category;
}

// ---------- randare ----------
function setupFilters() {
  const v = VIEWS[state.view];
  const isTable = !!VIEW_COLS[state.view];
  $('#filters').style.display = ['search', 'app'].includes(state.view) ? 'none' : '';
  $('#f-period-wrap').style.display = v.periods ? '' : 'none';
  $('#f-text').style.display = isTable ? '' : 'none';
  $('#csv').style.display = isTable ? '' : 'none';
  if (v.periods) {
    $('#f-period').innerHTML = v.periods.map(([val, label]) => `<option value="${val}">${label}</option>`).join('');
    if (!v.periods.some(([val]) => val === state.period)) state.period = v.def;
    $('#f-period').value = state.period;
  }
  $('#csv').href = `/api/csv?${new URLSearchParams({ name: state.view, country: state.country, category: state.category, period: state.period })}`;
}

function notice(meta) {
  const notes = [];
  if (['new', 'gone'].includes(state.view)) {
    for (const [cc, m] of Object.entries(meta)) {
      if (!m.warmup.done) notes.push(`${cc}: se adună baza ${m.warmup.count}/7 zile. Până atunci nu putem spune ce e „nou” sau „dispărut”, la început totul ar părea nou.`);
    }
  }
  if (['rising', 'falling'].includes(state.view) && Object.values(meta).every((m) => !m.latest)) {
    notes.push('Încă nu sunt zile complete colectate.');
  }
  $('#notice').innerHTML = notes.map((n) => `<div class="notice">${esc(n)}</div>`).join('');
}

function renderTable() {
  let cols = VIEW_COLS[state.view];
  if (state.country === 'ALL') cols = ['country', ...cols];
  const t = state.text.trim().toLowerCase();
  let rows = t ? state.rows.filter((r) => r.term.includes(t)) : [...state.rows];
  if (state.sort) {
    const { col, dir } = state.sort;
    rows.sort((a, b) => {
      const x = a[col], y = b[col];
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }
  const head = cols.map((c) => {
    const def = COLS[c];
    const arrow = state.sort?.col === c ? `<span class="arrow">${state.sort.dir > 0 ? '▲' : '▼'}</span>` : '';
    return `<th class="${def.num ? 'num' : ''}" data-sort="${c}">${def.label}${def.help ? q(HELP[def.help]) : ''} ${arrow}</th>`;
  }).join('');
  const shown = rows.slice(0, 500);
  $('#content').innerHTML = rows.length
    ? `<p class="count">${rows.length} cuvinte${rows.length > shown.length ? ` · afișate primele ${shown.length} (exportă CSV pentru toate)` : ''}${state.total > state.rows.length ? ` · total ${state.total}` : ''}</p>
       <div class="card"><table><thead><tr>${head}</tr></thead>
       <tbody>${shown.map((r) => `<tr>${cols.map((c) => cell(c, r)).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<div class="card empty">Nimic de afișat pentru filtrele alese.</div>';
}

// Rezultatele listelor raman in memorie: la "Inapoi" lista apare instant, fara recalculare.
const viewCache = new Map();

async function renderView(scrollY = 0) {
  setupFilters();
  syncControls();
  $('#notice').innerHTML = '';
  if (state.view === 'search') { renderSearch(); return window.scrollTo(0, 0); }
  if (state.view === 'app') { await renderApp(); return window.scrollTo(0, scrollY); }
  if (state.view === 'themes') { await renderThemes(); return window.scrollTo(0, scrollY); }
  const params = new URLSearchParams({ name: state.view, country: state.country, category: state.category, period: state.period });
  const key = params.toString();
  if (!viewCache.has(key)) {
    $('#content').innerHTML = '<div class="empty">Se calculează…</div>';
    viewCache.set(key, await api(`/api/view?${params}`));
  }
  const r = viewCache.get(key);
  state.rows = r.rows; state.total = r.total;
  notice(r.meta);
  renderTable();
  window.scrollTo(0, scrollY);
}

// ---------- istoric (butonul Inapoi al browserului / gestul de pe trackpad) ----------
history.scrollRestoration = 'manual';
const snapshot = () => ({
  view: state.view, country: state.country, category: state.category, period: state.period,
  term: state.term, text: state.text, sort: state.sort, from: state.from ?? null,
  appId: state.appId, appCountry: state.appCountry, appKwAll: state.appKwAll,
});
// Pagina noua: memoram unde eram (inclusiv scroll-ul) in intrarea curenta, apoi adaugam una noua.
function navigate(changes) {
  history.replaceState({ ...snapshot(), scrollY: window.scrollY }, '');
  Object.assign(state, changes);
  history.pushState(snapshot(), '');
  renderView(0).catch(showError);
}
// Schimbare de filtre pe aceeasi pagina: nu adauga pas nou in istoric.
const remember = () => history.replaceState({ ...snapshot(), scrollY: window.scrollY }, '');
window.addEventListener('popstate', (e) => {
  if (!e.state) return;
  Object.assign(state, e.state);
  renderView(e.state.scrollY ?? 0).catch(showError);
});
function syncControls() {
  document.querySelectorAll('#nav a').forEach((x) => x.classList.toggle('active', x.dataset.view === state.view));
  $('#f-country').value = state.country;
  $('#f-category').value = state.category;
  $('#f-text').value = state.text;
}

async function renderThemes() {
  $('#content').innerHTML = '<div class="empty">Se calculează…</div>';
  const groups = await api(`/api/themes?${new URLSearchParams({ country: state.country, category: state.category })}`);
  if (!groups.length) { $('#content').innerHTML = '<div class="card empty">Încă nu sunt topuri colectate.</div>'; return; }
  const noHistory = groups.every((g) => g.historyDays === 0);
  $('#notice').innerHTML = noHistory
    ? '<div class="notice">Topurile au o singură zi colectată: „nou intrat” și „urcare” apar după ce avem cel puțin o zi anterioară (urcarea pe 7 zile cere o săptămână).</div>'
    : '';
  $('#content').innerHTML = `<div class="themes">${groups.map((g) => `
    <div class="card theme-card">
      <h3>${esc(g.genreName)} ${state.country === 'ALL' ? `<span class="muted">· ${g.country}</span>` : ''}</h3>
      <div class="sub">${g.movers.length} app-uri noi sau în urcare · ${g.date}</div>
      ${g.themes.slice(0, 8).map((t) => `
        <details class="theme"><summary><b>${esc(t.theme)}</b><span class="muted">${t.count} app-uri</span></summary>
          <ul>${t.apps.map((a) => `<li><a data-app="${a.id}" data-app-country="${g.country}" class="applink">${esc(a.name)}</a> <span class="muted">· #${a.rank} ${a.kind === 'new' ? 'nou intrat' : `↑${a.climb}`} · ${a.type === 'toppaidapplications' ? 'plătite' : 'gratuite'}</span></li>`).join('')}</ul>
        </details>`).join('') || '<div class="muted">Nicio temă comună (minim 2 app-uri).</div>'}
      ${g.movers.length ? `<div class="movers">Mișcări: ${g.movers.slice(0, 6).map((m) => esc(m.name)).join(' · ')}${g.movers.length > 6 ? ' …' : ''}</div>` : ''}
    </div>`).join('')}</div>`;
}

// ---------- Cauta kw ----------
function renderSearch() {
  const back = state.from ? `<button type="button" class="btn ghost back" id="back">← Înapoi la ${esc(VIEWS[state.from]?.title ?? 'listă')}</button>` : '';
  $('#content').innerHTML = `${back}
    <div class="search-box"><input id="kw" type="search" placeholder="Scrie un cuvânt-cheie, ex: ai photo" autocomplete="off" value="${esc(state.term)}"><div class="ac" id="ac" hidden></div></div>
    <div id="kw-result"></div>`;
  const input = $('#kw'), ac = $('#ac');
  $('#back')?.addEventListener('click', () => history.back());
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const v = input.value.trim();
      if (v.length < 2) { ac.hidden = true; return; }
      const list = await api(`/api/suggest?q=${encodeURIComponent(v)}`);
      ac.innerHTML = list.map((t) => `<div data-pick="${esc(t)}">${esc(t)}</div>`).join('');
      ac.hidden = !list.length;
    }, 150);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { ac.hidden = true; showTerm(input.value); } });
  ac.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pick]')?.dataset.pick;
    if (t) { input.value = t; ac.hidden = true; showTerm(t); }
  });
  if (state.term) showTerm(state.term); else input.focus();
}

async function showTerm(term) {
  term = term.trim().toLowerCase();
  if (!term) return;
  state.term = term;
  remember();
  const out = $('#kw-result');
  out.innerHTML = '<div class="empty">Se încarcă…</div>';
  const r = await api(`/api/term?q=${encodeURIComponent(term)}`);
  const seen = r.countries.filter((c) => c.firstSeen);
  const withApps = r.countries.find((c) => c.topAppIds.length);
  out.innerHTML = `
    <div class="grid2">
      <div class="card panel"><h3>Scor estimat în timp ${q(HELP.score)}</h3><div class="chart" id="kw-chart"></div></div>
      <div class="card panel"><h3>Primele app-uri ${withApps ? `<span class="muted">(${withApps.country})</span>` : ''}</h3><ul class="apps" id="kw-apps"><li class="muted">${withApps ? 'Se încarcă…' : 'Cuvântul nu e clasificat încă.'}</li></ul></div>
    </div>
    <div class="card" style="margin-top:14px"><table><thead><tr>
      <th>Țara</th><th class="num">Scor azi ${q(HELP.score)}</th><th>Apare la</th><th>Categorie ${q(HELP.category)}</th>
      <th>Dificultate ${q(HELP.difficulty)}</th><th>Prima apariție ${q(HELP.firstSeen)}</th><th>Ultima</th></tr></thead>
      <tbody>${r.countries.map((c) => `<tr>
        <td>${c.country}</td>
        <td class="num">${c.last && c.last.date === c.lastSeen ? c.last.score : '–'}</td>
        <td>${c.last ? `„${esc(c.last.prefix)}” → poziția ${c.last.position}` : '<span class="muted">nevăzut</span>'}</td>
        <td>${esc(c.category ?? '–')}${c.subgenre ? ` <span class="muted">· ${esc(c.subgenre)}</span>` : ''}</td>
        <td>${diffDots(c.difficulty)}</td>
        <td>${esc(c.firstSeen ?? '–')}</td><td>${esc(c.lastSeen ?? '–')}</td></tr>`).join('')}</tbody></table></div>
    ${seen.length ? '' : '<div class="notice info" style="margin-top:14px">Cuvântul nu a apărut în sugestiile colectate. Poate fi prea puțin căutat sau e mai lung decât ce prindem (2 litere + extindere).</div>'}`;
  lineChart($('#kw-chart'), r.countries.map((c) => ({ country: c.country, points: c.history })), tip);
  if (withApps) {
    try {
      const apps = await api(`/api/apps?ids=${withApps.topAppIds.join(',')}&country=${withApps.country}`);
      $('#kw-apps').innerHTML = apps.map((a, i) => `<li><span class="muted">${i + 1}</span><img src="${esc(a.icon)}" alt="" loading="lazy">
        <div><a data-app="${a.id}" data-app-country="${withApps.country}" class="applink">${esc(a.name)}</a> <a class="muted ext" href="${esc(a.url)}" target="_blank" rel="noopener" title="Deschide în App Store">↗</a>
        <div class="meta">${esc(a.seller)} · ${a.ratings.toLocaleString('ro-RO')} rating-uri${a.rating ? ` · ${a.rating.toFixed(1)}★` : ''}</div></div></li>`).join('');
    } catch (err) {
      $('#kw-apps').innerHTML = `<li class="muted">Nu am putut încărca app-urile: ${esc(err.message)}</li>`;
    }
  }
}

// ---------- Pagina aplicatiei ----------
const SOURCE = {
  title: ['titlu', 'Toate cuvintele sunt în titlu.'],
  subtitle: ['subtitlu', 'Toate cuvintele sunt în subtitlu.'],
  both: ['titlu + subtitlu', 'Cuvintele sunt împărțite între titlu și subtitlu.'],
  partial: ['parțial', 'Doar o parte din cuvinte sunt în titlu/subtitlu; restul vin probabil din câmpul ascuns de keywords.'],
  hidden: ['ascuns', 'Niciun cuvânt nu e în titlu sau subtitlu: aproape sigur e în câmpul ascuns de keywords (100 caractere) al aplicației.'],
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const fmtSize = (b) => (b ? `${(b / 1048576).toFixed(0)} MB` : '–');
const chars = (s, max) => `<span class="${(s ?? '').length > max ? 'down' : 'muted'}">${(s ?? '').length}/${max}</span>`;
const multiline = (s) => esc(s).replace(/\n/g, '<br>');

async function renderApp() {
  const backLabel = state.from ? `← Înapoi la ${esc(VIEWS[state.from]?.title ?? 'listă')}` : '← Înapoi';
  const back = `<button type="button" class="btn ghost back" id="back">${backLabel}</button>`;
  $('#content').innerHTML = `${back}<div class="empty">Se încarcă aplicația…</div>`;
  $('#back').addEventListener('click', () => history.back());
  const r = await api(`/api/app?id=${state.appId}&country=${state.appCountry}`);
  const d = r.detail;
  if (!d) {
    $('#content').innerHTML = `${back}<div class="card empty">Aplicația nu e disponibilă în ${esc(r.country)}. Încearcă altă țară: ${countryChips()}</div>`;
    return bindApp();
  }
  const kws = state.appKwAll ? r.keywords : r.keywords.filter((k) => k.country === r.country);
  const hiddenWords = [...new Set(r.keywords.filter((k) => k.country === r.country && k.source === 'hidden').flatMap((k) => k.term.split(' ')))];
  $('#content').innerHTML = `${back}
    <div class="card panel app-head">
      <img src="${esc(d.icon)}" alt="" class="app-icon">
      <div class="app-titles">
        <h2>${esc(d.name)} ${chars(d.name, 30)}</h2>
        <div class="app-sub">${d.subtitle ? `${esc(d.subtitle)} ${chars(d.subtitle, 30)}` : '<span class="muted">fără subtitlu (sau indisponibil)</span>'}</div>
        <div class="muted"><a href="${esc(d.sellerUrl)}" target="_blank" rel="noopener">${esc(d.seller)}</a> · ${esc(d.genres.join(', '))}</div>
        <div class="app-stats">
          <span><b>${d.rating ? d.rating.toFixed(1) : '–'}★</b> ${d.ratings.toLocaleString('ro-RO')} rating-uri</span>
          <span><b>${esc(d.price || '–')}</b></span>
          <span>v${esc(d.version)} · actualizat ${fmtDate(d.updated)}</span>
          <span>lansat ${fmtDate(d.released)}</span>
          <span>${fmtSize(d.sizeBytes)} · iOS ${esc(d.minOs)}+ · ${esc(d.ageRating)}</span>
        </div>
        <div class="app-country">Metadata din: ${countryChips()} <a class="muted" href="${esc(d.url)}" target="_blank" rel="noopener">App Store ↗</a></div>
      </div>
    </div>

    <div class="grid2" style="margin-top:14px">
      <div class="card">
        <div class="panel-head">
          <h3>Cuvinte pe care apare în top 10 ${q('Din datele noastre: pentru fiecare cuvânt clasificat am salvat primele 10 app-uri din căutare. Arată doar cuvintele din colecția noastră care au fost clasificate (se completează zilnic), nu toate cuvintele posibile.')}</h3>
          <label class="muted small"><input type="checkbox" id="kw-all" ${state.appKwAll ? 'checked' : ''}> toate țările</label>
        </div>
        ${kws.length ? `<table><thead><tr>${state.appKwAll ? '<th>Țara</th>' : ''}<th>Cuvânt</th><th class="num">Poziție</th>
          <th class="num">Scor* ${q(HELP.score)}</th><th>Sursă ${q('De unde vine cuvântul pentru această aplicație: titlu, subtitlu sau câmpul ascuns de keywords. Se calculează doar pentru țara metadatelor afișate.')}</th></tr></thead>
          <tbody>${kws.map((k) => `<tr>${state.appKwAll ? `<td>${k.country}</td>` : ''}
            <td class="term"><a data-term="${esc(k.term)}">${esc(k.term)}</a></td>
            <td class="num">#${k.position}</td>
            <td class="num">${k.score}<span class="scorebar"><i style="width:${k.score}%"></i></span></td>
            <td>${k.source ? `<span class="badge src-${k.source}" data-tip="${esc(SOURCE[k.source][1])}">${SOURCE[k.source][0]}</span>` : '<span class="muted">–</span>'}</td></tr>`).join('')}</tbody></table>`
          : `<div class="empty">Nu apare în top 10 la niciun cuvânt clasificat încă${state.appKwAll ? '' : ` în ${esc(r.country)}`}. Clasificarea se completează zilnic.</div>`}
        ${hiddenWords.length ? `<div class="panel hidden-kw"><b>Probabil în câmpul ascuns de keywords:</b> ${hiddenWords.map((w) => `<span class="badge">${esc(w)}</span>`).join(' ')}</div>` : ''}
      </div>
      <div class="card panel">
        <h3>Descriere</h3>
        <div class="desc">${multiline(d.description)}</div>
        ${d.releaseNotes ? `<h3 style="margin-top:14px">Noutăți (v${esc(d.version)})</h3><div class="desc short">${multiline(d.releaseNotes)}</div>` : ''}
        <div class="muted small" style="margin-top:12px">Limbi: ${esc(d.languages.join(', '))} · Bundle: ${esc(d.bundleId)}</div>
      </div>
    </div>
    ${d.screenshots.length ? `<div class="card panel" style="margin-top:14px"><h3>Screenshot-uri</h3><div class="shots">${d.screenshots.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div></div>` : ''}`;
  bindApp();
}

function countryChips() {
  return ['US', 'GB', 'DE', 'FR', 'IT', 'ES'].map((c) => `<button type="button" class="chip ${c === state.appCountry ? 'on' : ''}" data-cc="${c}">${c}</button>`).join('');
}

function bindApp() {
  $('#back')?.addEventListener('click', () => history.back());
  document.querySelectorAll('.chip[data-cc]').forEach((b) => b.addEventListener('click', () => {
    state.appCountry = b.dataset.cc; remember(); renderApp().catch(showError);
  }));
  $('#kw-all')?.addEventListener('change', (e) => { state.appKwAll = e.target.checked; remember(); renderApp().catch(showError); });
}

// ---------- evenimente ----------
$('#nav').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-view]');
  if (!a) return;
  navigate({ view: a.dataset.view, sort: null, text: '', from: null });
});
const onFilter = (fn) => (e) => { fn(e.target.value); remember(); renderView().then(remember).catch(showError); };
$('#f-country').addEventListener('change', onFilter((v) => { state.country = v; }));
$('#f-category').addEventListener('change', onFilter((v) => { state.category = v; }));
$('#f-period').addEventListener('change', onFilter((v) => { state.period = Number(v); }));
$('#f-text').addEventListener('input', (e) => { state.text = e.target.value; renderTable(); remember(); });
$('#content').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    const col = th.dataset.sort;
    state.sort = state.sort?.col === col ? { col, dir: -state.sort.dir } : { col, dir: COLS[col].num ? -1 : 1 };
    renderTable();
    return remember();
  }
  const t = e.target.closest('a[data-term]')?.dataset.term;
  if (t) return navigate({ term: t, view: 'search', from: state.view });
  const appEl = e.target.closest('a[data-app]');
  if (appEl) navigate({ view: 'app', appId: Number(appEl.dataset.app), appCountry: appEl.dataset.appCountry, appKwAll: false, from: state.view });
});
$('#refresh').addEventListener('click', async (e) => {
  const b = e.target; b.disabled = true; b.textContent = 'Se descarcă…';
  try {
    const r = await api('/api/refresh', { method: 'POST' });
    if (r.warning) $('#notice').innerHTML = `<div class="notice">${esc(r.warning)}</div>`;
    viewCache.clear();
    await loadMeta(); await loadStatus(); await renderView(window.scrollY);
  } catch (err) { showError(err); } finally { b.disabled = false; b.textContent = 'Descarcă date noi'; }
});

function showError(err) {
  $('#content').innerHTML = `<div class="notice">Eroare: ${esc(err.message)}</div>`;
}

(async () => {
  await Promise.all([loadMeta(), loadStatus()]);
  history.replaceState(snapshot(), '');
  await renderView();
})().catch(showError);
