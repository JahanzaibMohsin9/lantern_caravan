export const items = {
  paper: { name: "Paper", price: 2 },
  oil: { name: "Lamp oil", price: 4 },
  reed: { name: "Reed frame", price: 3 },
  cord: { name: "Cord", price: 2 },
  dye: { name: "Dye", price: 3 },
  lantern_paper: { name: "Paper lantern", price: 7 },
  lantern_float: { name: "Floating lantern", price: 10 },
  lantern_color: { name: "Colored lantern", price: 12 },
} as const;

export const merchants = {
  paper_mill: { name: "Paper Mill", keeper: "Mira", color: "#ffb065", goods: { paper: 12, oil: 4 }, greeting: "Good paper holds its shape in the wind." },
  oil_wharf: { name: "Oil Wharf", keeper: "Sami", color: "#e9ae5e", goods: { oil: 12, reed: 4 }, greeting: "A drop of this will last till morning." },
  reed_thread: { name: "Reed & Thread", keeper: "Toma", color: "#91d1a2", goods: { reed: 12, cord: 12, dye: 4 }, greeting: "Reeds from just across the river." },
  indigo_atelier: { name: "Indigo Atelier", keeper: "Nila", color: "#ac99f5", goods: { dye: 12, paper: 4 }, greeting: "Even the river wears indigo at night." },
  lantern_house: { name: "Lantern House", keeper: "Asha", color: "#fa9186", goods: {}, greeting: "The boats are waiting for your light." },
} as const;

export const recipes = {
  paper_lantern: { output: "lantern_paper", inputs: ["paper", "oil"], unlock: 1 },
  floating_lantern: { output: "lantern_float", inputs: ["paper", "oil", "reed"], unlock: 2 },
  colored_lantern: { output: "lantern_color", inputs: ["paper", "oil", "dye", "cord"], unlock: 3 },
} as const;

export const orders = [
  { id: "heron", name: "The Heron", opens: 0, quantity: 1, payout: 10, boat: 0, personal: true },
  { id: "kingfisher", name: "The Kingfisher", opens: 0, quantity: 2, payout: 10, boat: 1, personal: false },
  { id: "swallow", name: "The Swallow", opens: 75, quantity: 2, payout: 10, boat: 2, personal: false },
  { id: "tern", name: "The Tern", opens: 150, quantity: 2, payout: 10, boat: 3, personal: false },
  { id: "egret", name: "The Egret", opens: 225, quantity: 2, payout: 10, boat: 4, personal: false },
] as const;

export const wishes = [
  "May the river be kind", "For my grandmother", "Safe travels home",
  "A good year for the Row", "For the ones we miss", "A little light for tomorrow",
  "May the rain come softly", "For my brother across the water", "A place to call home", "Courage for the morning",
  "For a safe crossing", "Let the lanterns find you", "For a quiet winter", "For a full table",
  "May old friends return", "For my first boat", "A wish for a stranger", "For a kinder tide",
  "May the orchard bloom", "For the hands that taught me", "May the harvest hold", "A new song for the Row",
  "For our next meeting", "For those still at sea", "A little luck for the workshop", "May we laugh again",
  "For the night watch", "For my neighbor", "Light for the long way home", "For the year we made it",
  "For a safe delivery", "May the dock stay dry", "For the next generation", "May this find the right shore",
  "For all who carried me", "For an evening together", "One bright thing", "For the dawn crew",
  "For the river birds", "May we have enough",
] as const;

export type ItemId = keyof typeof items;
export type StallId = keyof typeof merchants;
export type RecipeId = keyof typeof recipes;
