# Lantern Row build checklist

## Tier 1 · Local campaign · Partial

- [ ] Workspaces, protocol schemas, local backend, and provider seams. The workspaces and First Light protocol are in place.
- [ ] Ledger, prices, haggling, relationships, and merchant and rival policies. The local ledger, scarcity prices, and haggling are playable.
- [ ] Recipes, funded orders, wishes, events, and dock jobs. First Light has the paper lantern recipe, funded orders, and six preset wishes.
- [ ] Closure, offerings, votes, and dividends. Cash bands and shutters are drawn from the ledger.
- [ ] Side-view Row, economy lighting, boat lights, and action feedback. The first night has camera movement, reflected stall and boat lights, and action sounds.
- [ ] Three campaign nights, tutorial, profiles, saves, and ending. First Light has a contextual guide, one automatic save, and results with replay.
- [ ] Tier 1 screens and keyboard navigation. The title, HUD, trade, workshop, board, cart, pause, settings, and results screens are available.
- [ ] Rules and invariants, golden cases, campaign bot, and simulator CLI. The current rules suite exercises the First Light trade and delivery loop.
- [ ] README, running, architecture, and API docs. The milestone has run instructions and an architecture overview.

## Tier 2 · Living market · Not started

- [ ] Dev server and providers, live and private rooms, and Watch mode
- [ ] Chronicle and history, buybacks and share board, in-game simulator
- [ ] Soak and balance report, full audio, and Playwright end-to-end suite

## Tier 3 · Extra polish · Not started

- [ ] Endless mode, Cart II, extra dialogue and wishes, and performance polish

## First Light verification

- `npm ci` installed 69 packages on Node.js 24.14.0.
- `npm test` passed 14 tests covering scarcity thresholds, sequential batch pricing, round-trip losses, ledger conservation, cargo, quote expiry, funded orders, crowd sales, and haggling.
- `npm run dev` started with no environment setup and served the game page with HTTP 200.
- `npm run build` passed type-checking and produced a 1.77 MB static build. Vite reported a bundle-size warning and removed two unrecognized annotation comments in Zod.
- Chrome and Firefox smoke tests at 1280×720 against the production build passed crafting, wish attachment, delivery and boat lighting, crowd sale, haggling, bulk purchase, save and reload, results, and replay. Both browsers passed launch and layout checks at 1920×1080.
- Chrome and Firefox passed the canvas click, pause and resume timer, and reduced-motion preference checks.

See [milestone decisions](DECISIONS.md) for the first-night schedule and save behavior.
