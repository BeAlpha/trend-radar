// ID-urile de gen App Store (stabile, independente de limba).
export const GENRES = {
  6000: 'Business', 6001: 'Weather', 6002: 'Utilities', 6003: 'Travel', 6004: 'Sports',
  6005: 'Social Networking', 6006: 'Reference', 6007: 'Productivity', 6008: 'Photo & Video',
  6009: 'News', 6010: 'Navigation', 6011: 'Music', 6012: 'Lifestyle', 6013: 'Health & Fitness',
  6014: 'Games', 6015: 'Finance', 6016: 'Entertainment', 6017: 'Education', 6018: 'Books',
  6020: 'Medical', 6023: 'Food & Drink', 6024: 'Shopping', 6026: 'Developer Tools',
  6027: 'Graphics & Design',
};

export const GAME_SUBGENRES = {
  7001: 'Action', 7002: 'Adventure', 7003: 'Casual', 7004: 'Board', 7005: 'Card', 7006: 'Casino',
  7009: 'Family', 7011: 'Music', 7012: 'Puzzle', 7013: 'Racing', 7014: 'Role Playing',
  7015: 'Simulation', 7016: 'Sports', 7017: 'Strategy', 7018: 'Trivia', 7019: 'Word',
};

export const MIXED = 0;
export const CHART_GENRES = Object.keys(GENRES).map(Number);

export function genreName(id) {
  if (id === MIXED || id == null) return 'Mixt';
  return GENRES[id] ?? GAME_SUBGENRES[id] ?? `Gen ${id}`;
}
