# Lantern Caravan handoff

## Work packages · 5–6 November 2026

### Scope and §16.4 hand-back

W0–W5 were delivered previously. **W6 adds the four-night campaign; W7–W9 remain.** Each package below records its own checks.

| Package | Status |
| --- | --- |
| W0 · rename | Committed as `3196430` |
| W1 · trims | Committed as `0de05b9` |
| W2 · skiffs | Committed as `9a0c327` |
| W3 · wrecks/stops | Committed in the `W3:` commit; checks below |
| W4 · almanac | Committed in the `W4:` commit; checks below |
| W5 · player Bell orders | Committed in the `W5:` commit; checks below |
| W6 · four-night campaign | Committed in the `W6:` commit; checks below |
| W7 · barge looks/cosmetics | Not started |
| W8 · Watch/history/trust | Committed in the `W8:` commit; checks below |
| W9 · Floodtide/server replay | Not started |

- [x] Each delivered package has its own W-prefixed commit and a passing build, Vitest, system-Chrome Playwright and five-seed 2,000-night check.
- [x] Verification and cuts are recorded here; API and balance changes are documented.
- [ ] Human new-player test without docs in under three minutes: not performed.
- [ ] Full manual playthrough: not performed. Firefox and physical touch devices: not verified.

Branch is `main`; no push, remote changes, rebase or history rewrite.

### W6 · Four-night campaign

Night 3 is **Pirates on the Reach**: a personal two-colored-lantern order, a danger-3 Marsh Bend boom, Reed & Thread's funded reed/dye contracts, Juno's funded escort, the existing storm wreck and pressing strike, unlocked trims, and two service stops on Heron Reach. Excess authored stall stock returns to Reedmarsh; rewards and the new Night 2 pledge-plus-haul bonus transfer from real accounts. Objective credit belongs to the player who settles the run, survives reload, and resets at dusk. Preparation and action guidance explain the voyage and Night 4 Bell orders. Festival orders, rival timing, the guided offering, finale/title and Endless transition now use Night 4. Existing Night 3 festival saves migrate to Night 4 with ledger and progress intact.

`stopLayout: "campaign_reach"` binds the authored stops to the manifest; both settlement and simulation derive them through the same content function. A recorded-input voyage visits both stops, breaks the boom and delivers the dye contract, with an identical replay and goods/coin conservation. The browser campaign sails with WASD, boost and fire, buys dye, moors, crafts and delivers two colored lanterns, then finishes Night 4 and reloads into Endless. The separate salvage path now takes a service-stop choice through E and its dialog.

- `npm run schema` — passed; schema regenerated.
- `npx tsx tools/build-golden.ts` — passed; 38 cases, including new Night 3 and Night 4 fixtures.
- `npm run build` — passed, including the save migration; existing Vite bundle and Zod annotation warnings.
- `npm test` — final run passed, 142 tests in 8 files. Earlier full runs passed 139 and 141 tests as coverage was added. The first new voyage test exposed a lost dye unit after a skiff ram; the route now clears nearby pirates before loading and verifies a loss-free, conserved delivery. The first targeted run omitted the replay frame count; fixed the test call.
- `npx vitest run tests/campaign.test.ts` and `npx vitest run tests/campaign-reach.test.ts tests/campaign.test.ts` — passed after those corrections (5 and 7 tests respectively).
- `$env:LANTERN_CHROME_CHANNEL='chrome'; npm run test:e2e -- --project=chrome` — final run passed, 7 tests (3.4 minutes). A prior full run also passed all 7; the next rerun exposed wall-time drift past the service stop (6 passed, 1 failed). The river segment now freezes the browser clock between controlled advances, and the full suite passed again. The two earlier targeted campaign attempts (`... tests/e2e/campaign.spec.ts`) failed on test steering and the village's default five-unit purchase size. Corrected the route and explicitly selected one unit; no checks removed.
- `npm run simulate -- --nights 2000 --seed 17 --check` — passed; longest dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 42 --check` — passed; longest dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 93 --check` — passed; longest dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 166 --check` — passed; longest dark streak 1, zero invariant errors.
- `npm run simulate -- --nights 2000 --seed 271 --check` — passed; longest dark streak 1, zero invariant errors.

All five soaks also had zero invalid goods operations, 2,000 stable nights, and 2,000 Bell orders with none rejected. No source was edited while the soaks ran. Firefox, physical touch devices, a human new-player trial and a full manual playthrough were not run. Floodtide scheduling and server replay remain W9.

### W5 · Player Bell orders

At The Landing, **Post an order** escrows `quantity × unit price` coins (1–12 units, 3–20 coins) in `esc:bell:<id>`; one order per player. Rival haulers weigh open orders on their turn alongside stall routes, taking up to 6 units only when the order's price beats the village cost, scored by margin over distance and danger. A free hauler puts a Bell order first unless a stall on the Row is dark. Delivery moves the goods to the player and pays the hauler from the escrow; a sunk haul becomes a W3 wreck and reopens those units; cancelling refunds the waiting units at once while a haul already under way still delivers; the night's end refunds what's left. The campaign's rivals take Bell orders too (from Night 4, when they open). The Landing shows the order's escrow, deliveries, each haul with its arrival time, and the latest news.

The soak now includes a simulated player posting a 6-unit order every night. With that traffic, three seeds first failed the dark-streak check, which exposed three weaknesses in the harbor's relief: it asked for a good no village had in stock, it paid nothing for danger, and an unfillable relief bell blocked a fillable one. All three are fixed (see `BALANCE_REPORT.md`), with a regression test for the last.

- `npm run schema` — passed; regenerated schema committed.
- `npm run build` — passed.
- `npm test` — passed, 136 tests (7 new for Bell orders: escrow and partial fills through the night's end, sinking reopens units without touching escrow, cancel with a haul under way, no losing jobs and no post-and-resell loop, validation and save round trip, a live-room race between two players; plus the relief withdrawal regression).
- `LANTERN_CHROME_CHANNEL=chrome npm run test:e2e -- --project=chrome` — passed, 7 tests. The new path signs in to a live room, posts a 2-oil order at 12 coins through the form, and waits for a rival to haul and deliver it with the escrow back at 0.
- `npm run simulate -- --nights 2000 --seed <17|42|93|166|271> --check` — all five passed on the final run: longest dark streak 1, zero invariant errors, zero invalid goods ops, 2,000 Bell orders posted and none rejected per seed, no `esc:bell:` balance left at any close. The balance table is refreshed from this run.

### W4 · Harbor almanac

`almanacFor(mode, night, seed)` in `@lantern/content/river` schedules village events: the campaign has Night 3's pressing strike at Ember Falls, and endless and live rooms have one event on every odd night from Night 3, seeded from the room seed with the village rotating so it never repeats back to back. Events are an oil glut, a pressing strike, a mill flood, a dye bloom and a reed blight. Each changes one good's harvest target for one night through `harvestTarget`; the harvest is the only thing that changes. The event is in `snapshot.river.almanac.tomorrow` for the whole night before, logged to the activity feed at both dusks, and shown in an almanac panel at The Landing. When tomorrow brings a shortage, stalls that sell the good post a Harbor Bell contract at 90% of their stock target and log why ("Oil Wharf is stocking up on lamp oil: the almanac warns of a pressing strike at Ember Falls tomorrow."); rival haulers react to those contracts through their normal route scoring, with no special case.

- `npm run schema` — passed; regenerated schema committed.
- `npm run build` — passed.
- `npm test` — passed, 129 tests (4 new: schedule and village rotation over 200 nights on five seeds, harvest-only effect, Night 2 announcement and Night 3 strike, merchant stock-up with a control night).
- `LANTERN_CHROME_CHANNEL=chrome npm run test:e2e -- --project=chrome` — passed, 6 tests. The Night 2 relief path now checks the Landing shows "Tomorrow · Pressing strike at Ember Falls.", and the Night 3 salvage path checks "Tonight · Pressing strike at Ember Falls."
- `npm run simulate -- --nights 2000 --seed <17|42|93|166|271> --check` — all five passed: longest dark streak 1, zero invariant errors, 2,000 stable nights each. The balance table is refreshed from this run.

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
