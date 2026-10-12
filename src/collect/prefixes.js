// Inceputurile de cuvant intrebate zilnic: a-z, aa-zz si literele locale.
const AZ = 'abcdefghijklmnopqrstuvwxyz'.split('');

export const LOCAL_LETTERS = {
  US: [], GB: [],
  DE: ['ä', 'ö', 'ü'],
  FR: ['é', 'è', 'à', 'ç'],
  IT: ['è', 'à', 'ò', 'ù'],
  ES: ['ñ', 'á', 'é', 'í', 'ó', 'ú'],
};

export function prefixesFor(country) {
  const out = [...AZ];
  for (const a of AZ) for (const b of AZ) out.push(a + b);
  return [...out, ...(LOCAL_LETTERS[country] ?? [])];
}
