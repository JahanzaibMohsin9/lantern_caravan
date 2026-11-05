# Build decisions

## First Light milestone

- First Light is the initial playable slice of Tier 1. The title's entry button also opens the market so a player can reach the workshop in one click. The context guide gives one suggested action at a time and can be turned off.
- The Heron and Kingfisher both open at the start. Completing the objective does not require waiting for the next scheduled order. The player can close the night early after three deliveries or trade until the five-minute timer ends.
- Haggling measures tolerance against the whole batch total and rounds any concession down to a whole coin. Merchant-specific relationships and policy decisions are later Tier 1 work.
- The browser has one automatic campaign save for this milestone. IndexedDB keeps the previous valid write as a backup. The market timer uses active play time and stops on pause, settings, and hidden tabs.
- The world and interface use vector silhouettes, stall light, icons, and compact labels. The HUD shows the three-delivery goal separately from the six-boat river meter because First Light has a smaller objective.
- The client and protocol implement the local methods used by First Light. The full client and server contracts in the brief remain the target for the later milestones.
