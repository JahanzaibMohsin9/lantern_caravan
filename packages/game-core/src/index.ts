import { items, merchants, orders, recipes, wishes, type ItemId, type StallId } from "@lantern/content";
import { intentSchema, type CashBand, type Intent, type LedgerOp, type Quote, type Snapshot } from "@lantern/protocol";
import { apply, balance, type Ledger } from "./ledger";
import { ask, tradePrice } from "./pricing";

export const duration = 300;
export const player = "p:guest";
export const capacity = 6;
export const crowd = "sys:crowd";
const merchantIds = Object.keys(merchants) as StallId[];
const itemIds = Object.keys(items) as ItemId[];
const initialStock = (stall: StallId): Record<string, number> => merchants[stall].goods;
const shop = (stall: string) => "m:" + stall;
const escrow = (id: string) => "esc:order:" + id;
const strategy = (stall: StallId) => stall === "oil_wharf" ? 10500 : stall === "reed_thread" ? 9500 : 10000;
const mint = (to: string, asset: string, amount: number, memo: string): LedgerOp =>
  ({ op: "mint", to, asset, amount: String(amount), memo });
const burn = (from: string, asset: string, amount: number, memo: string): LedgerOp =>
  ({ op: "burn", from, asset, amount: String(amount), memo });
const move = (from: string, to: string, asset: string, amount: number, memo: string): LedgerOp =>
  ({ op: "transfer", from, to, asset, amount: String(amount), memo });

export type World = {
  phase: Snapshot["phase"];
  revision: number;
  ledger: Ledger;
  elapsed: number;
  delivered: number;
  crafted: number;
  crowdSold: number;
  cooldowns: Record<string, number>;
  orderWishes: Record<string, string[]>;
};

export function createWorld(): World {
  const grants = [
    mint(player, "coin", 30, "Starting grant"),
    mint(player, "paper", 2, "Starting grant"),
    mint(player, "oil", 2, "Starting grant"),
    mint(crowd, "coin", 120, "Night budget"),
    ...merchantIds.flatMap(stall => [
      mint(shop(stall), "coin", 40, "Starting float"),
      ...Object.entries(initialStock(stall)).map(([item, quantity]) => mint(shop(stall), item, quantity, "Opening stock")),
    ]),
    ...orders.map(order => mint(escrow(order.id), "coin", order.quantity * order.payout, "Festival budget")),
  ];
  return { phase: "preparation", revision: 0, ledger: apply({}, grants), elapsed: 0,
    delivered: 0, crafted: 0, crowdSold: 0, cooldowns: {}, orderWishes: {} };
}

const get = (state: World, account: string, asset: string) => balance(state.ledger, account, asset);
const cargo = (ledger: Ledger) => itemIds.reduce((sum, item) => sum + balance(ledger, player, item), 0);
const band = (coins: number): CashBand => coins < 5 ? "dark" : coins < 25 ? "tight" : coins < 60 ? "healthy" : "thriving";
const remaining = (state: World, order: typeof orders[number]) => get(state, escrow(order.id), "coin") / order.payout;

export function quote(state: World, raw: Intent, id: string, now: number, agreedTotal?: number): Quote {
  const intent = intentSchema.parse(raw);
  if (state.phase !== "open" || state.elapsed >= duration) throw new Error("The market is closed.");
  const quantity = Number(intent.quantity);
  if (quantity > capacity) throw new Error("Your cart holds six items.");
  let effects: LedgerOp[];
  let summary: string;

  switch (intent.type) {
    case "buy":
    case "sell": {
      const stall = intent.stall_id as StallId;
      const item = intent.item_id as ItemId;
      const account = shop(stall);
      if (!Object.hasOwn(merchants, stall) || !Object.hasOwn(initialStock(stall), item)) {
        throw new Error("This stall doesn’t trade that item.");
      }
      if (band(get(state, account, "coin")) === "dark") throw new Error("This stall is closed.");
      const stock = get(state, account, item);
      const buying = intent.type === "buy";
      const from = buying ? account : player;
      const to = buying ? player : account;
      const total = agreedTotal ?? tradePrice(intent.type, items[item].price, stock, initialStock(stall)[item]!, strategy(stall), quantity);
      if (get(state, from, item) < quantity) throw new Error(buying ? "The stall is low on stock." : "You don’t have enough to sell.");
      if (get(state, to, "coin") < total) throw new Error(buying ? "You’re short on coins." : "The stall is short on coins.");
      summary = `${buying ? "Buy" : "Sell"} ${quantity} · ${total} coins`;
      effects = [move(from, to, item, quantity, summary), move(to, from, "coin", total, summary)];
      break;
    }
    case "craft": {
      if (intent.recipe_id !== "paper_lantern") throw new Error("This recipe unlocks on a later night.");
      const recipe = recipes.paper_lantern;
      if (recipe.inputs.some(item => get(state, player, item) < quantity)) throw new Error("You need paper and oil.");
      summary = `Craft ${quantity} · Paper lantern`;
      effects = [...recipe.inputs.map(item => burn(player, item, quantity, summary)),
        mint(player, recipe.output, quantity, summary)];
      break;
    }
    case "fill_order": {
      const order = orders.find(entry => entry.id === intent.order_id);
      if (!order || state.elapsed < order.opens) throw new Error("This order hasn’t opened yet.");
      if (remaining(state, order) < quantity) throw new Error("The boat already has those lanterns.");
      if (get(state, player, "lantern_paper") < quantity) throw new Error("Craft more paper lanterns first.");
      if (intent.wish_id && !wishes.includes(intent.wish_id as typeof wishes[number])) throw new Error("Choose a wish from the list.");
      summary = `Deliver ${quantity} · ${quantity * order.payout} coins`;
      effects = [move(player, "sys:festival", "lantern_paper", quantity, summary),
        move(escrow(order.id), player, "coin", quantity * order.payout, summary)];
      break;
    }
    case "sell_crowd": {
      if (intent.item_id !== "lantern_paper" || get(state, player, "lantern_paper") < quantity) {
        throw new Error("You need paper lanterns to sell.");
      }
      if (state.crowdSold + quantity > 6) throw new Error("You’ve reached the crowd’s nightly limit.");
      const total = items.lantern_paper.price * quantity;
      if (get(state, crowd, "coin") < total) throw new Error("The crowd has spent its budget.");
      summary = `Sell ${quantity} · ${total} coins`;
      effects = [burn(player, "lantern_paper", quantity, summary), move(crowd, player, "coin", total, summary)];
      break;
    }
  }

  if (cargo(apply(state.ledger, effects)) > capacity) throw new Error("Your cart is full.");
  return { quote_id: id, intent, summary, effects, expires_at: now + 15000 };
}

export function commit(state: World, deal: Quote, now: number): World {
  if (now >= deal.expires_at) throw new Error("Quote expired. Ask for a fresh price.");
  if (state.phase !== "open" || state.elapsed >= duration) throw new Error("The market is closed.");
  const ledger = apply(state.ledger, deal.effects);
  if (cargo(ledger) > capacity) throw new Error("Your cart is full.");
  const next = { ...state, ledger, revision: state.revision + 1 };
  const quantity = Number(deal.intent.quantity);
  if (deal.intent.type === "craft") next.crafted += quantity;
  if (deal.intent.type === "sell_crowd") next.crowdSold += quantity;
  if (deal.intent.type === "fill_order") {
    next.delivered += quantity;
    const { order_id, wish_id } = deal.intent;
    if (wish_id) {
      next.orderWishes = { ...state.orderWishes,
        [order_id]: [...(state.orderWishes[order_id] ?? []), ...Array<string>(quantity).fill(wish_id)] };
    }
  }
  return next;
}

export function snapshotFor(state: World, session_id: string): Snapshot {
  return {
    session_id, night_id: "first-light", revision: state.revision, phase: state.phase, elapsed: state.elapsed,
    coins: String(get(state, player, "coin")),
    cargo: Object.fromEntries(itemIds.map(item => [item, String(get(state, player, item))])),
    merchants: Object.fromEntries(merchantIds.map(stall => {
      const stock = state.ledger[shop(stall)] ?? {};
      return [stall, {
        band: band(stock.coin ?? 0),
        stock: Object.fromEntries(Object.keys(initialStock(stall)).map(item => [item, String(stock[item] ?? 0)])),
        prices: Object.fromEntries(Object.entries(initialStock(stall)).map(([key, target]) => {
          const item = key as ItemId;
          const { price, label } = ask(items[item].price, stock[item] ?? 0, target, strategy(stall));
          return [item, { buy: String(price), sell: String(tradePrice("sell", items[item].price, stock[item] ?? 0, target, strategy(stall), 1)), label, target: String(target) }];
        })),
      }];
    })),
    orders: orders.map(order => {
      const left = remaining(state, order);
      return { ...order, remaining: String(left), quantity: String(order.quantity), payout: String(order.payout),
        wishes: state.orderWishes[order.id] ?? [],
        state: left === 0 ? "filled" : state.phase === "results" ? "expired" : state.elapsed < order.opens ? "upcoming" : "open" };
    }),
    delivered: String(state.delivered), crafted: String(state.crafted), crowdBudget: String(get(state, crowd, "coin")),
    crowdSold: String(state.crowdSold), saveStatus: "saved",
  };
}

export function advanceClock(state: World, elapsed: number): World {
  if (state.phase !== "open") return state;
  return elapsed < duration ? { ...state, elapsed }
    : { ...state, elapsed: duration, phase: "results", revision: state.revision + 1 };
}
