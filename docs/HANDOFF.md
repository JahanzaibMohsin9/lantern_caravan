# Lantern Row handoff

## Tier 1 · Local campaign

The three nights are playable through the ending. The Row has a keyboard and mouse interface, state-driven stall lighting, six boat positions, wishes, a compact action guide, and audio cues. The campaign includes scarcity prices, trade and haggling, merchant memory, crafting and orders, NPC traders, dock jobs, rescue and expansion offerings, strategy votes, dividends, cart upgrades, and three IndexedDB slots with backup, export, and import.

The Zod protocol and development provider interfaces are checked in. There are 36 deterministic golden files and a bot playthrough through the local backend. The live tests separately cover contention, retry, a restart during delayed settlement, and unknown-to-confirmed or unknown-to-rejected settlement.

## Tier 2 · Living market

The reference server runs The Row continuously, supports four human seats per room, and keeps private rooms and public Watch available. The chronicle, price and balance history, share board, buybacks, simulator, layered music, and browser tests are implemented. A player bot trades for 20 nights in the accelerated server test, and the loop completes 500 nights without a real-time wait.

## Tier 3 · Extra polish

Endless unlocks after the campaign, carries the wallet and shares forward, and alternates festival and freight schedules. The later cart upgrade and forty preset wishes are available. Settings include independent volume controls, larger panels, low graphics, and reduced motion.

[Known issues](KNOWN_ISSUES.md) records differences from the reference brief, including the separate offline campaign and the development server's reservation queue.

## River Run milestones 1–3

1. **Simulation.** The TypeScript port runs at 60 Hz with seeded hazards, Caravan Zero's handling and combat, manifest-based trading, escorts, and input-log replay. Vitest covers handling, pricing, recovery, booms, flares, lock gates, escorts, and replay equality.
2. **Offline run.** The Landing opens in preparation from Night 2. Reserve stock, cast off, trade at a village, and moor to settle cargo through the same quote and receipt flow as the Row. The market clock stays at preparation. Reloading mid-run returns the reservation and closes the run.
3. **Economy.** Village harvests supply the Row. Freight and rivals move real cargo, shared reach danger affects losses, and the Harbor Bell escrows supply and escort rewards. The campaign keeps its existing three-night schedule and authored opening stock. The 2,000-night checks for all five seeds are recorded in the [balance report](BALANCE_REPORT.md).

Campaign tutorial and schedule changes belong to M4. Multiplayer River Runs and public river history belong to M5. Floodtide scheduling, touch controls, the audio pass, and server replay validation belong to M6.

## Verification

- A clean `npm ci` restored the Node.js 24 workspace. The production build type-checked the client, server, tools, and tests. The production JavaScript bundle is about 1.72 MB before compression.
- `npm test` passed 77 tests covering local rules, the full campaign, 36 golden cases, the development providers, server races and restart recovery, and the 500-night live loop.
- Eight production-build Playwright tests passed. Chrome and Firefox each played the campaign, ran the two-context order race, visited Watch and History, and hauled oil from Ember Falls to sell at Paper Mill. The haul and sale also passed in both browsers with network access disabled after loading the app.
- The River Run CLI ran 2,000 nights each for seeds 17, 42, 93, 166, and 271. All five checked runs exited successfully with zero invariant errors. See [Balance report](BALANCE_REPORT.md).
- The campaign recording shows the Oil Wharf shuttered, the pledge reopening it, and the boats lighting. The README includes three captured game screens and a short GIF.

## Provider integration

[API](API.md) has separate steps and file paths for replacing IdentityProvider, SettlementProvider, StateStore, and AuthClient. The reference selects local development providers. [Running](RUNNING.md) describes static hosting, the API URL, and local and server save locations.
