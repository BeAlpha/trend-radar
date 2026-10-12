// Ritm (throttle), reincercari si contorizare pentru apelurile catre Apple.

export const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, what) {
    super(`HTTP ${status} (${what})`);
    this.status = status;
  }
}

// Apelurile trec pe rand, cu minim intervalMs intre ele. O eroare NU blocheaza urmatoarele.
export function makeThrottle(intervalMs, { sleep = defaultSleep, now = Date.now } = {}) {
  let last = -Infinity;
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(async () => {
      const wait = intervalMs - (now() - last);
      if (wait > 0) await sleep(wait);
      last = now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };
}

const retryable = (err) => !(err instanceof HttpError) || err.status === 429 || err.status >= 500;

// La 429/5xx/eroare de retea: pauza 30s, 60s, 120s... (max 10 min), maxim `retries` reincercari.
export function makeRetry({ retries = 5, baseDelayMs = 30_000, maxDelayMs = 600_000, sleep = defaultSleep, log = () => {} } = {}) {
  return async (fn) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!retryable(err) || attempt >= retries) throw err;
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        log(`  reincerc in ${Math.round(delay / 1000)}s dupa: ${err.message}`);
        await sleep(delay);
      }
    }
  };
}

export function makeCounter() {
  const stats = { requests: 0, failures: 0 };
  return {
    stats,
    async track(fn) {
      stats.requests++;
      try {
        return await fn();
      } catch (err) {
        stats.failures++;
        throw err;
      }
    },
    failureRate: () => (stats.requests ? stats.failures / stats.requests : 0),
    // Daca Apple ne blocheaza serios, ne oprim in loc sa ardem ore intregi in reincercari.
    tooManyFailures: (min = 50, max = 0.1) => stats.requests >= min && stats.failures / stats.requests > max,
  };
}
