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

Campaign tutorial and schedule changes belong to M4. The Watch river strip and public river history belong to M5. Floodtide scheduling and server replay validation belong to M6.

## River Run review fixes

1. **Free trading upriver.** Casting off reserves every village good for the barge, up to a full hold each (half a village's stock in shared rooms), so players decide what to buy at the village instead of at The Landing. The Landing shows a live upriver price board and the best spot hauls.
2. **Relief hauls relight dark stalls.** A stall that runs out of cash, or sells out without the cash to pay a hauler, gets a harbor relief contract from the dock fund, priced at the village's cost plus a premium. Delivering it relights the stall with a restart float and refunds any open rescue offering. On The Dark Wharf, the Oil Wharf can now be relit by hauling oil from Ember Falls as well as by pledging shares. Rivals can fill relief contracts in endless and shared rooms.
3. **Runs during the night and in shared rooms.** The barge can leave during the open night while 45 seconds remain, so contracts posted mid-night are reachable. Late runs are shortened to end before closing. Local nights pause while the barge is out and advance by the trip; shared rooms keep trading and time runs on the wall clock.
4. **Opening-night harvest.** Villages bring in a second harvest after stocking the Row on the first night, so the first evening has goods upriver.
5. **A richer River Run.** Tiled, higher-resolution terrain with irregular banks, shallows, reeds, lily pads, forests, fields and a landmark at each village; animated water, light reflections, fireflies and lamp posts that relight as reaches are cleared; detailed barges with deck cargo, a bow-lantern beam, turret and wakes; pirate skiffs and new armored gunboats; floating fuel, shot and repair barrels; explosions, splashes, muzzle flashes, damage and bounty numbers, screen shake, hit vignette, event banners, edge indicators, a richer minimap, a run summary, touch controls, synthesized combat and engine audio, and Floodtide rain and lightning.
6. **Browser tests can't hit a stale server.** Playwright builds the client and serves it on its own ports (4499 and 4418) and never reuses a running server.

Verification for these fixes: `npm test` passed 85 tests, including new tests for relief hauls before and during the night, open-night and late runs, shared-room runs, gunboats, floating supplies and run time limits. The four Chrome Playwright tests passed with an installed Chrome (`LANTERN_CHROME_CHANNEL=chrome`), including the Night 2 relief haul that relights the Oil Wharf. Firefox was not re-run for this pass. The five-seed 2,000-night check passed with a longest dark streak of one night.

## Verification

- A clean `npm ci` restored the Node.js 24 workspace. The production build type-checked the client, server, tools, and tests. The production JavaScript bundle is about 1.72 MB before compression.
- `npm test` passed 77 tests covering local rules, the full campaign, 36 golden cases, the development providers, server races and restart recovery, and the 500-night live loop.
- Eight production-build Playwright tests passed. Chrome and Firefox each played the campaign, ran the two-context order race, visited Watch and History, and hauled oil from Ember Falls to sell at Paper Mill. The haul and sale also passed in both browsers with network access disabled after loading the app.
- The River Run CLI ran 2,000 nights each for seeds 17, 42, 93, 166, and 271. All five checked runs exited successfully with zero invariant errors. See [Balance report](BALANCE_REPORT.md).
- The campaign recording shows the Oil Wharf shuttered, the pledge reopening it, and the boats lighting. The README includes three captured game screens and a short GIF.

## Provider integration

[API](API.md) has separate steps and file paths for replacing IdentityProvider, SettlementProvider, StateStore, and AuthClient. The reference selects local development providers. [Running](RUNNING.md) describes static hosting, the API URL, and local and server save locations.
