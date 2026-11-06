# Lantern Caravan handoff

## Work packages · 5–6 November 2026

### Scope and §16.4 hand-back

**W0–W9 are all delivered.** W6–W8 and most of W9 were written by the third implementer, who ran out of time before finishing W9's checks and before recording W7 and W8 here; W9 was finished, fixed and verified afterwards (see below). Each package below records its own checks.

| Package | Status |
| --- | --- |
| W0 · rename | Committed as `3196430` (now `ba9938c` after the history rewrite) |
| W1 · trims | Committed |
| W2 · skiffs | Committed |
| W3 · wrecks/stops | Committed |
| W4 · almanac | Committed |
| W5 · player Bell orders | Committed |
| W6 · four-night campaign | Committed as `fe21c0a` |
| W7 · barge looks/cosmetics | Committed as `9023cef` |
| W8 · Watch/history/trust | Committed as `8337d03` |
| W9 · Floodtide/server replay | Committed in the `W9:` commit; checks below |

§16.4 hand-back:

- [x] Every package is committed with a passing build, Vitest, system-Chrome Playwright and five-seed check, and the working tree is clean.
- [x] Each package is listed here with its verification; nothing was cut.
- [x] `KNOWN_ISSUES.md` lists what is untested.
- [ ] Human new-player test without docs in under three minutes: not performed. The automated title → Night 2 → first run → oil sold path passes with Playwright's simulated clock.
- [ ] Full manual playthrough: not performed. Firefox and physical touch devices: not verified.

Branch is `main`. Commit messages credit no AI tool.

### NEAR items contract (6 November 2026)

`contracts/items/` is the NEP-245 multi-token contract the settlement provider will write to: every coin, material, lantern and stall share, with operator-only `game_settle` (atomic, idempotent per action ID), `agent_settle` for merchants and haulers signing their own transfers, standard events whose memos carry the action ID and harvest source, and the NEP-245 views. See its README. Nothing in the game calls it yet; that's the settlement provider.

- `cargo test` (with `AWS_LC_SYS_PREBUILT_NASM=1` on Windows) — passed, 18 tests.
- `cargo near build non-reproducible-wasm --no-abi` (cargo-near 0.23.0) — passed; 212.8 KB after wasm-opt. Not yet deployed.

### W9 · Floodtide and server replay

**Server replay.** Run reports now carry the input log (`inputLog`, at most 9,000 changes and 2 MiB, with each input limited to the barge controls) bound by a canonical `inputLogHash`. `verifyRunReport` in `@lantern/river-sim/report` checks the log's shape, order and hash, replays it against the stored manifest and requires the replayed report to equal the submitted one. The live server runs it on every `finish_run` quote; a mismatch returns `RIVER_REPLAY` and cancels only that player's run, returning its reservations. The HTTP limit was raised to fit the log, and `RIVER_*` errors keep their code on the wire.

**Floodtide.** `floodtideOpens` schedules it from the final festival order: 1:10 on campaign Night 4, and on endless and live festival-rush nights. A barge that is out then gets `floodtideAtMs` in its manifest; the simulation starts Floodtide at that frame, so replay and settlement agree. The Landing shows when it opens and closes departures once it has (`RIVER_FLOOD_CLOSED`); the HUD switches to a Floodtide clock and lock counter. A supply contract's premium is escrowed from the issuer at departure and paid again on a completed return; on a failed return the cargo goes back to its source village at the buyback price and the escrow returns to the issuer. Every movement is a transfer.

**Finishing work (after the third implementer stopped).** The work was uncommitted with no recorded checks. Unit tests passed, but the Floodtide browser test failed every time: lock gates only counted if the barge passed within 86 units of their center, in a 660-wide channel with the flood current pushing sideways, so a barge sailing down the river missed them. Gates now span the channel: crossing a gate's line heading downstream anywhere within 300 units of its center counts. They're drawn as timber barriers with a lamp at each bank and swing open when passed. A new simulation test covers crossing near either bank and sailing back upstream through a gate, which doesn't count. The soak's end-of-night check now also requires empty `esc:flood:` accounts.

- `npm run schema` — passed; regenerated schema committed.
- `npm run build` — passed (existing bundle-size warning).
- `npm test` — passed, 175 tests in 11 files, including Floodtide success and failure with replay and full asset conservation, scheduling and cancellation refunds, input-log limits, eight server-rejected forgeries, and the new channel-wide gate test.
- `LANTERN_CHROME_CHANNEL=chrome npm run test:e2e -- --project=chrome --workers=2` — passed, 11 tests in 4.8 minutes. The Night 4 path imports a festival save, accepts a dye contract, sails to Reedmarsh, waits for Floodtide, then crosses both lock gates and moors. A first full run with four workers, while a soak was also running, timed out on the full-campaign and relief paths; both passed when rerun, and the final run used two workers with nothing else running.
- `npm run simulate -- --nights 2000 --seed <17|42|93|166|271> --check` — all five passed with W9 complete and nothing else running: longest dark streak 1, zero invariant errors, zero invalid goods ops, 2,000 stable nights and 2,000 Bell orders per seed, and no `esc:bell:` or `esc:flood:` balance at any close.

### W8 · River Watch, history and village trust

Recorded after the fact from commit `8337d03`, its API, README and balance notes, and the W9 verification run, which includes all of W8's tests. Watch shows a river strip with reach danger, booms, village cash bands and named barges upriver. Public history adds village (coins, source price, unreserved stock) and reach (danger, boom) series alongside stall rows, with no sign-in needed. Two paid supply contracts for the same village earn that player the trusted-hauler stamp and 10% off that village's purchases across nights; the discount is taken from the cumulative total per good, so splitting a batch saves nothing, and it reduces what the village receives rather than minting anything. Tests: `tests/village-trust.test.ts`, the two-barge race and restart test in `tests/live.test.ts`, the Watch strip path in `tests/e2e/live.spec.ts` and the trusted-hauler path in `tests/e2e/river.spec.ts`. The third implementer's own per-commit check results were not recorded; all of them pass in the W9 run above.

### W7 · Barge looks and lantern finishes

Recorded after the fact from commit `9023cef` and its API, README and balance notes; its tests pass in the W9 run above. Upgrade tiers change the barge on the river and in the Landing preview through one renderer (`apps/web/src/river/barge.ts`): deck crates, iron bands and plating, bigger cannons and twin barrels, extra stacks and a stern paddle wheel. Paint, bow lantern and prow finishes are bought with `buy_barge_cosmetic` (paid to `sys:rescue`, owned permanently) and refitted free with `fit_barge_cosmetic`; looks never change stats. Tests: `tests/barge-looks.test.ts` (ownership, refits, conservation, identical simulation and replay for every finish), a live-restart test, and the browser path in `tests/e2e/river.spec.ts`.

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
