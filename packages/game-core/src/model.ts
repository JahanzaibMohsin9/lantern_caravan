import { items, merchants, recipes, type ItemId, type StallId } from "@lantern/content";
import { nightPlan, rivalNames, strategies, type FestivalOrder, type StrategyId, type UpgradeId } from "@lantern/content/nights";
import type { Activity, CashBand, LedgerOp, Mode, Snapshot } from "@lantern/protocol";
import { apply, balance, type Ledger } from "./ledger";
import type { BargeCosmeticId, BargeLook, BargeTrimId, BargeUpgradeId, VillageId } from "@lantern/content/river";
import { beginRiverNight, freshRiver, starterGoods, type RiverState } from "./river";

export const player = "p:guest";
export const capacity = 6;
export const duration = 300;
export const crowd = "sys:crowd";
export const rescue = "sys:rescue";
export const merchantIds = Object.keys(merchants) as StallId[];
export const itemIds = Object.keys(items) as ItemId[];
export const stockTargets = (stall: StallId): Record<string, number> => merchants[stall].goods;
export const shop = (stall: string) => "m:" + stall;
export const share = (stall: string) => "share:" + stall;
export const escrow = (order: string) => "esc:order:" + order;
export const offerEscrow = (offer: string) => "esc:offer:" + offer;
export const listingEscrow = (listing: string) => "esc:listing:" + listing;
export const payoutPool = (stall: string) => "pool:div:" + stall;
export const mint = (to: string, asset: string, amount: number, memo: string): Extract<LedgerOp, { op: "mint" }> =>
  ({ op: "mint", to, asset, amount: String(amount), memo });
export const burn = (from: string, asset: string, amount: number, memo: string): Extract<LedgerOp, { op: "burn" }> =>
  ({ op: "burn", from, asset, amount: String(amount), memo });
export const move = (from: string, to: string, asset: string, amount: number, memo: string): LedgerOp =>
  ({ op: "transfer", from, to, asset, amount: String(amount), memo });

export type Trader = {
  cosmetics: BargeCosmeticId[]; look?: BargeLook;
  boomsTonight: number; contractsTonight: number; wharfBonus: number;
  trim?: BargeTrimId;
  name: string; upgrades: (UpgradeId | BargeUpgradeId)[]; delivered: Partial<Record<ItemId, number>>;
  crafted: number; crowdSold: number; earned: number; spent: number; jobsDone: number;
  relationship: Partial<Record<StallId | VillageId, number>>; fair: Partial<Record<StallId, number>>; refused: StallId[];
  cooldowns: Partial<Record<StallId, number>>; job?: { id: string; readyAt: number };
  lifetimeCrafted: number; lifetimeDividends: number; boatsHelped: number; rescued: number;
  rescuedTonight: StallId[]; votes: Partial<Record<StallId, StrategyId>>; lastStop?: string;
  dividends: Partial<Record<StallId, number>>;
};

export type Stall = {
  strategy: StrategyId; profit: number; unitsSold: number; drift: number; thinking: string;
  lastSharePrice: number; dividendHistory: number[]; rescued: boolean; offerCount: number; stockClosed?: boolean;
};

export type Offering = {
  id: string; stall: StallId; kind: "rescue" | "expansion"; total: number; price: number;
  ends: number; contributions: Record<string, number>;
};
export type Listing = { id: string; actor: string; stall: StallId; shares: number; price: number };
export type World = {
  phase: Snapshot["phase"]; mode: Mode; night: number; seed: number; revision: number;
  ledger: Ledger; elapsed: number; tickAt: number; traders: Record<string, Trader>;
  market: Record<StallId, Stall>; offers: Record<string, Offering>; listings: Record<string, Listing>;
  orderWishes: Record<string, string[]>; orderContributors: Record<string, string[]>; wishAuthors: Record<string, string[]>;
  activity: Activity[];
  river: RiverState;
};

const defaults: Record<StallId, StrategyId> = {
  paper_mill: "steady", oil_wharf: "bold", reed_thread: "bargain", indigo_atelier: "festival", lantern_house: "steady",
};

const freshTrader = (name: string): Trader => ({
  cosmetics: [],
  boomsTonight: 0, contractsTonight: 0, wharfBonus: 0,
  name, upgrades: [], delivered: {}, crafted: 0, crowdSold: 0, earned: 0, spent: 0,
  jobsDone: 0, relationship: {}, fair: {}, refused: [], cooldowns: {}, votes: {},
  lifetimeCrafted: 0, lifetimeDividends: 0, boatsHelped: 0, rescued: 0, rescuedTonight: [], dividends: {},
});

export const get = (state: World, account: string, asset: string) => balance(state.ledger, account, asset);
export const cart = (ledger: Ledger, actor: string) => itemIds.reduce((sum, item) => sum + balance(ledger, actor, item), 0);
export const cartCapacity = (trader: Trader) => trader.upgrades.includes("cart_ii") ? 10 : trader.upgrades.includes("cart_i") ? 8 : capacity;
export const cashBand = (coins: number): CashBand => coins < 5 ? "dark" : coins < 25 ? "tight" : coins < 60 ? "healthy" : "thriving";
export const plan = (state: World) => nightPlan(state.night, state.mode, state.seed);
export const nightId = (state: World) => state.mode === "campaign" && state.night === 1 ? "first-light" : `night-${state.night}`;
export const nowAt = (state: World) => Math.floor(state.elapsed * 1000);
export const supply = (state: World, asset: string) => Object.keys(state.ledger).reduce((sum, account) => sum + get(state, account, asset), 0);
export const ratio = (state: World, stall: StallId) => Math.round(strategies[state.market[stall].strategy].price * state.market[stall].drift / 10000);
export const unlock = (state: World) => state.mode === "campaign" ? state.night : Math.max(4, state.night);

export function getTrader(state: World, actor: string): Trader {
  if (!Object.hasOwn(state.traders, actor)) throw new Error("Join the market to trade.");
  return state.traders[actor]!;
}

export function addTrader(state: World, actor: string, name: string): World {
  if (Object.hasOwn(state.traders, actor)) return state;
  const startingCoins = actor.startsWith("r:") ? 26 : 30;
  const supplied = starterGoods(state, actor);
  const ledger = apply(supplied.ledger, [mint(actor, "coin", startingCoins, "Starting grant")]);
  return { ...supplied, ledger, revision: supplied.revision + 1, traders: { ...state.traders, [actor]: freshTrader(name) } };
}

export function newStall(stall: StallId): Stall {
  return { strategy: defaults[stall], profit: 0, unitsSold: 0, drift: 10000,
    thinking: "Watching the evening trade.", lastSharePrice: 0, dividendHistory: [], rescued: false, offerCount: 0 };
}

export function addActivity(state: World, line: string, actor?: string): World {
  return { ...state, activity: [...state.activity, { line, actor, night: state.night, at: state.elapsed }].slice(-80) };
}

export function orderPayout(state: World, order: FestivalOrder) {
  const bonus = plan(state).events.some(event => event.at <= order.opens &&
    ((event.id === "wind_rises" && order.item === "lantern_float") || (event.id === "visiting_artists" && order.item === "lantern_color")));
  return bonus ? Math.floor(order.payout * 1.25) : order.payout;
}

export function remaining(state: World, order: FestivalOrder) {
  return get(state, escrow(order.id), "coin") / orderPayout(state, order);
}

export function hasRecipe(state: World, actor: string) {
  return Object.values(recipes).some(recipe => recipe.unlock <= unlock(state) &&
    recipe.inputs.every(item => get(state, actor, item) > 0));
}

export function canTakeJob(state: World, actor: string) {
  const trader = getTrader(state, actor);
  return get(state, actor, "coin") < 4 && !hasRecipe(state, actor) &&
    !itemIds.some(item => item.startsWith("lantern_") && get(state, actor, item) > 0) &&
    !trader.job && trader.jobsDone < 2 && get(state, rescue, "coin") >= 4;
}

export function fundNight(state: World) {
  const crowdGrant = Math.max(0, 120 - get(state, crowd, "coin"));
  const jobGrant = Math.max(0, 32 - get(state, rescue, "coin"));
  return apply(state.ledger, [
    ...(crowdGrant ? [mint(crowd, "coin", crowdGrant, "Night budget")] : []),
    ...(jobGrant ? [mint(rescue, "coin", jobGrant, "Dock fund")] : []),
    ...plan(state).orders.map(order => mint(escrow(order.id), "coin", order.quantity * orderPayout(state, order), "Festival budget")),
  ]);
}

export function createWorld(mode: Mode = "campaign", seed = 42): World {
  const world: World = {
    phase: "preparation", mode, night: 1, seed, revision: 0, elapsed: 0, tickAt: 0,
    ledger: apply({}, merchantIds.map(stall => mint(shop(stall), "coin", 40, "Starting float"))),
    river: freshRiver(seed),
    traders: {}, market: Object.fromEntries(merchantIds.map(stall => [stall, newStall(stall)])) as World["market"],
    offers: {}, listings: {}, orderWishes: {}, orderContributors: {}, wishAuthors: {}, activity: [],
  };
  const supplied = beginRiverNight(world);
  let next = mode === "live" ? supplied : addTrader(supplied, player, "You");
  for (const [actor, name] of Object.entries(rivalNames).slice(0, mode === "live" ? 3 : 2)) next = addTrader(next, actor, name);
  return { ...next, revision: 0, ledger: fundNight(next) };
}

export function newNight(previous: World, mode: Mode = previous.mode): World {
  if (previous.phase !== "results") throw new Error("Close this night first.");
  const night = previous.night + 1;
  const next: World = {
    ...previous, mode, night, phase: "preparation", elapsed: 0, tickAt: 0, revision: previous.revision + 1,
    ledger: apply(previous.ledger, plan(previous).orders.flatMap(order => {
      const account = escrow(order.id);
      const left = get(previous, account, "coin");
      return left ? [burn(account, "coin", left, "Expired festival budget")] : [];
    })),
    offers: {}, orderWishes: {}, orderContributors: {}, wishAuthors: {},
    market: Object.fromEntries(merchantIds.map(stall => [stall, { ...previous.market[stall],
      profit: 0, unitsSold: 0, rescued: false, offerCount: 0, stockClosed: mode === "campaign" ? false : previous.market[stall].stockClosed, thinking: "Watching the river for freight." }])) as World["market"],
    traders: Object.fromEntries(Object.entries(previous.traders).map(([actor, trader]) => [actor, {
      ...freshTrader(trader.name), upgrades: trader.upgrades, relationship: trader.relationship, trim: trader.trim,
      cosmetics: trader.cosmetics, look: trader.look,
      lifetimeCrafted: trader.lifetimeCrafted, lifetimeDividends: trader.lifetimeDividends,
      boatsHelped: trader.boatsHelped, rescued: trader.rescued, dividends: trader.dividends,
    }])),
  };
  const upkeep: LedgerOp[] = [];
  if (mode === "campaign" && night === 2) {
    const cash = get(next, shop("oil_wharf"), "coin");
    if (cash > 2) upkeep.push(move(shop("oil_wharf"), "sys:freight", "coin", cash - 2, "Storm repairs"));
    const savings = get(next, player, "coin");
    if (savings < 14) upkeep.push(mint(player, "coin", 14 - savings, "Wharf relief grant"));
  }
  if (mode !== "campaign") {
    const storm = night % 5 === 0 ? merchantIds[(Math.floor(night / 5) + next.seed) % 4] : undefined;
    const protectedSupply = storm && (["paper", "oil"] as const).some(item => get(next, shop(storm), item) > 0 &&
      !merchantIds.some(stall => stall !== storm && get(next, shop(stall), "coin") >= 5 && get(next, shop(stall), item) > 0));
    const affected = protectedSupply ? undefined : storm;
    const costs = [4, 6, 3, 2, 2];
    merchantIds.forEach((stall, index) => {
      const account = shop(stall);
      const cash = get(next, account, "coin");
      if (cash < 5) {
        upkeep.push(mint(account, "coin", 20 - cash, "Harbor relief"));
        return;
      }
      const rent = affected === stall ? cash - 3
        : Math.min(Math.max(0, cash - 20), costs[index]! + Math.floor(Math.max(0, cash - 44) / 3));
      if (rent > 0) upkeep.push(move(account, "sys:freight", "coin", rent, affected === stall ? "Storm repairs" : "Stall upkeep"));
    });
  }
  for (const actor of Object.keys(next.traders).filter(id => id.startsWith("r:"))) {
    const float = get(next, actor, "coin");
    if (float < 22) upkeep.push(mint(actor, "coin", 22 - float, "Resident supply budget"));
  }
  next.ledger = apply(fundNight(next), upkeep);
  return beginRiverNight(next);
}

export function objective(state: World, actor: string): Snapshot["objective"] {
  const trader = state.traders[actor];
  const got = trader?.delivered ?? {};
  const lit = plan(state).orders.filter(order => state.orderContributors[order.id]?.length && remaining(state, order) === 0).length;
  const step = (label: string, count: number, target: number, icon: string) =>
    ({ label, count: String(Math.min(count, target)), target: String(target), icon });
  if (state.mode === "campaign" && state.night === 1) {
    return { name: "Light the river", complete: (got.lantern_paper ?? 0) >= 3, steps: [step("delivered", got.lantern_paper ?? 0, 3, "lantern_paper")] };
  }
  if (state.mode === "campaign" && state.night === 2) {
    const relit = trader?.rescuedTonight.includes("oil_wharf") ?? false;
    return { name: "Relight the wharf", complete: relit && (got.lantern_float ?? 0) >= 2 && (got.lantern_paper ?? 0) >= 2,
      steps: [step("Wharf relit", Number(relit), 1, "wharf"), step("Floating", got.lantern_float ?? 0, 2, "lantern_float"),
        step("Paper", got.lantern_paper ?? 0, 2, "lantern_paper")] };
  }
  if (state.mode === "campaign" && state.night === 3) {
    const booms = trader?.boomsTonight ?? 0, contracts = trader?.contractsTonight ?? 0;
    return { name: "Clear the reach and carry its light", complete: booms >= 1 && contracts >= 1 && (got.lantern_color ?? 0) >= 2,
      steps: [step("Boom broken", booms, 1, "boom"), step("Contract or escort", contracts, 1, "bell"),
        step("Colored", got.lantern_color ?? 0, 2, "lantern_color")] };
  }
  return { name: "Light all six boats", complete: lit >= 6, steps: [step("boats lit", lit, 6, "boat")] };
}
