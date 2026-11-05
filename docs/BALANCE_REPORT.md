# Balance report

Five runs of `npm run simulate -- --nights 2000 --seed <seed> --check` used three autonomous traders. The checked-in CLI writes a JSON summary and per-tick CSV to the ignored `sim-output/` directory.

| Seed | Open-stall target met | Longest dark streak | Stall coins at close | Rescues | Boats lit | Balance/price invariant errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 17 | 2,000/2,000 | 1 | 115–390 | 320 | 6,099 | 0 |
| 42 | 2,000/2,000 | 1 | 126–428 | 356 | 6,121 | 0 |
| 93 | 2,000/2,000 | 1 | 116–417 | 351 | 6,115 | 0 |
| 166 | 2,000/2,000 | 1 | 124–392 | 334 | 6,098 | 0 |
| 271 | 2,000/2,000 | 1 | 110–400 | 321 | 6,099 | 0 |

All five seeds had at least three open stalls on every recorded closing and finished inside the target band of 50–500 total merchant coins. Observed asks were 2–12 coins, within each item's cap. The simulator checks ledger balances, ask clamps, and outstanding-share limits at every tick.

| Seed | Steady wins | Bold wins | Bargain wins | Festival wins |
| --- | ---: | ---: | ---: | ---: |
| 17 | 574 | 115 | 278 | 196 |
| 42 | 634 | 133 | 257 | 153 |
| 93 | 605 | 147 | 266 | 174 |
| 166 | 570 | 140 | 275 | 204 |
| 271 | 607 | 132 | 255 | 201 |

A strategy wins when its eligible stalls pay a strictly higher average dividend per share that night. Tied and zero-dividend nights yield no winner. Steady won most often under these schedules, while each strategy won for each seed. The limited number of late orders filled by rivals leaves useful work for humans in a shared room.

The main stabilizers are recurring shipments, cash-scaled upkeep, a fixed crowd budget, and small relief after a dark close. Removing empty escrow accounts kept long runs from slowing as expired offers accumulated. The offline campaign uses hand-authored stock and pacing separately from these long-run adjustments.
