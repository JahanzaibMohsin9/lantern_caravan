# Running Lantern Caravan

Install Node.js 24, then run `npm ci` from the repository root. Use the URL printed by Vite.

| Command | Use |
| --- | --- |
| `npm run dev` | Local campaign, Endless, and simulator with no account or environment setup |
| `npm run dev:server` | Dev API on port 4318 and Vite client with a live title background |
| `npm run build` | Type-check source, tools, and tests, then build `apps/web/dist` |
| `npm test` | Rules, golden cases, campaign bot, server settlement, and accelerated live loop |
| `$env:LANTERN_CHROME_CHANNEL = "chrome"` | PowerShell: select installed system Chrome; no browser download |
| `npm run test:e2e -- --project=chrome` | Build and drive the game in system Chrome |
| `npm run test:e2e -- --project=firefox` | Optional Firefox check when already installed |
| `npm run simulate -- --nights 2000 --seed 42 --traders 3 --check` | Headless balance check, with JSON and CSV in `sim-output/` |
| `npm run schema` | Regenerate the shared JSON Schema bundle |

The Playwright config builds the client and starts its own preview on port 4499 and test API on port 4418. It never reuses a running server, so a preview from another checkout cannot be tested by mistake; if either port is busy, the run stops with an error. Override the ports with `LANTERN_E2E_WEB_PORT` and `LANTERN_E2E_API_PORT`. Set `LANTERN_CHROME_CHANNEL=chrome` to use an installed Chrome instead of bundled Chromium. Set `LANTERN_RECORD=1` to keep playthrough recordings. The dev client exposes `window.__lantern` and a `?debug=1` overlay with phase, FPS, seed, revision, and time controls.

## Static client and dev server

Browser tests build into `apps/web/dist-e2e`, separate from the ordinary `dist` output. This keeps a concurrent production build from overwriting the test API URL.

Serve `apps/web/dist` over HTTP on localhost or over HTTPS. Set `VITE_SERVER_URL` at build time to point the static client at the API. Set `VITE_BACKEND=server` for the live title background and `VITE_AUTH=dev` for the reference sign-in. The local campaign remains available in both builds.

The API binds to `127.0.0.1:4318` by default. Run `npm run dev -w @lantern/server` for the API alone. `PORT`, `HOST`, and `LANTERN_DATA_DIR` configure it. For a different API port, set `VITE_SERVER_URL` to the same origin when running or building the web client. Keep the data directory on a persistent disk and run one authoritative server process for it. For a remote shared setup, terminate HTTPS in front of the API and client.

Use environment variables in the shell or pass Node an environment file. The checked-in `.env.example` lists dev provider options. The displayed name login is for a trusted development environment.

## Save files

Three local slots use IndexedDB for the current browser and origin. The game keeps a previous valid copy. Settings can export and import JSON. Keep a backup before switching browser origins or clearing site storage.

Server rooms live under `apps/server/data/` by default. Preserve the dev signing key and settlement files with the room files when moving that directory. The server persists reservations before handing them to the settlement provider.

## NEAR testnet settlement

The live server can settle the public Row to the NEP-245 items contract (`contracts/items/`, deployed at `items.lantern-caravan.testnet`). Private rooms always keep the dev ledger.

```bash
SETTLEMENT=near npm run dev:server
```

On start the server registers the merchant, rival and village accounts as agents (once), then reconciles: it reads every holder's balances from the contract and settles whatever differs from the game's ledger. On an empty contract that is the market's genesis. `GET /v1/chain/status` shows the contract, the queue, the last settled transaction and any error. Settings and their defaults are in `.env.example` (the RPC defaults to FastNEAR, since `rpc.testnet.near.org` is deprecated and rate-limited); the operator key comes from `NEAR_OPERATOR_KEY` (for hosting) or the operator's legacy-keychain file.

`npm run near:verify -- --data <data folder>` is a read-only check that every on-chain balance matches the room's ledger, at any point in the night.

`npm run near:smoke` runs the whole flow against the real testnet contract in a throwaway data folder: agents, genesis, a player purchase, a full balance check, then a clean-up reconcile that leaves the contract empty (`-- --keep` skips the clean-up).
