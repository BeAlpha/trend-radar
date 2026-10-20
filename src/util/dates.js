// Date ca string-uri 'YYYY-MM-DD' in UTC (se compara corect si lexicografic).

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayUTC(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const diffDays = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
