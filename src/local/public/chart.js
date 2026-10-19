// Grafic linie (SVG simplu): scorul unui cuvant in timp, o linie pe tara.
// Culorile urmeaza tara (ordine fixa), validate pentru fundal inchis si daltonism.
export const COUNTRY_COLORS = {
  US: '#3987e5', GB: '#d95926', DE: '#199e70', FR: '#c98500', IT: '#d55181', ES: '#008300',
};

const W = 640, H = 260, M = { t: 12, r: 16, b: 26, l: 34 };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// series: [{ country, points: [{date, score}] }]
// opts.rank: valorile sunt locuri in top (1 = sus), axa e intoarsa; zilele lipsa = in afara topului.
export function lineChart(el, series, tip, opts = {}) {
  const rank = !!opts.rank;
  const withData = series.filter((s) => s.points.some((p) => p.score > 0));
  if (!withData.length) {
    el.innerHTML = `<div class="empty">${esc(opts.empty ?? 'Cuvântul n-a apărut încă în sugestii în zilele colectate.')}</div>`;
    return;
  }
  const dates = [...new Set(withData.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const x = (d) => M.l + (dates.length === 1 ? (W - M.l - M.r) / 2 : (dates.indexOf(d) / (dates.length - 1)) * (W - M.l - M.r));
  const y = rank
    ? (v) => M.t + ((v - 1) / 99) * (H - M.t - M.b)
    : (v) => M.t + (1 - v / 100) * (H - M.t - M.b);
  const fmt = (v) => (rank ? `#${v}` : v);

  const grid = (rank ? [1, 25, 50, 75, 100] : [0, 25, 50, 75, 100]).map((v) =>
    `<g class="grid"><line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}"/></g>
     <g class="axis"><text x="${M.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text></g>`).join('');
  const ticks = [dates[0], dates[Math.floor((dates.length - 1) / 2)], dates.at(-1)]
    .filter((d, i, a) => a.indexOf(d) === i)
    .map((d) => `<g class="axis"><text x="${x(d)}" y="${H - 6}" text-anchor="middle">${d.slice(5)}</text></g>`).join('');

  const lines = withData.map((s) => {
    const byDate = new Map(s.points.map((p) => [p.date, p.score]));
    const c = COUNTRY_COLORS[s.country];
    // Linia se rupe in zilele fara valoare (ex. app iesit din top).
    const segs = [[]];
    for (const d of dates) {
      if (byDate.has(d)) segs.at(-1).push([x(d), y(byDate.get(d))]);
      else if (segs.at(-1).length) segs.push([]);
    }
    return segs.filter((g) => g.length).map((g) => (g.length === 1
      ? `<circle cx="${g[0][0]}" cy="${g[0][1]}" r="4" fill="${c}"/>`
      : `<polyline points="${g.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)).join('');
  }).join('');

  el.innerHTML = `
    <div class="legend">${withData.map((s) => `<span><i style="background:${COUNTRY_COLORS[s.country]}"></i>${s.country}</span>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${rank ? 'Locul în top în timp, pe țări' : 'Scorul estimat în timp, pe țări'}">
      ${grid}${ticks}${lines}
      <line class="cross" x1="0" x2="0" y1="${M.t}" y2="${H - M.b}" stroke="#8f8e86" stroke-dasharray="3 3" visibility="hidden"/>
      <rect x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}" fill="transparent"/>
    </svg>`;

  const svg = el.querySelector('svg');
  const cross = svg.querySelector('.cross');
  svg.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = dates[0];
    for (const d of dates) if (Math.abs(x(d) - px) < Math.abs(x(best) - px)) best = d;
    cross.setAttribute('x1', x(best)); cross.setAttribute('x2', x(best));
    cross.setAttribute('visibility', 'visible');
    const rows = withData.map((s) => {
      const p = s.points.find((q) => q.date === best);
      return `<div><span style="color:${COUNTRY_COLORS[s.country]}">■</span> ${s.country}: <b>${p ? fmt(p.score) : rank ? 'în afara topului' : '–'}</b></div>`;
    }).join('');
    tip.show(`<b>${esc(best)}</b>${rows}`, ev.clientX, ev.clientY);
  });
  svg.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hide(); });
}
