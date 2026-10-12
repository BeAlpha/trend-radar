# Trend Radar (ASO)

Arată ce cuvinte-cheie caută lumea în App Store (US, GB, DE, FR, IT, ES):
ce e **nou**, ce e **în creștere**, ce are **cel mai mult trafic**, pe categorii.

Scorurile sunt **estimări** din sugestiile App Store, nu volumul oficial Apple.
Specificația: `../02-specificatie-trend-radar.md`.

## Pornire pe Mac
```
cd ~/Desktop/Alpha/ASO/trend-radar
npm start
```
Descarcă datele noi din GitHub, le importă și deschide http://localhost:4800.

## Cum funcționează
- **Cloud (GitHub Actions, zilnic 04:00 UTC):** `.github/workflows/daily.yml` rulează câte un job pe țară
  (`src/collect/`) și salvează în `data/days/<data>/<ȚARĂ>.json.gz` + `data/classify/...`.
- **Mac:** `src/local/` importă în `local.db` (SQLite, nu intră în git) și servește interfața.
- **Calcule:** `src/metrics/` (funcții pure, testate).

## Comenzi
| Comandă | Ce face |
|---|---|
| `npm start` | interfața locală |
| `npm test` | testele |
| `node src/collect/cli.js --country US --smoke` | colectare de probă locală (puține cereri) |

Rulare manuală în cloud: GitHub → Actions → daily-collect → Run workflow (bifează „smoke” pentru probă).
