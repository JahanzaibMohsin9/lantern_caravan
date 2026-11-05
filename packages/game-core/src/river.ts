import { items, merchants, recipes, type ItemId, type StallId } from "@lantern/content";
import { strategies } from "@lantern/content/nights";
import { bargeHold, bargeUpgrades, pirateCap, reachIds, reaches, routeDistance, runMs, sourceFor,
  villageGoods, villageIds, villageStrategy, villages, type BargeUpgradeId, type ReachId, type VillageId } from "@lantern/content/river";
import { runReportSchema, type Intent, type LedgerOp, type RunManifest, type RunReport, type Snapshot } from "@lantern/protocol";
import { apply } from "./ledger";
import { addActivity, burn, cashBand, get, merchantIds, mint, move, plan, ratio, shop, stockTargets, type World } from "./model";
import { ask, tradePrice } from "./pricing";

const freight = "r:freight", freightSink = "sys:freight", bounty = "sys:bounty";
export const village = (id: VillageId) => "v:" + id;
const runEscrow = (id: string) => "esc:run:" + id;
const contractEscrow = (id: string) => "esc:contract:" + id;
const lostCargo = (from: string, item: string, qty: number, memo = "Lost to the river"): LedgerOp =>
  ({ ...burn(from, item, qty, memo), sink: "sys:river" });
const applyEffects = (world: World, effects: LedgerOp[]): World =>
  effects.length ? { ...world, ledger: apply(world.ledger, effects), revision: world.revision + 1 } : world;

type Contract = {
  id: string; village: VillageId; item: ItemId; qty: number; payout: number; deadline: number;
  kind: "supply" | "escort"; payer: string; stall: StallId; actor?: string; haul?: string;
};
type CargoLeg = { item: ItemId; qty: number; paid: number; stall?: StallId; unitPrices?: number[] };
type Haul = {
  id: string; actor: string; village: VillageId; destination?: VillageId; cargo: CargoLeg[];
  departs: number; arrives: number; contract?: string; guaranteed?: boolean;
};
type ActiveRun = { actor: string; started: number; manifest: RunManifest };
export type RiverState = {
  reaches: Record<ReachId, { danger: number; boom: boolean; lamps: number; kills: number }>;
  bountyFund: number; runs: Record<string, ActiveRun>; contracts: Record<string, Contract>;
  hauls: Record<string, Haul>; sailings: number; serial: number; random: number;
  supplied: Partial<Record<StallId, Record<string, number>>>;
};

export function freshRiver(seed = 42): RiverState {
  return { reaches: Object.fromEntries(reachIds.map((id, i) => [id, { danger: i === 0 ? 1 : 0, boom: false, lamps: i === 0 ? 4 : 5, kills: 0 }])) as RiverState["reaches"],
    bountyFund: 0, runs: {}, contracts: {}, hauls: {}, sailings: 0, serial: 0, random: seed >>> 0, supplied: {} };
}
const withRiver = (world: World, patch: Partial<RiverState>): World => ({ ...world, river: { ...world.river, ...patch } });
function random(world: World) {
  const seed = (Math.imul(world.river.random, 1664525) + 1013904223) >>> 0;
  return [withRiver(world, { random: seed }), seed / 0x100000000] as const;
}
function changeReach(world: World, id: ReachId, delta: number, boom = world.river.reaches[id].boom, kills = world.river.reaches[id].kills) {
  const danger = Math.max(0, Math.min(5, world.river.reaches[id].danger + delta));
  return withRiver(world, { reaches: { ...world.river.reaches, [id]: { danger, boom, kills, lamps: 5 - danger } } });
}
const stock = (world: World, id: VillageId, item: ItemId) => get(world, village(id), item);
const cost = (world: World, id: VillageId, item: ItemId, qty: number) =>
  tradePrice("buy", items[item].price, stock(world, id, item), villageGoods(id)[item]!, villageStrategy, qty);
const shortage = (world: World, stall: StallId, item: ItemId) =>
  stockTargets(stall)[item]! - get(world, shop(stall), item);
const normal = (stall: StallId, item: ItemId) => ask(items[item].price, stockTargets(stall)[item]!, stockTargets(stall)[item]!).price;
const harvestMint = (to: string, item: string, qty: number): LedgerOp => ({ ...mint(to, item, qty, "Harvest"), source: "sys:harvest" });
const goodsEntries = (id: VillageId) => Object.entries(villageGoods(id)) as [ItemId, number][];

export function harvest(world: World) {
  const effects: LedgerOp[] = [];
  for (const id of villageIds) {
    const account = village(id), cash = get(world, account, "coin");
    if (!cash) effects.push(mint(account, "coin", 40, "Village float"));
    const upkeep = Math.min(Math.max(0, cash - 24), 3 + Math.floor(Math.max(0, cash - 44) / 3));
    if (upkeep && world.mode !== "campaign") effects.push(move(account, freightSink, "coin", upkeep, "Village upkeep"));
    for (const [item, target] of goodsEntries(id)) {
      const qty = target - stock(world, id, item);
      if (qty > 0) effects.push(harvestMint(account, item, qty));
    }
  }
  const pay = 36 - get(world, bounty, "coin");
  if (pay > 0) effects.push(mint(bounty, "coin", pay, "Night bounty fund"));
  const float = 70 - get(world, freight, "coin");
  if (float > 0) effects.push(mint(freight, "coin", float, "Freight operating budget"));
  const next = applyEffects(world, effects);
  return withRiver(next, { bountyFund: get(next, bounty, "coin") });
}

export function starterGoods(world: World, actor: string) {
  return applyEffects(world, (["paper", "oil"] as const).flatMap(item => {
    const provisions = "sys:provisions", reserved = Math.min(2, get(world, provisions, item));
    const id = sourceFor(item)!, extra = Math.min(2 - reserved, stock(world, id, item));
    return [...(reserved ? [move(provisions, actor, item, reserved, "Dock provisions")] : []),
      ...(extra ? [move(village(id), actor, item, extra, "Dock provisions")] : [])];
  }));
}

function authoredFreight(world: World) {
  let state = world;
  for (const stall of merchantIds) {
    for (const [key, target] of Object.entries(stockTargets(stall))) {
      const item = key as ItemId, id = sourceFor(item)!;
      const storm = world.mode === "campaign" && world.night === 2 && stall === "oil_wharf" && item === "oil";
      const qty = shortage(state, stall, item) - (storm ? target - 6 : 0);
      if (qty < 0 && storm) state = applyEffects(state, [move(shop(stall), village(id), item, -qty, "Returned before the storm")]);
      if (qty <= 0) continue;
      const missing = qty - stock(state, id, item);
      if (missing > 0) state = applyEffects(state, [harvestMint(village(id), item, missing)]);
      state = applyEffects(state, [move(village(id), freight, item, qty, "Campaign freight"),
        move(freight, shop(stall), item, qty, "Campaign freight")]);
    }
  }
  if (world.mode === "campaign" && world.night === 2) {
    state = applyEffects(state, [move(village("ember_falls"), freight, "oil", 6, "Storm sailing"),
      lostCargo(freight, "oil", 6, "Oil shipment lost to the storm")]);
    state = addActivity(changeReach(state, "heron_reach", 1), "Freight barge lost 6 oil at Heron Reach.", "Freight");
  }
  return state;
}

export function beginRiverNight(world: World) {
  let state = withRiver(world, { sailings: 0, supplied: {} });
  if (world.night > 1) {
    const [rolled, roll] = random(state);
    const id = reachIds[Math.floor(roll * reachIds.length)]!, reach = rolled.river.reaches[id];
    state = changeReach(rolled, id, 1, reach.boom || (world.mode !== "campaign" && reach.danger >= 2 && world.night % 3 === 0));
  }
  state = harvest(state);
  if (world.night === 1) {
    const slots = world.mode === "live" ? 7 : 3;
    state = applyEffects(state, (["paper", "oil"] as const).map(item =>
      move(village(sourceFor(item)!), "sys:provisions", item, slots * 2, "Opening dock provisions")));
  }
  if (world.mode === "campaign" || world.night === 1) state = authoredFreight(state);
  if (world.mode === "campaign") return world.night >= 2 ? scheduleAmbient(state) : state;
  state = refreshContracts(state);
  if (state.mode === "endless") {
    const actor = Object.keys(state.traders).find(id => id.startsWith("r:"));
    if (actor) state = startRivalHaul(state, actor, 38);
  }
  return scheduleAmbient(scheduleFreight(state, 1));
}

function schedule(world: World, actor: string, id: VillageId, cargo: CargoLeg[], departs: number, seconds: number,
  destination?: VillageId, contract?: Contract) {
  const serial = world.river.serial + 1;
  const haul: Haul = { id: "haul-" + serial, actor, village: id, destination, cargo, departs, arrives: departs + seconds, contract: contract?.id };
  const next = applyEffects(world, cargo.flatMap(({ item, qty, paid }) => [
    move(actor, village(id), "coin", paid, "Haul purchase"), move(village(id), actor, item, qty, "Haul cargo"),
  ]));
  return withRiver(next, { serial, hauls: { ...world.river.hauls, [haul.id]: haul },
    ...(contract ? { contracts: { ...world.river.contracts, [contract.id]: { ...contract, actor } } } : {}) });
}

function inTransit(world: World, stall: StallId, item: ItemId) {
  return Object.values(world.river.hauls).reduce((sum, haul) =>
    sum + haul.cargo.filter(leg => leg.stall === stall && leg.item === item).reduce((n, leg) => n + leg.qty, 0), 0);
}

export function scheduleFreight(world: World, limit = 2) {
  let state = world;
  const needed = villageIds.map(id => {
    const legs = merchantIds.flatMap(stall => goodsEntries(id).flatMap(([item]) => {
      const target = stockTargets(stall)[item];
      const qty = target ? shortage(state, stall, item) - inTransit(state, stall, item) : 0;
      return target && qty > target / 2 && get(state, shop(stall), "coin") >= 5 ? [{ item, qty, stall }] : [];
    }));
    return { id, legs, qty: legs.reduce((a, leg) => a + leg.qty, 0) };
  }).sort((a, b) => b.qty - a.qty);
  for (const { id, legs } of needed) {
    if (!limit || state.river.sailings >= 2 || state.elapsed + 60 > plan(state).duration) break;
    let room = 12, budget = get(state, freight, "coin");
    const cargo: CargoLeg[] = [];
    for (const { item, qty, stall } of legs) {
      const already = cargo.filter(leg => leg.item === item).reduce((a, leg) => a + leg.qty, 0);
      const available = stock(state, id, item) - already, target = villageGoods(id)[item]!;
      const price = (n: number) => tradePrice("buy", items[item].price, available, target, villageStrategy, n);
      let units = Math.min(qty, room, available);
      while (units > 0 && price(units) > budget) units--;
      if (units <= 0) continue;
      const paid = price(units);
      const unitPrices = Array.from({ length: units }, (_, unit) =>
        tradePrice("buy", items[item].price, available - unit, target, villageStrategy, 1));
      cargo.push({ item, qty: units, paid, stall, unitPrices });
      room -= units; budget -= paid;
    }
    if (!cargo.length) continue;
    state = schedule(state, freight, id, cargo, state.elapsed, 60);
    state = withRiver(state, { sailings: state.river.sailings + 1 });
    limit--;
  }
  return state;
}

function scheduleAmbient(world: World) {
  let state = world;
  for (let i = 0; i < 5; i++) {
    const id = villageIds[(i + state.night) % villageIds.length]!;
    const destination = villageIds[(i + state.night + 1) % villageIds.length]!;
    const actor = "r:boat-" + i;
    const [item, target] = goodsEntries(id)[0]!;
    if (stock(state, id, item) <= target / 2) continue;
    const price = tradePrice("sell", items[item].price, get(state, village(destination), item), target, villageStrategy, 1);
    if (get(state, village(destination), "coin") - price < 20) continue;
    state = applyEffects(state, [move(village(destination), actor, "coin", price, "Village boat purchase")]);
    state = schedule(state, actor, id, [{ item, qty: 1, paid: price }], 14 + i * 15, 49 + i * 5, destination);
  }
  return state;
}

const dangerOnRoute = (state: World, id: VillageId) =>
  Math.max(state.river.reaches.heron_reach.danger, state.river.reaches[villages[id].reach].danger);
const routeRisk = (state: World, id: VillageId) => dangerOnRoute(state, id) * .6 +
  [state.river.reaches.heron_reach, state.river.reaches[villages[id].reach]].filter(reach => reach.boom).length * 2;

export function refreshContracts(world: World) {
  if (world.mode === "campaign") return world;
  let state = world;
  const inputs = new Set<ItemId>(plan(world).orders.flatMap(order => Object.values(recipes).filter(recipe => recipe.output === order.item)
    .flatMap(recipe => [...recipe.inputs])));
  for (const stall of merchantIds) {
    const strategy = state.market[stall].strategy, payer = shop(stall), reserve = strategies[strategy].reserve;
    for (const [key, target] of Object.entries(stockTargets(stall))) {
      const item = key as ItemId, id = sourceFor(item)!;
      const open = Object.values(state.river.contracts).filter(contract => contract.kind === "supply" && contract.stall === stall);
      const stock = get(state, payer, item), cash = get(state, payer, "coin");
      if (open.length >= 2 || open.some(contract => contract.item === item) ||
        stock >= target * (strategy === "bold" ? .6 : .5) || cash < reserve * (strategy === "steady" ? 2 : 1) ||
        (strategy === "festival" && !inputs.has(item))) continue;
      const qty = Math.max(3, Math.min(8, target - stock));
      const premium = Math.max(1, 2 + dangerOnRoute(state, id) + Math.ceil(routeDistance(id) / 900) +
        (strategy === "bold" ? 2 : strategy === "festival" ? 1 : strategy === "bargain" ? -1 : 0));
      const payout = qty * normal(stall, item) + premium;
      if (cash - payout < Math.max(10, reserve)) continue;
      state = postContract(state, { village: id, item, qty, payout, payer, stall, deadline: plan(world).duration, kind: "supply" });
    }
  }
  return state;
}

function postContract(world: World, contract: Omit<Contract, "id">) {
  const serial = world.river.serial + 1, id = "bell-" + world.night + "-" + serial;
  const state = applyEffects(world, [move(contract.payer, contractEscrow(id), "coin", contract.payout, "Harbor Bell escrow")]);
  return withRiver(state, { serial, contracts: { ...world.river.contracts, [id]: { ...contract, id } } });
}

export function startRivalHaul(world: World, actor: string, departs = world.elapsed) {
  if (world.mode === "campaign" || get(world, actor, "coin") < 10 ||
    Object.values(world.river.hauls).some(haul => haul.actor === actor)) return world;
  const options = merchantIds.flatMap(stall => Object.keys(stockTargets(stall)).flatMap(key => {
    const item = key as ItemId, id = sourceFor(item)!, target = stockTargets(stall)[item]!;
    const contract = Object.values(world.river.contracts).find(c => !c.actor && c.kind === "supply" && c.stall === stall && c.item === item);
    const needed = shortage(world, stall, item) - inTransit(world, stall, item);
    if (needed <= target / 4) return [];
    const qty = contract?.qty ?? Math.min(6, needed, stock(world, id, item));
    const paid = cost(world, id, item, qty);
    const duration = Math.ceil(routeDistance(id) / 195) + Math.round(routeRisk(world, id) * 3);
    if (!qty || stock(world, id, item) < qty || paid > get(world, actor, "coin") || departs + duration >= plan(world).duration) return [];
    const sale = contract?.payout ?? tradePrice("sell", items[item].price, get(world, shop(stall), item), target, ratio(world, stall), qty);
    if (!contract && get(world, shop(stall), "coin") - sale < 10) return [];
    const score = (sale - paid) / (1 + routeDistance(id) / 1800 + routeRisk(world, id));
    return score > 0 ? [{ stall, item, id, qty, paid, duration, score, contract }] : [];
  })).sort((a, b) => b.score - a.score);
  const route = options[0];
  if (!route) return world;
  let state = schedule(world, actor, route.id, [route], departs, route.duration, undefined, route.contract);
  const name = world.traders[actor]!.name, danger = dangerOnRoute(world, route.id);
  const line = name + ": Hauling " + route.qty + " " + route.item + " from " + villages[route.id].name + " to " + merchants[route.stall].name + ".";
  state = addActivity({ ...state, market: { ...state.market, [route.stall]: { ...state.market[route.stall], thinking: line } } }, line, name);
  const cash = get(state, actor, "coin");
  if (danger >= 2 && cash >= 12) {
    const haul = "haul-" + state.river.serial;
    state = postContract(state, { village: route.id, item: route.item, qty: route.qty, payout: Math.min(Math.floor(cash * .45), 4 + danger * 2),
      payer: actor, stall: route.stall, deadline: departs + route.duration, kind: "escort", haul });
  }
  return state;
}

function removeContract(state: World, contract: Contract, pay = contract.payer) {
  const { [contract.id]: _, ...contracts } = state.river.contracts;
  const amount = get(state, contractEscrow(contract.id), "coin");
  const next = amount ? applyEffects(state, [move(contractEscrow(contract.id), pay, "coin", amount,
    pay === contract.payer ? "Harbor Bell refund" : "Harbor Bell payout")]) : state;
  return withRiver(next, { contracts });
}

export function recordSupply(world: World, stall: StallId, item: ItemId, actor: string, qty: number, paid: number) {
  const name = world.traders[actor]?.name ?? (actor.startsWith("m:") ? merchants[actor.slice(2) as StallId].name : "Freight");
  const providers = world.river.supplied[stall] ?? {};
  const market = world.market[stall];
  const target = stockTargets(stall)[item]!;
  const restored = get(world, shop(stall), item);
  const tight = restored >= target * .25;
  const reopened = market.stockClosed && tight && get(world, shop(stall), "coin") >= 5;
  const state = withRiver({ ...world, market: { ...world.market, [stall]: { ...market, profit: market.profit - paid,
    stockClosed: tight ? false : market.stockClosed,
    thinking: reopened ? "Relit after a haul from " + name + "." : market.thinking } } },
  { supplied: { ...world.river.supplied, [stall]: { ...providers, [name]: (providers[name] ?? 0) + qty } } });
  if (reopened) return addActivity(state, name + " relit " + merchants[stall].name + " with a haul.", name);
  return tight && restored - qty < target * .25
    ? addActivity(state, name + " restored " + items[item].name.toLowerCase() + " stock at " + merchants[stall].name + ".", name) : state;
}

function resolveHaul(world: World, haul: Haul) {
  const { [haul.id]: _, ...hauls } = world.river.hauls;
  const [rolled, roll] = random(withRiver(world, { hauls }));
  let state = rolled;
  const sourceReach = villages[haul.village].reach;
  const otherReach = haul.destination ? villages[haul.destination].reach : "heron_reach";
  const reach = state.river.reaches[otherReach].danger >= state.river.reaches[sourceReach].danger ? otherReach : sourceReach;
  const loss = !haul.guaranteed && roll < state.river.reaches[reach].danger * .04;
  const contract = haul.contract ? state.river.contracts[haul.contract] : undefined;
  for (const { item, qty, paid, stall, unitPrices } of haul.cargo) {
    if (loss) {
      state = addActivity(applyEffects(state, [lostCargo(haul.actor, item, qty)]),
        (haul.actor === freight ? "Freight barge" : state.traders[haul.actor]?.name ?? "Village boat") +
        " lost " + qty + " " + item + " at " + reaches[reach].name + ".");
    } else if (haul.destination) {
      state = applyEffects(state, [move(haul.actor, village(haul.destination), item, qty, "Village boat delivery")]);
    } else if (stall) {
      const account = shop(stall);
      const available = Math.max(0, get(state, account, "coin") - 10);
      if (contract && state.elapsed <= contract.deadline) {
        state = applyEffects(state, [move(haul.actor, account, item, qty, "Supply delivery")]);
        state = recordSupply(removeContract(state, contract, haul.actor), stall, item, haul.actor, qty, contract.payout);
      } else {
        const normalAsk = ask(items[item].price, stockTargets(stall)[item]!, stockTargets(stall)[item]!, ratio(state, stall)).price;
        const freightCost = (n: number) => unitPrices?.slice(0, n).reduce((sum, price) => sum + price, 0) ?? Math.ceil(paid * n / qty);
        const buyerCost = (n: number) => haul.actor === freight
          ? unitPrices?.slice(0, n).reduce((sum, price) => sum + Math.min(normalAsk, price + 1), 0) ??
            Math.min(n * normalAsk, freightCost(n) + n)
          : tradePrice("sell", items[item].price, get(state, account, item), stockTargets(stall)[item]!, ratio(state, stall), n);
        let units = qty;
        while (units > 0 && buyerCost(units) > available) units--;
        const returned = qty - units;
        if (returned) state = applyEffects(state, [move(haul.actor, village(haul.village), item, returned, "Unsold haul")]);
        if (!units) continue;
        const price = buyerCost(units);
        const margin = haul.actor === freight ? Math.max(0, price - freightCost(units)) : 0;
        state = applyEffects(state, [move(haul.actor, account, item, units, "Haul delivery"),
          move(account, haul.actor, "coin", price, "Haul delivery"),
          ...(margin ? [move(haul.actor, freightSink, "coin", margin, "Freight margin")] : [])]);
        state = recordSupply(state, stall, item, haul.actor, units, price);
      }
    }
  }
  if (loss && haul.actor === freight) state = changeReach(state, reach, 1);
  if (loss && contract) state = removeContract(state, contract);
  return state;
}

export function advanceRiver(world: World) {
  let state = world;
  for (const haul of Object.values(world.river.hauls).filter(haul => haul.arrives <= world.elapsed)) state = resolveHaul(state, haul);
  for (const contract of Object.values(state.river.contracts).filter(contract => contract.deadline <= world.elapsed)) state = removeContract(state, contract);
  return state;
}

export function cancelRun(world: World, actor: string) {
  const run = Object.values(world.river.runs).find(run => run.actor === actor);
  if (!run) return world;
  const { [run.manifest.id]: _, ...runs } = world.river.runs;
  let state = withRiver(applyEffects(world, run.manifest.items.map(lot =>
    move(runEscrow(run.manifest.id), village(lot.village as VillageId), lot.item, lot.prices.length, "Run reservation returned"))), { runs });
  const id = run.manifest.contract?.id;
  if (id && state.river.contracts[id]) state = removeContract(state, state.river.contracts[id]!);
  return state;
}

export function closeRiver(world: World) {
  let state = advanceRiver(world);
  for (const { actor } of Object.values(state.river.runs)) state = cancelRun(state, actor);
  for (const haul of Object.values(state.river.hauls)) {
    const { [haul.id]: _, ...hauls } = state.river.hauls;
    state = withRiver(applyEffects(state, haul.cargo.map(({ item, qty }) =>
      move(haul.actor, village(haul.village), item, qty, "Night close cargo return"))), { hauls });
  }
  for (const contract of Object.values(state.river.contracts)) state = removeContract(state, contract);
  return state;
}

type RiverIntent = Extract<Intent, { type: "start_run" | "finish_run" | "accept_contract" | "buy_barge_upgrade" }>;
export const isRiverIntent = (intent: Intent): intent is RiverIntent =>
  intent.type === "start_run" || intent.type === "finish_run" || intent.type === "accept_contract" || intent.type === "buy_barge_upgrade";

function availableContract(world: World, actor: string, id: string) {
  const contract = Object.hasOwn(world.river.contracts, id) ? world.river.contracts[id] : undefined;
  if (!contract || contract.deadline <= world.elapsed || (contract.actor && contract.actor !== actor))
    throw new Error("RIVER_CONTRACT_UNAVAILABLE · This Harbor Bell contract is unavailable.");
  if (Object.values(world.river.contracts).some(entry => entry.id !== id && entry.actor === actor))
    throw new Error("RIVER_CONTRACT_LIMIT · Complete your current contract first.");
  return contract;
}

function rowGlow(world: World) {
  const light = { dark: 0, tight: .3, healthy: .66, thriving: 1 };
  const health = merchantIds.reduce((sum, stall) => sum + (world.market[stall].stockClosed ? 0 : light[cashBand(get(world, shop(stall), "coin"))]), 0);
  const lit = plan(world).orders.filter(order => world.orderContributors[order.id]?.length && !get(world, "esc:order:" + order.id, "coin")).length;
  return .4 * health / merchantIds.length + .6 * lit / 6;
}

function runManifest(world: World, actor: string, intent: Extract<RiverIntent, { type: "start_run" }>, id: string, now: number) {
  const upgrades = world.traders[actor]!.upgrades, hold = bargeHold(upgrades);
  if (intent.escort_id && intent.contract_id) throw new Error("RIVER_CONTRACT_LIMIT · Choose one Harbor Bell contract.");
  const requested = intent.escort_id ?? intent.contract_id ?? Object.values(world.river.contracts).find(c => c.actor === actor)?.id;
  const contract = requested ? availableContract(world, actor, requested) : undefined;
  if ((intent.escort_id && contract?.kind !== "escort") || (intent.contract_id && contract?.kind !== "supply"))
    throw new Error("RIVER_CONTRACT_UNAVAILABLE · The contract type does not match the request.");
  let orders = intent.barge_plan;
  if (contract?.kind === "supply") {
    const matching = orders.filter(order => order.item_id === contract.item && order.village_id === contract.village);
    const explicit = matching.reduce((sum, order) => Math.min(hold, sum + Number(order.quantity)), 0);
    orders = [{ village_id: contract.village, item_id: contract.item, quantity: String(Math.max(contract.qty, explicit)) },
      ...orders.filter(order => !matching.includes(order))];
  }
  const reserved = new Map<ItemId, number>();
  let room = hold;
  for (const order of orders) {
    const item = order.item_id as ItemId, id = sourceFor(item);
    if (!id || id !== order.village_id) throw new Error("RIVER_PLAN · This village does not grow that item.");
    const qty = Math.min(Number(order.quantity), room, stock(world, id, item) - (reserved.get(item) ?? 0));
    if (qty) reserved.set(item, (reserved.get(item) ?? 0) + qty);
    room -= qty;
  }
  if (contract?.kind === "supply" && (reserved.get(contract.item) ?? 0) < contract.qty)
    throw new Error("RIVER_PLAN · The village is short on stock for that contract.");
  const boats = Object.values(world.river.hauls).map(haul => ({
    id: haul.id, village: haul.village, destination: haul.destination,
    name: world.traders[haul.actor]?.name ?? (haul.destination ? "Village boat" : "Freight"),
    ambient: !!haul.destination, departs: haul.departs - world.elapsed, arrives: haul.arrives - world.elapsed,
  }));
  const manifest: RunManifest = { id, seed: (world.river.random ^ Math.imul(world.revision + 1, 0x45d9f3b)) >>> 0,
    deadline: now + runMs, wallet: get(world, actor, "coin"), hold, upgrades, boats, bounty: get(world, bounty, "coin"),
    glow: rowGlow(world),
    reaches: reachIds.map(id => ({ id, danger: world.river.reaches[id].danger, boom: world.river.reaches[id].boom })),
    contract: contract && { id: contract.id, village: contract.village, item: contract.item, quantity: contract.qty,
      payout: contract.payout, kind: contract.kind, haul: contract.haul },
    items: [...reserved].map(([item, qty]) => {
      const id = sourceFor(item)!, target = villageGoods(id)[item]!, count = stock(world, id, item);
      return { village: id, item, stock: count, target, coins: get(world, village(id), "coin"),
        discount: (world.traders[actor]!.relationship[id] ?? 0) >= 3,
        prices: Array.from({ length: qty }, (_, n) => tradePrice("buy", items[item].price, count - n, target, villageStrategy, 1)) };
    }) };
  return manifest;
}

export class InvalidRun extends Error {}
function reject(code: string, message: string): never { throw new InvalidRun(code + " · " + message); }
const unique = (keys: string[]) => new Set(keys).size === keys.length;

function finishRun(world: World, actor: string, id: string, report: RunReport, now: number) {
  const run = Object.hasOwn(world.river.runs, id) ? world.river.runs[id] : undefined;
  if (!run || run.actor !== actor) throw new Error("RIVER_RUN_UNKNOWN · This run is unavailable.");
  const manifest = run.manifest;
  if (!runReportSchema.safeParse(report).success || report.run_id !== id || report.seed !== manifest.seed)
    reject("RIVER_REPORT", "The report does not match this run.");
  if (now - run.started < report.durationMs * .9 || report.durationMs > runMs ||
    (report.outcome === "towed" && report.durationMs !== runMs))
    reject("RIVER_TIME", "The run timer does not match.");
  const reserved = new Set(manifest.items.map(lot => lot.item));
  if (!unique(report.bought.map(entry => entry.item_id)) || !unique(report.soldBack.map(entry => entry.item_id)) ||
    ![...Object.keys(report.delivered), ...Object.keys(report.lost), ...report.bought.map(entry => entry.item_id),
      ...report.soldBack.map(entry => entry.item_id)].every(item => reserved.has(item)) ||
    (report.flaresUsed && !reserved.has("oil"))) reject("RIVER_CARGO", "The report contains unknown or repeated cargo.");
  const effects: LedgerOp[] = [];
  const contract = manifest.contract && world.river.contracts[manifest.contract.id];
  if (!unique(report.pirates.map(entry => entry.reach)) || !unique(report.boomsBroken) ||
    report.pirates.some(entry => entry.count > pirateCap(manifest.reaches.find(reach => reach.id === entry.reach)?.danger ?? 0, report.durationMs / 1000)) ||
    report.boomsBroken.some(id => !manifest.reaches.some(reach => reach.id === id && reach.boom)))
    reject("RIVER_COMBAT", "The combat report exceeds the run's hazards.");
  const saved = report.savedBoats ?? [];
  if (!unique(saved) || saved.some(id => !manifest.boats.some(boat => boat.id === id && boat.ambient && boat.arrives * 1000 <= report.durationMs + 1)))
    reject("RIVER_BOAT", "The village boat report does not match.");
  if (report.escort && (manifest.contract?.kind !== "escort" || manifest.contract.id !== report.escort.id ||
    (report.escort.completed && !manifest.boats.some(boat => boat.id === manifest.contract?.haul && boat.arrives * 1000 <= report.durationMs + 1))))
    reject("RIVER_ESCORT", "The escort report does not match.");
  const reward = Math.min(get(world, bounty, "coin"), report.pirates.reduce((n, entry) => n + entry.count * 3, 0) +
    report.boomsBroken.filter(id => world.river.reaches[id as ReachId].boom).length * 4 + saved.length);
  if (reward) effects.push(move(bounty, actor, "coin", reward, "River bounty"));
  for (const lot of manifest.items) {
    const account = village(lot.village as VillageId), source = runEscrow(id);
    const buy = report.bought.find(entry => entry.item_id === lot.item), sell = report.soldBack.find(entry => entry.item_id === lot.item);
    const bought = buy?.quantity ?? 0, sold = sell?.quantity ?? 0;
    const delivered = report.delivered[lot.item] ?? 0, lost = report.lost[lot.item] ?? 0, flare = lot.item === "oil" ? report.flaresUsed : 0;
    if (bought !== sold + delivered + lost + flare || bought > lot.prices.length || (buy && buy.village_id !== lot.village) ||
      (sell && sell.village_id !== lot.village)) reject("RIVER_CARGO", "The cargo does not balance against the manifest.");
    const paid = lot.prices.slice(0, bought).reduce((a, b) => a + b, 0) - Number(lot.discount && bought >= 4);
    const received = tradePrice("sell", items[lot.item as ItemId].price, lot.stock, lot.target, villageStrategy, sold);
    if (paid !== (buy?.paid ?? 0) || received !== (sell?.received ?? 0)) reject("RIVER_PRICE", "A reported price differs from the manifest.");
    if (received > get(world, account, "coin") + paid) reject("RIVER_FUNDS", "The village cannot cover the buyback.");
    if (bought) {
      // Net the legs because earlier buybacks can fund a later purchase.
      if (paid > received) effects.push(move(actor, account, "coin", paid - received, "Village purchases"));
      if (received > paid) effects.push(move(account, actor, "coin", received - paid, "Village buyback"));
      effects.push(move(source, actor, lot.item, bought, "Loaded cargo"));
    }
    if (sold) effects.push(move(actor, account, lot.item, sold, "Village buyback"));
    if (lost) effects.push(lostCargo(actor, lot.item, lost));
    if (flare) effects.push(lostCargo(actor, "oil", flare, "Flare"));
    if (lot.prices.length > bought) effects.push(move(source, account, lot.item, lot.prices.length - bought, "Unused run reservation"));
  }
  const deliveredContract = contract && contract.actor === actor && world.elapsed < contract.deadline &&
    ((contract.kind === "supply" && report.outcome === "moored" && (report.delivered[contract.item] ?? 0) >= contract.qty) ||
      (contract.kind === "escort" && report.escort?.completed));
  const delta = effects.reduce((coins, op) => coins + (op.op === "transfer" && op.asset === "coin"
    ? Number(op.amount) * (Number(op.to === actor) - Number(op.from === actor)) : 0), 0);
  if (get(world, actor, "coin") + delta < 0) reject("RIVER_FUNDS", "The barge cannot cover its purchases.");
  const payout = deliveredContract ? contract.payout : 0;
  if (contract) {
    if (payout && contract.kind === "supply") effects.push(move(actor, shop(contract.stall), contract.item, contract.qty, "Supply contract delivery"));
    effects.push(move(contractEscrow(contract.id), payout ? actor : contract.payer, "coin", contract.payout,
      payout ? "Harbor Bell payout" : "Harbor Bell refund"));
  }
  const tow = report.outcome === "moored" ? 0 : Math.min(2, get(world, actor, "coin") + delta + payout);
  if (tow) effects.push(move(actor, freightSink, "coin", tow, "River tow"));
  const earlyCredit = (op: LedgerOp) => Number(op.op === "transfer" && op.to === actor && op.asset === "coin" && op.memo !== "Harbor Bell payout");
  effects.sort((a, b) => earlyCredit(b) - earlyCredit(a));
  return { effects, contract, payout, run, summary: report.outcome === "moored" ? "Moored at The Landing" :
    report.outcome === "towed" ? "Towed to The Landing" : "Rescued after sinking" };
}

export function riverQuote(world: World, actor: string, intent: RiverIntent, id: string, now: number) {
  if (world.mode === "live") throw new Error("River Run is available in local profiles.");
  if (world.phase !== "preparation") throw new Error("Cast off during preparation.");
  if (world.mode === "campaign" && world.night === 1) throw new Error("The barge is under repair until Night 2.");
  if (Object.values(world.river.runs).some(run => run.actor === actor) && intent.type !== "finish_run")
    throw new Error("Your barge is already upriver.");
  if (intent.type === "accept_contract") {
    availableContract(world, actor, intent.contract_id);
    return { effects: [], summary: "Harbor Bell contract accepted" };
  }
  if (intent.type === "buy_barge_upgrade") {
    const id = intent.upgrade_id as BargeUpgradeId;
    const upgrade = Object.hasOwn(bargeUpgrades, id) ? bargeUpgrades[id] : undefined;
    const owned = world.traders[actor]!.upgrades;
    if (!upgrade || owned.includes(id) || (id.endsWith("_ii") && !owned.includes(id.replace("_ii", "_i") as BargeUpgradeId)))
      throw new Error("That barge upgrade is unavailable.");
    if (get(world, actor, "coin") < upgrade.price) throw new Error("You’re short on coins.");
    return { effects: [move(actor, freightSink, "coin", upgrade.price, upgrade.name)], summary: "Installed " + upgrade.name };
  }
  if (intent.type === "finish_run") return finishRun(world, actor, intent.run_id, intent.report, now);
  const manifest = runManifest(world, actor, intent, id, now);
  return { effects: manifest.items.map(lot =>
    move(village(lot.village as VillageId), runEscrow(id), lot.item, lot.prices.length, "Run reservation")), summary: "Cast off from The Landing" };
}

export function commitRiver(prior: World, world: World, actor: string, intent: RiverIntent, id: string, now: number) {
  const trader = world.traders[actor]!;
  if (intent.type === "buy_barge_upgrade") return { ...world, traders: { ...world.traders,
    [actor]: { ...trader, upgrades: [...trader.upgrades, intent.upgrade_id as BargeUpgradeId] } } };
  if (intent.type === "accept_contract") {
    const contract = availableContract(prior, actor, intent.contract_id);
    return withRiver(world, { contracts: { ...world.river.contracts, [contract.id]: { ...contract, actor } } });
  }
  if (intent.type === "start_run") {
    const manifest = runManifest(prior, actor, intent, id, now);
    const contract = manifest.contract && world.river.contracts[manifest.contract.id];
    return withRiver(world, { runs: { ...world.river.runs, [id]: { actor, started: now, manifest } },
      ...(contract ? { contracts: { ...world.river.contracts, [contract.id]: { ...contract, actor } } } : {}) });
  }
  const { run, contract, payout } = finishRun(prior, actor, intent.run_id, intent.report, now);
  const { [intent.run_id]: _, ...runs } = world.river.runs;
  let state = withRiver(world, { runs, bountyFund: get(world, bounty, "coin") });
  const report = intent.report;
  const relationship = { ...trader.relationship };
  const befriend = (id: VillageId) => { relationship[id] = Math.min(10, (relationship[id] ?? 0) + 1); };
  for (const entry of report.bought) befriend(entry.village_id as VillageId);
  for (const id of report.savedBoats ?? []) {
    befriend(run.manifest.boats.find(boat => boat.id === id)!.village as VillageId);
    const haul = state.river.hauls[id];
    if (haul) state = resolveHaul(state, { ...haul, guaranteed: true });
  }
  for (const { reach, count } of report.pirates) {
    const id = reach as ReachId, kills = state.river.reaches[id].kills + count;
    state = changeReach(state, id, -Math.floor(kills / 3), state.river.reaches[id].boom, kills % 3);
  }
  for (const reach of report.boomsBroken) {
    const id = reach as ReachId;
    if (!state.river.reaches[id].boom) continue;
    state = addActivity(changeReach(state, id, -2, false), trader.name + " broke the boom at " + reaches[id].name + ".", trader.name);
  }
  if (contract) {
    const { [contract.id]: _, ...contracts } = state.river.contracts;
    state = withRiver(state, { contracts });
    if (payout && contract.kind === "supply") {
      befriend(contract.village);
      state = recordSupply(state, contract.stall, contract.item, actor, contract.qty, payout);
      state = addActivity(state, trader.name + " filled a supply contract for " + merchants[contract.stall].name + ".", trader.name);
    }
    const haul = contract.haul && state.river.hauls[contract.haul];
    if (payout && haul) {
      state = resolveHaul(state, { ...haul, guaranteed: true });
      state = addActivity(state, trader.name + " escorted " + world.traders[haul.actor]?.name + " safely to The Landing.", trader.name);
    }
  }
  return { ...state, traders: { ...state.traders, [actor]: { ...trader, relationship, lastStop: "shed" } } };
}

export function riverSnapshot(world: World, actor: string): Pick<Snapshot, "villages" | "river" | "barge"> {
  const trader = world.traders[actor], upgrades = trader?.upgrades.filter(id => Object.hasOwn(bargeUpgrades, id)) ?? [];
  const run = Object.values(world.river.runs).find(run => run.actor === actor);
  return {
    villages: Object.fromEntries(villageIds.map(id => {
      const coins = get(world, village(id), "coin");
      return [id, { coins: String(coins), band: cashBand(coins), relationship: trader?.relationship[id] ?? 0,
        stock: Object.fromEntries(goodsEntries(id).map(([item]) => [item, String(stock(world, id, item))])),
        prices: Object.fromEntries(goodsEntries(id).map(([item, target]) => {
          const count = stock(world, id, item), hint = ask(items[item].price, count, target, villageStrategy);
          return [item, { buy: String(hint.price), sell: String(tradePrice("sell", items[item].price, count, target, villageStrategy, 1)), label: hint.label }];
        })) }];
    })),
    river: {
      reaches: reachIds.map(id => ({ id, name: reaches[id].name, ...world.river.reaches[id] })),
      bountyFund: String(get(world, bounty, "coin")),
      contracts: Object.values(world.river.contracts).map(contract => ({ id: contract.id, stall: contract.stall,
        village: contract.village, item: contract.item, quantity: String(contract.qty), payout: String(contract.payout),
        deadline: contract.deadline, kind: contract.kind, mine: contract.actor === actor, taken: !!contract.actor && contract.actor !== actor })),
      myRun: run && { id: run.manifest.id, deadline: run.manifest.deadline, manifest: run.manifest },
      upriver: Object.values(world.river.runs).map(run => ({ actor: run.actor, name: world.traders[run.actor]!.name })),
    },
    barge: { hold: String(bargeHold(upgrades)), upgrades },
  };
}
