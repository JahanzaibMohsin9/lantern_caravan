# River Run balance report

Each checked run used three autonomous traders over 2,000 nights. Run `npm run simulate -- --nights 2000 --seed <seed> --check` to reproduce a row. The CLI writes the summary and per-tick CSV under `sim-output/`.

| Seed | Nights with 3+ open stalls | Stall coins at close | Village coins at sampled ticks | Freight loss entries | Supplier units | Boats lit | Invariant errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 17 | 2,000 | 76–302 | 33–245 | 977 | 25,513 | 5,735 | 0 |
| 42 | 2,000 | 76–230 | 33–208 | 1,113 | 25,426 | 5,681 | 0 |
| 93 | 2,000 | 66–265 | 33–212 | 1,079 | 25,485 | 5,674 | 0 |
| 166 | 2,000 | 76–226 | 33–207 | 1,040 | 25,646 | 5,646 | 0 |
| 271 | 2,000 | 63–233 | 33–216 | 1,053 | 25,494 | 5,619 | 0 |

The longest dark streak was two nights for four seeds and three nights for seed 93. Observed asks were 2–12 coins. The checks cover nonnegative integer balances, price bounds, outstanding shares, permitted goods mints and burns, village balances between 20 and 300, danger from 0 to 5, and empty run and contract escrows at close. Supplier units include stall-to-stall wholesale. A lost sailing with several cargo lines can produce several freight loss entries.

## Tuned values

| Rule | Value |
| --- | --- |
| Village harvest targets | Millbrook 24 paper and 16 cord. Ember Falls 24 oil. Reedmarsh 20 reed and 14 dye. |
| Village economy | 40 starting coins. 70% ask modifier and standard 70% buyback. Upkeep is 3 coins plus one for every three above 44, leaving at least 24. |
| Freight | 12 units per sailing, two per night, 60 game seconds per sailing. Operating float topped up to 70 each night. Loss odds are 4% per danger point. Each unit costs the stall at most its Normal ask. |
| Stall reserves | Regular upkeep leaves 20 coins. Harbor relief restores a dark stall to 20 the next evening. Automated hauling and dividends protect a 10-coin operating reserve. Storm repairs skip the sole available paper or oil supplier. |
| Rivals | Preserve the last two retail units of paper and oil for human buyers. Haul route scores use margin, distance, danger, and booms. |
| Harbor Bell | A supply contract requests 3–8 units. Payout uses the Normal base ask and a route and strategy premium. The stall retains the larger of its reserve and 10 coins. |
| Barge | 150-second game timer. 12-unit hold, 100 hull and fuel, and 235 cruising speed. Village routes take roughly 29–35 seconds at cruise. |
| Bounties | 36 coins in the nightly fund. Pirate 3, boom 4, saved village boat 1, and tow costs up to 2. |

The authored campaign starts from its existing inventory targets. Those loads come from village harvests delivered through freight. Night 2 records the oil loss from actual freight cargo. Local runs can be taken during preparation, so they use their own clock.
