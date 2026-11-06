# Lantern Caravan · River Run balance report

Rows below were reproduced by the W6, W7 and W8 five-seed runs (5–6 November 2026), with wrecks, the almanac and a simulated player posting a Bell order every night. They match W5. The CLI fails `--check` for a dark streak above **one** night, matching §16.2. W6 changes only authored campaign values, listed below.

Each checked run used three autonomous traders over 2,000 nights. Run `npm run simulate -- --nights 2000 --seed <seed> --check` to reproduce a row. The CLI writes the summary and per-tick CSV under `sim-output/`.

| Seed | Nights with 3+ open stalls | Stall coins at close | Village coins at sampled ticks | Freight loss entries | Supplier units | Boats lit | Invariant errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 17 | 2,000 | 58–286 | 36–273 | 1019 | 25,337 | 5,434 | 0 |
| 42 | 2,000 | 60–260 | 36–267 | 987 | 24,971 | 5,469 | 0 |
| 93 | 2,000 | 57–301 | 36–266 | 955 | 25,093 | 5,418 | 0 |
| 166 | 2,000 | 68–288 | 36–258 | 916 | 25,317 | 5,438 | 0 |
| 271 | 2,000 | 62–289 | 36–238 | 835 | 25,131 | 5,570 | 0 |

The longest dark streak was one night for every seed. During the review, two seeds exposed a stall that sold out while holding 10–15 coins: it couldn't pay a hauler above its 10-coin reserve, so it stayed closed for up to 11 nights. The harbor's relief contract now pays for that haul, priced so rivals will take it. The checks cover nonnegative integer balances, price bounds, outstanding shares, permitted goods mints and burns, village balances between 20 and 300, danger from 0 to 5, and empty run and contract escrows at close. Supplier units include stall-to-stall wholesale. A lost sailing with several cargo lines can produce several freight loss entries.

## Tuned values

W8 trust: two paid supply contracts for the same village earn 10% off that village's purchases for the rest of the campaign/live season. The discount is rounded down to whole coins on the cumulative total for each good per run; incremental purchases pay differences between those totals. This avoids extra savings from splitting a batch. The discount replaces the existing one-coin discount on batches of four for trusted buyers, and reduces the real payment to the village. There is no mint, subsidy or changed harvest/contract payout. Failed deliveries and other players' contracts do not count. The rule tests complete and replay two voyages, then replay a discounted voyage and assert asset conservation. The soak's autonomous hauls do not use player contract trust; its bounds remain a regression check on the shared economy.

W7 cosmetics: Riverwood and Midnight paints are free; Vermilion 20, Moss 25, Ivory 30 and Indigo 35 coins. Amber lantern is free; Jade 15, Rose 20 and Violet 25. Plain prow is free; Heron 30 and Carp 40. Every purchase transfers coins to `sys:rescue`; refits cost zero. Upgrade prices and all simulation/economy values are unchanged. The test suite checks every finish against an otherwise identical simulation and replay, and conserves every asset across purchase and refit.

W6 campaign-only authored values: Night 3 has danger 3 and a boom at Marsh Bend; Reed & Thread keeps 3 reed and 1 dye, and Indigo Atelier keeps 1 dye. Excess stock returns to Reedmarsh. Reed & Thread funds two 3-unit contracts at a base 12 coins each, modified by strategy (Bold +2, Festival +1, Bargain −1), only while retaining 5 coins. Juno buys 2 reed and escrows an 8-coin escort, departing at 45 seconds and arriving at 110. These values keep both objective paths funded without new supply. The two stops sit at 25% and 78% of Heron Reach, 57.5 units off its center. The Night 2 pledge-plus-haul bonus is 2 coins from the existing dock fund, capped by its balance. Endless/live economy values are unchanged.

W5 Bell orders: 1–12 units at 3–20 coins each, one order per player. A hauler takes at most 6 units per trip and only when the order's price for those units beats their village cost. A free hauler answers a relief bell first, then a player's Bell order (unless a stall is dark), then festival and stall routes. The soak now includes a simulated player that posts a 6-unit order every night at the village price plus 3; every seed delivers or refunds all 2,000 orders with no escrow left at close.

Two fixes came out of the W5 soak. With Bell orders competing for haulers, two seeds reached a two-night dark streak:
- **Relief picked a good the villages had run out of.** It now asks for the most-needed good that a village can supply at least 3 of.
- **A relief haul on a dangerous route paid too little to be taken.** The relief premium now adds 2 coins per danger point on the route, like ordinary contracts, and haulers answer relief bells before other work.
- **A relief bell for a good every village had lost to the river stayed posted all night**, which blocked a relief bell for a good that was in stock. An untaken relief bell is now withdrawn, with its escrow back in the dock fund, once its village can no longer supply it, and the harbor rings again for an available good.

W4 almanac values: an oil glut harvests to 36 oil (24 × 1.5); a pressing strike, mill flood or reed blight harvests to half the usual target (12 oil, 12 paper, 10 reed); a dye bloom adds 6 dye (20). A harvest only tops a village up to its target, so a shortage event matters when the village has already been bought down. When tomorrow's event is a shortage, any stall that sells that good posts a Harbor Bell contract once its stock falls below 90% of target instead of the usual 50–60%, still subject to its cash reserve. Events run on odd nights from Night 3 in endless and live rooms and rotate villages; the campaign has only Night 3's pressing strike.

W3 adds no tuned economy values: wrecks hold exactly the cargo a lost haul carried and break up after two nights; stop gains are hull, fuel and ammo, plus the fisher's 6-coin bounty from the existing fund.

W2 applies A3: skiff 40 HP / 6 bounty, raider 57 HP / 8 bounty (previously 42 HP / 3 bounty), gunboat 96 HP / 14 bounty. At danger 2+, every third spawn starting with the second is a skiff; at danger 3+, every third starting with the third is a gunboat. Danger 0 has no spawns. The existing 36-coin fund is unchanged. Skiffs close at 148 units/s, ram for 8 hull and spill one held good, then retreat for 2.2 seconds. A spill is recoverable for 20 seconds; unrecovered goods use the existing river burn. Gunboats retain 68 units/s and twin fire, now approaching to 300, retreating inside 230 and firing within 460 (raiders: 100 speed, 185/115/360). These values implement the specified fast rammer and long-range gunboat; no economic tuning was needed.

W1 uses the A2 values without tuning: Balanced has no modifiers; Runner multiplies speed, acceleration and turning by 1.15 and shot damage by 0.85; Ironclad multiplies speed, acceleration and turning by 0.85 and incoming bullet, collision and Floodtide damage by 0.75; Gunner multiplies firing rate and moving fuel consumption by 1.2. Upgrade bonuses apply before these multipliers. Fits cost no coins or goods. Trims unlock on campaign Night 3 and immediately in endless/live. Physics remains fixed at 60 Hz (firing intervals are quantized to frames).

| Rule | Value |
| --- | --- |
| Village harvest targets | Millbrook 24 paper and 16 cord. Ember Falls 24 oil. Reedmarsh 20 reed and 14 dye. |
| Village economy | 40 starting coins. 70% ask modifier and standard 70% buyback. Upkeep is 3 coins plus one for every three above 44, leaving at least 24. |
| Freight | 12 units per sailing, two per night, 60 game seconds per sailing. Operating float topped up to 70 each night. Loss odds are 4% per danger point. Each unit costs the stall at most its Normal ask. |
| Stall reserves | Regular upkeep leaves 20 coins. Harbor relief restores a dark stall to 20 the next evening. Automated hauling and dividends protect a 10-coin operating reserve. Storm repairs skip the sole available paper or oil supplier. |
| Rivals | Preserve the last two retail units of paper and oil for human buyers. Haul route scores use margin, distance, danger, and booms. |
| Harbor Bell | A supply contract requests 3–8 units. Payout uses the Normal base ask and a route and strategy premium. The stall retains the larger of its reserve and 10 coins. |
| Barge | 150-second game timer. 12-unit hold, 100 hull and fuel, and 235 cruising speed. Village routes take roughly 29–35 seconds at cruise. |
| Relief hauls | A stall that is dark from lack of cash or stock, and short at least 3 units, gets a harbor contract from the dock fund: the village price plus 2 coins and one per two units, for 3–8 units the village can sell. Delivery relights it with a restart float to 20 coins. |
| Opening night | Villages harvest again after stocking the Row on night 1. |
| Bounties | 36 coins in the nightly fund. Skiff 6, raider 8, gunboat 14 (legacy reports 3 per pirate), boom 4, saved village boat 1, and tow costs up to 2. |

The authored campaign starts from its existing inventory targets. Those loads come from village harvests delivered through freight. Night 2 records the oil loss from actual freight cargo. Local runs can be taken during preparation, so they use their own clock.
