# Lantern Caravan handoff

## Work packages · 5 November 2026

### Scope and §16.4 hand-back

W0–W2 were delivered by the first implementer; W3 onward continue in order from this point. Each package below records its own checks.

| Package | Status |
| --- | --- |
| W0 · rename | Committed as `3196430` |
| W1 · trims | Committed as `0de05b9` |
| W2 · skiffs | Committed as `9a0c327` |
| W3 · wrecks/stops | Committed in the `W3:` commit; checks below |
| W4 · almanac | Not started |
| W5 · player Bell orders | Not started |
| W6 · four-night campaign | Not started |
| W7 · barge looks/cosmetics | Not started |
| W8 · Watch/history/trust | Not started |
| W9 · Floodtide/server replay | Not started |

- [x] Each delivered package has its own W-prefixed commit and a passing build, Vitest, system-Chrome Playwright and five-seed 2,000-night check.
- [x] Verification and cuts are recorded here; API and balance changes are documented.
- [ ] Human new-player test without docs in under three minutes: not performed.
- [ ] Full manual playthrough: not performed. Firefox and physical touch devices: not verified.

Branch remains `river-run`; no push, remote changes, rebase or history rewrite.

### W3 · Wrecks and riverside stops

Lost hauls no longer burn on the spot. `sinkHaul` moves the cargo of a lost freight, rival or village-boat haul into `esc:wreck:<id>` at the reach where it sank, including Night 2's scripted storm loss (6 oil at Heron Reach). A wreck opens at the next dusk, stays two nights, then breaks up and burns what is left with `sink: "sys:river"`. Placement comes from the river serial rather than the random stream, so every other roll is unchanged: freight-loss counts in the soak match the W2 figures exactly. `start_run` claims open wrecks into the manifest; `finish_run` validates `salvaged` entries against the claim and the wreck's balance (`RIVER_SALVAGE`) and balances cargo per item as purchases plus salvage against buybacks, deliveries, losses, flares and stop costs. On danger 3+ reaches the first crew spawns beside the wreck. In the run, **E** loads a wreck up to the free hold; the rest stays for the next barge.

Two or three riverside stops per run come from `stopPlan(seed)` on their own seeded stream: a stranded fisher (give 1 cord for +25 hull and a 6-coin bounty, or +30 ammo), a lock keeper's shed (+18 fuel or +30 ammo) and an overturned punt (+25 hull, or +20 fuel and +15 ammo). One choice each; the server re-derives the plan from the seed (`RIVER_STOP`). The mended net moves the cord to Millbrook and the coins come from `sys:bounty`, capped like all bounties. Wrecks and stops are drawn on the river with labels, edge arrows and minimap pins, the Landing lists wrecks with nights left, and the run summary counts salvage and stops.

Checks run for this package:

- `npm run schema` — passed; regenerated schema committed.
- `npm run build` — passed (existing bundle-size warning).
- `npm test` — passed, 125 tests in 7 files (9 new: wreck sinking, opening, salvage, forged salvage, partial salvage across a save, break-up, stop settlement, forged stops, and three river-sim cases).
- `LANTERN_CHROME_CHANNEL=chrome npm run test:e2e -- --project=chrome` — passed, 6 tests. The new path imports a Night 3 save built by the game code (`tests/e2e/fixtures/night3-save.ts`) through Settings → Import save, finds the storm wreck in the Landing list, sails to it, salvages 6 oil with E, moors, and checks the wreck is gone and the journal records it.
- `npm run simulate -- --nights 2000 --seed <17|42|93|166|271> --check` — all five passed: longest dark streak 1, zero invariant errors, zero invalid goods ops.

Stops are covered by unit and sim tests and were seen on the river map, but no browser test drives the barge to one: their positions come from the run seed and sit off the straight route.

Review fixes in this package: the save codec now keeps `relief` on contracts and `startedAt` on runs (both were silently dropped on reload before), and village buybacks of goods that were salvaged rather than bought now pay the actor.

### W2 · Skiffs and pirate roles

Added gold 40-HP ram skiffs, coral 57-HP raiders and purple 96-HP long-range twin-shot gunboats, with distinct silhouettes and targeted name labels. The manifest danger determines the spawn mix; replay tests cover dangers 0–5 and existing trim/combat/trade runs. Skiff spills move one held good into a recoverable drop, respect hold capacity and enter reported losses on expiry or early mooring. Role bounties transfer 6/8/14 coins from `sys:bounty`, capped by available and manifested funds; forged role totals/mixes are rejected. Legacy reports retain 3-coin payouts. Both backends inherit the same quote/submit/status validation; offline browser combat settles through LocalBackend. No browser live-combat payout or physical-touch verification is claimed.

- `npm run schema` — passed; generated schema committed.
- `npm run build` — passed twice, including final production code (existing bundle/annotation warnings).
- `npm test` — passed at each stage: 115 twice, then 116 twice after early-mooring coverage and the depleted-fund assertion; final result 116 tests in 7 files.
- `$env:LANTERN_CHROME_CHANNEL='chrome'; npm run test:e2e -- --project=chrome` — passed twice, 5 tests each; final run after the spill fix. The real-control offline river path now asserts a skiff kill before mooring, delivering and selling oil. Existing campaign, trim, live contention and Watch tests pass.
- `npm run simulate -- --nights 2000 --seed 17 --check` — passed twice, final dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 42 --check` — passed twice, final dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 93 --check` — passed twice, final dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 166 --check` — passed twice, final dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 271 --check` — passed twice, final dark streak 1, zero invariant errors.

No W2 check failed. Review found and fixed the early-mooring spill omission before completion, with a regression test. Firefox, real-device touch and human usability remain unverified. Updated numbers and their rationale are in `BALANCE_REPORT.md`.

### W1 · Barge trims

Added Balanced, Runner, Ironclad and Gunner with A2's multipliers, applied to movement/turning, shot damage/cadence, fuel and incoming bullet/collision/Floodtide damage. The Landing selector fits for free on `start_run`; manifests and saves retain the choice, old saves default to Balanced, and campaign refits unlock on Night 3. HUD title, barge tint and cruising estimates reflect the trim. Shared game-core/codec behavior is exercised through both existing backends, including local reload and live restart. Every trim has replay and goods-conservation coverage.

- `npm run schema` — passed; generated schema committed.
- `npm run build` — passed (existing bundle/annotation warnings).
- `npm test` — initial run: 98 passed, 1 failed because a Runner collected a seeded fuel barrel during the consumption measurement. Isolated that measurement from pickups; final run: 101 tests passed in 7 files.
- `$env:LANTERN_CHROME_CHANNEL='chrome'; npm run test:e2e -- --project=chrome` — 5 passed, including real-control refits through all four trims in a live room, Night 2's locked selector, offline relief haul, full campaign and live race.
- `npm run simulate -- --nights 2000 --seed 17 --check` — passed, dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 42 --check` — passed, dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 93 --check` — passed, dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 166 --check` — passed, dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 271 --check` — passed, dark streak 1, zero invariant errors.

Firefox, real-device touch and human usability were not verified. No balance tuning beyond the specified trim multipliers.

### W0 · Lantern Caravan naming

Renamed the title screen, header, browser title, meta description, README and documentation. Lantern Row remains the market name; the planned Night 4 six-boat Floodtide procession is the Lantern Caravan. Package names, repository and save identifiers are unchanged. Added a run-reservation/return goods-conservation test and title assertions to the real-control offline river path. Tightened the simulator's dark-streak failure threshold from five to one; no economy tuning.

Commands run in this session:

- `npm run schema` — passed; no schema changes.
- `npm run build` — passed twice; existing Vite bundle-size and Zod annotation warnings.
- `npm test` — passed twice, 86 tests in 7 files.
- `$env:LANTERN_CHROME_CHANNEL='chrome'; npm run test:e2e -- --project=chrome` — first run: 2 passed, 2 live-page failures. A simultaneous ordinary build overwrote `dist/index.html` with the default API URL (4318). Fixed the harness to build and preview `dist-e2e`, independently of production `dist`. Re-run: all 4 Chrome tests passed, including live contention and Watch/History on 4499/4418. Never run the two builds into the same output directory.
- `npm run simulate -- --nights 2000 --seed 17 --check` — passed, longest dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 42 --check` — passed, longest dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 93 --check` — passed, longest dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 166 --check` — passed, longest dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 271 --check` — passed, longest dark streak 1, zero invariant errors.

The automated title → Night 2 → first River Run → oil sale path passed in 72 seconds in the final W0 run, using Playwright's clock for the river portion. This is not a human new-player usability result. Firefox and real touch devices were not run. The sections below record historical implementation and verification.

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
