import { items, merchants, recipes, wishes, type ItemId, type RecipeId, type StallId } from "@lantern/content";
import { strategies, type FestivalOrder, type StrategyId, type UpgradeId } from "@lantern/content/nights";
import { sourceFor } from "@lantern/content/river";
import { intentSchema, type Intent, type LedgerOp, type Quote, type Snapshot } from "@lantern/protocol";
import { apply } from "./ledger";
import { ask, explainPrice, tradePrice } from "./pricing";
import {
  addActivity, burn, canTakeJob, cart, cartCapacity, cashBand, crowd, escrow, get, getTrader, itemIds, merchantIds,
  mint, move, nightId, nowAt, objective, orderPayout, plan, player, ratio, remaining, rescue, share, shop,
  stockTargets, supply, unlock, type Trader, type World,
} from "./model";
import { addTrader } from "./model";
import { afterOwnership, bookValue, buybackPrice, closeOwnership, owners, ownershipQuote, pledged, refreshOfferings } from "./ownership";

export { createWorld, newNight, addTrader, addActivity, capacity, duration, player, crowd, nightId, nowAt, objective, plan, type World } from "./model";
export { openNight } from "./ownership";
export { cancelRun, InvalidRun, isRiverIntent } from "./river";
import { advanceRiver, closeRiver, commitRiver, hasOpenBellOrder, isRiverIntent, recordSupply, refreshContracts, riverQuote,
  riverSnapshot, scheduleFreight, startRivalHaul } from "./river";

function phaseCheck(state: World, intent: Intent) {
  if (isRiverIntent(intent)) return;
  if (intent.type === "vote_strategy" || intent.type === "buy_upgrade") {
    if (state.phase !== "preparation") throw new Error("Do that during preparation.");
  } else if (state.phase !== "open" || state.elapsed >= plan(state).duration) {
    throw new Error("The market is closed.");
  }
}

export function quoteFor(state: World, actor: string, raw: Intent, id: string, now: number, agreedTotal?: number): Quote {
  const intent = intentSchema.parse(raw);
  phaseCheck(state, intent);
  const trader = getTrader(state, actor);
  if (isRiverIntent(intent)) {
    const { effects, summary } = riverQuote(state, actor, intent, id, now);
    apply(state.ledger, effects);
    return { quote_id: id, intent, summary, effects, expires_at: now + 15000 };
  }
  if (Object.values(state.river.runs).some(run => run.actor === actor)) throw new Error("Moor the barge first.");
  const quantity = "quantity" in intent ? Number(intent.quantity) : 0;
  // Selling empties the hold, so only buying and crafting are limited by it.
  if (intent.type !== "sell" && quantity > cartCapacity(trader)) throw new Error(`Your cart holds ${cartCapacity(trader)} items.`);
  let effects: LedgerOp[];
  let summary: string;

  switch (intent.type) {
    case "buy":
    case "sell": {
      const stall = intent.stall_id as StallId;
      const item = intent.item_id as ItemId;
      const account = shop(stall);
      if (!Object.hasOwn(merchants, stall) || !Object.hasOwn(stockTargets(stall), item)) throw new Error("This stall doesn’t trade that item.");
      if (cashBand(get(state, account, "coin")) === "dark") throw new Error("This stall is closed.");
      if (intent.type === "buy" && state.market[stall].stockClosed) throw new Error("This stall needs a fresh haul to reopen.");
      const stock = get(state, account, item);
      const buying = intent.type === "buy";
      const from = buying ? account : actor;
      const to = buying ? actor : account;
      const total = agreedTotal ?? tradePrice(intent.type, items[item].price, stock, stockTargets(stall)[item]!, ratio(state, stall), quantity, !!sourceFor(item));
      if (get(state, from, item) < quantity) throw new Error(buying ? "The stall is low on stock." : "You don’t have enough to sell.");
      if (get(state, to, "coin") < total) throw new Error(buying ? "You’re short on coins." : "The stall is short on coins.");
      summary = `${buying ? "Buy" : "Sell"} ${quantity} · ${total} coins`;
      effects = [move(from, to, item, quantity, summary), move(to, from, "coin", total, summary)];
      break;
    }
    case "craft": {
      const id = intent.recipe_id as RecipeId;
      const recipe = Object.hasOwn(recipes, id) ? recipes[id] : undefined;
      if (!recipe || recipe.unlock > unlock(state)) throw new Error("This recipe unlocks on a later night.");
      if ((recipe.inputs as readonly ItemId[]).some(item => get(state, actor, item) < quantity)) {
        throw new Error(id === "paper_lantern" ? "You need paper and oil." : "Your cart is missing ingredients.");
      }
      summary = `Craft ${quantity} · ${items[recipe.output].name}`;
      effects = [...recipe.inputs.map(item => burn(actor, item, quantity, summary)), mint(actor, recipe.output, quantity, summary)];
      break;
    }
    case "fill_order": {
      const order = plan(state).orders.find(entry => entry.id === intent.order_id);
      if (!order || state.elapsed < order.opens) throw new Error("This order hasn’t opened yet.");
      if (order.personal && actor.startsWith("r:")) throw new Error("This order is reserved for the player.");
      if (remaining(state, order) < quantity) throw new Error("The boat already has those lanterns.");
      if (get(state, actor, order.item) < quantity) throw new Error(`Craft more ${items[order.item].name.toLowerCase()}s first.`);
      if (intent.wish_id && !wishes.includes(intent.wish_id as typeof wishes[number])) throw new Error("Choose a wish from the list.");
      const total = quantity * orderPayout(state, order);
      summary = `Deliver ${quantity} · ${total} coins`;
      effects = [move(actor, "sys:festival", order.item, quantity, summary), move(escrow(order.id), actor, "coin", total, summary)];
      break;
    }
    case "sell_crowd": {
      if (plan(state).events.some(event => event.id === "quiet_patch" && state.elapsed >= event.at && state.elapsed < event.at + 45)) {
        throw new Error("The crowd is taking a short break.");
      }
      const item = intent.item_id as ItemId;
      if (!itemIds.includes(item) || !item.startsWith("lantern_") || get(state, actor, item) < quantity) throw new Error("You need lanterns to sell.");
      if (trader.crowdSold + quantity > 6) throw new Error("You’ve reached the crowd’s nightly limit.");
      const total = items[item].price * quantity;
      if (get(state, crowd, "coin") < total) throw new Error("The crowd has spent its budget.");
      summary = `Sell ${quantity} · ${total} coins`;
      effects = [move(actor, crowd, item, quantity, summary), move(crowd, actor, "coin", total, summary)];
      break;
    }
    case "start_job": {
      if (!canTakeJob(state, actor)) throw new Error("No dock job is available.");
      summary = "Parcel picked up";
      effects = [];
      break;
    }
    case "finish_job": {
      if (trader.job?.id !== intent.job_id || state.elapsed < trader.job.readyAt) throw new Error("Give the boat time to dock.");
      summary = "Parcel delivered · 4 coins";
      effects = [move(rescue, actor, "coin", 4, summary)];
      break;
    }
    default:
      ({ effects, summary } = ownershipQuote(state, actor, intent, id));
  }

  if (effects.some(effect => effect.op !== "mint" && effect.from === actor && effect.asset === "coin" &&
    Number(effect.amount) > get(state, actor, "coin"))) throw new Error("You’re short on coins.");
  if (cart(apply(state.ledger, effects), actor) > Math.max(cartCapacity(trader), cart(state.ledger, actor))) throw new Error("Your cart is full.");
  return { quote_id: id, intent, summary, effects, expires_at: now + 15000 };
}

export const quote = (state: World, intent: Intent, id: string, now: number, agreedTotal?: number) =>
  quoteFor(state, player, intent, id, now, agreedTotal);

export function validateQuote(state: World, actor: string, deal: Quote, baseline: LedgerOp[], now: number) {
  if (now >= deal.expires_at) throw new Error("Quote expired. Ask for a fresh price.");
  const current = quoteFor(state, actor, deal.intent, deal.quote_id, now);
  if (JSON.stringify(current.effects) !== JSON.stringify(baseline)) throw new Error("The market changed. Ask for a fresh quote.");
}

function setTrader(state: World, actor: string, trader: Trader): World {
  return { ...state, traders: { ...state.traders, [actor]: trader } };
}

export function commitFor(state: World, actor: string, deal: Quote, now: number): World {
  if (now >= deal.expires_at) throw new Error("Quote expired. Ask for a fresh price.");
  phaseCheck(state, deal.intent);
  const ledger = apply(state.ledger, deal.effects);
  const old = getTrader(state, actor);
  if (!isRiverIntent(deal.intent) && cart(ledger, actor) > Math.max(cartCapacity(old), cart(state.ledger, actor))) throw new Error("Your cart is full.");
  const trader: Trader = { ...old };
  let next: World = { ...state, ledger, revision: state.revision + 1 };
  const intent = deal.intent;
  const quantity = "quantity" in intent ? Number(intent.quantity) : 0;
  for (const effect of deal.effects) {
    if (effect.op === "transfer" && effect.asset === "coin") {
      if (effect.to === actor) trader.earned += Number(effect.amount);
      if (effect.from === actor) trader.spent += Number(effect.amount);
    }
  }
  if (isRiverIntent(intent)) return commitRiver(state, setTrader(next, actor, trader), actor, intent, deal.quote_id, now);
  switch (intent.type) {
    case "buy":
    case "sell": {
      const stall = intent.stall_id as StallId;
      const item = intent.item_id as ItemId;
      const prior = state.market[stall];
      const buying = intent.type === "buy";
      const total = Number(deal.effects[1]!.amount);
      const stock = get(state, shop(stall), item);
      const target = stockTargets(stall)[item]!;
      const price = ask(items[item].price, buying ? stock : stock + quantity, target, ratio(state, stall));
      const fair = price.label === "Normal" && total === tradePrice(intent.type, items[item].price, stock, target, ratio(state, stall), quantity, !!sourceFor(item)) &&
        (trader.fair[stall] ?? 0) < 2;
      const change = !buying && price.label === "Flooded" ? -1 : fair ? 1 : 0;
      if (fair) trader.fair = { ...trader.fair, [stall]: (trader.fair[stall] ?? 0) + 1 };
      if (change) trader.relationship = { ...trader.relationship, [stall]: Math.max(-5, Math.min(10, (trader.relationship[stall] ?? 0) + change)) };
      trader.lastStop = stall;
      const empty = buying && Object.keys(stockTargets(stall)).every(key => !get(next, shop(stall), key));
      next.market = { ...state.market, [stall]: { ...prior, profit: prior.profit + (buying ? total : 0),
        unitsSold: prior.unitsSold + (buying ? quantity : 0), stockClosed: prior.stockClosed || empty,
        thinking: empty ? "Out of goods. The stall is waiting for a haul." : prior.thinking } };
      if (empty) next = addActivity(next, merchants[stall].name + " ran out of goods.");
      if (!buying) next = recordSupply(next, stall, item, actor, quantity, total);
      if (!buying && sourceFor(item)) trader.soldTonight += quantity;
      break;
    }
    case "craft":
      trader.crafted += quantity;
      trader.lifetimeCrafted += quantity;
      trader.lastStop = "workshop";
      break;
    case "sell_crowd":
      trader.crowdSold += quantity;
      trader.lastStop = "lantern_house";
      break;
    case "fill_order": {
      const order = plan(state).orders.find(order => order.id === intent.order_id)!;
      trader.delivered = { ...old.delivered, [order.item]: (old.delivered[order.item] ?? 0) + quantity };
      trader.lastStop = "board";
      const contributors = [...new Set([...(state.orderContributors[order.id] ?? []), actor])];
      next.orderContributors = { ...state.orderContributors, [order.id]: contributors };
      if (intent.wish_id) {
        next.orderWishes = { ...state.orderWishes,
          [order.id]: [...(state.orderWishes[order.id] ?? []), ...Array<string>(quantity).fill(intent.wish_id)] };
        next.wishAuthors = { ...state.wishAuthors,
          [order.id]: [...(state.wishAuthors[order.id] ?? []), ...Array<string>(quantity).fill(trader.name)] };
        next = addActivity(next, `${order.name} carries a wish: “${intent.wish_id}”`, trader.name);
      }
      next = setTrader(next, actor, trader);
      if (!remaining(next, order)) {
        for (const id of contributors) {
          const holder = next.traders[id]!;
          next = setTrader(next, id, { ...holder, boatsHelped: holder.boatsHelped + 1 });
        }
        next = addActivity(next, `${order.name} is lit.`, trader.name);
      }
      return next;
    }
    case "vote_strategy":
      trader.votes = { ...old.votes, [intent.stall_id]: intent.strategy_id as StrategyId };
      break;
    case "buy_upgrade":
      trader.upgrades = [...trader.upgrades, intent.upgrade_id as UpgradeId];
      break;
    case "start_job":
      trader.job = { id: deal.quote_id, readyAt: state.elapsed + 20 };
      break;
    case "finish_job":
      delete trader.job;
      trader.jobsDone++;
      trader.lastStop = "shed";
      break;
  }
  next = afterOwnership(state, setTrader(next, actor, trader), actor, intent, deal.quote_id);
  if (intent.type === "accept_buyback") next = addActivity(next, deal.summary, trader.name);
  return state.phase === "open" ? refreshOfferings(next) : next;
}

export const commit = (state: World, deal: Quote, now: number) => commitFor(state, player, deal, now);

/**
 * Simulator only: a trader dumps `quantity` of a good on one stall, one unit at a time, through the normal quote and
 * commit path, so every price it gets comes from the pricing rules. It stops when the stall runs out of coins.
 */
export function floodMarket(world: World, stall: StallId, item: ItemId, quantity: number) {
  const actor = "sim:flood";
  let state = addTrader(world, actor, "Flood trader");
  state = { ...state, ledger: apply(state.ledger, [mint(actor, item, quantity, "Simulated flood")]) };
  let sold = 0, coins = 0;
  for (; sold < quantity; sold++) {
    const now = nowAt(state);
    try {
      const deal = quoteFor(state, actor, { type: "sell", stall_id: stall, item_id: item, quantity: "1" }, `flood-${state.revision}`, now);
      state = commitFor(state, actor, deal, now);
      coins += Number(deal.effects[1]!.amount);
    } catch {
      break;
    }
  }
  const line = `Flood: ${sold} ${items[item].name.toLowerCase()} dumped on ${merchants[stall].name} for ${coins} coins.`;
  return { world: addActivity(state, line), sold, coins };
}

export function recordAction(state: World, actor: string, line: string, receipt: NonNullable<Snapshot["activity"][number]["receipt"]>) {
  const next = addActivity(state, line, state.traders[actor]?.name);
  const entry = next.activity.at(-1)!;
  entry.receipt = receipt;
  return next;
}

export function closeNight(state: World): World {
  if (state.phase !== "open") return state;
  const closed = closeOwnership(closeRiver(state));
  return { ...closed, phase: "results", revision: closed.revision + 1 };
}

export function snapshotFor(state: World, session_id: string, actor = player, server_time = 0): Snapshot {
  const trader = state.traders[actor];
  const schedule = plan(state);
  const titles = [];
  if (trader?.boatsHelped) titles.push("Lamplighter");
  if (trader?.rescued) titles.push("Patron");
  if (trader && merchantIds.filter(stall => owners(state, stall)[actor]).length >= 3) titles.push("Shareholder");
  if (trader && ((state.mode === "campaign" && state.night === 4 && state.phase === "results" && objective(state, actor).complete)
    || state.mode === "endless")) titles.push("Master of the Row");
  return {
    ...riverSnapshot(state, actor),
    session_id, night_id: nightId(state), night: state.night, nightName: schedule.name, mode: state.mode, seed: state.seed, server_time,
    revision: state.revision, phase: state.phase, elapsed: state.elapsed, duration: schedule.duration,
    coins: String(get(state, actor, "coin")), capacity: String(trader ? cartCapacity(trader) : 0), upgrades: trader?.upgrades ?? [],
    cargo: Object.fromEntries(itemIds.map(item => [item, String(get(state, actor, item))])),
    merchants: Object.fromEntries(merchantIds.map(stall => {
      const account = shop(stall);
      const market = state.market[stall];
      const holders = owners(state, stall);
      const offer = Object.values(state.offers).find(offer => offer.stall === stall);
      const buyback = buybackPrice(state, stall);
      return [stall, {
        band: market.stockClosed ? "dark" : cashBand(get(state, account, "coin")), stockClosed: market.stockClosed, coins: String(get(state, account, "coin")), strategy: market.strategy, vote: trader?.votes[stall],
        suppliedBy: Object.entries(state.river.supplied[stall] ?? {}).map(([name, quantity]) => ({ name, quantity: String(quantity) })),
        thinking: market.thinking, relationship: trader?.relationship[stall] ?? 0,
        owned: String(holders[actor] ?? 0), shareholders: Object.entries(holders).filter(([, amount]) => amount)
          .map(([owner, amount]) => ({ name: state.traders[owner]!.name, count: String(amount) })),
        bookValue: String(supply(state, share(stall)) ? Math.floor(bookValue(state, stall)) : 0),
        sharePrice: String(market.lastSharePrice), dividend: String(trader?.dividends[stall] ?? 0),
        dividendHistory: market.dividendHistory.map(String),
        offering: offer ? { id: offer.id, kind: offer.kind, price: String(offer.price), total: String(offer.total),
          left: String(offer.total - pledged(offer)), available: String(Math.min(offer.total - pledged(offer), 2 - (offer.contributions[actor] ?? 0))),
          ends: offer.ends } : undefined,
        buyback: buyback && get(state, actor, share(stall)) ? { id: `buyback-${stall}`, price: String(buyback) } : undefined,
        stock: Object.fromEntries(Object.keys(stockTargets(stall)).map(item => [item, String(get(state, account, item))])),
        prices: Object.fromEntries(Object.entries(stockTargets(stall)).map(([key, target]) => {
          const item = key as ItemId;
          const stock = get(state, account, item);
          const { price, label } = ask(items[item].price, stock, target, ratio(state, stall));
          return [item, { buy: String(price), sell: String(tradePrice("sell", items[item].price, stock, target, ratio(state, stall), 1, !!sourceFor(item))), label, target: String(target),
            why: explainPrice(items[item].price, stock, target, ratio(state, stall), !!sourceFor(item)) }];
        })),
      }];
    })),
    orders: schedule.orders.map(order => {
      const count = remaining(state, order);
      const filled = count === 0 && !!state.orderContributors[order.id]?.length;
      const expired = state.phase === "results" && !filled;
      return { ...order, remaining: String(count), quantity: String(order.quantity), payout: String(orderPayout(state, order)),
        wishes: state.orderWishes[order.id] ?? [], wishAuthors: state.wishAuthors[order.id] ?? [],
        state: filled ? "filled" : expired ? "expired" : state.elapsed < order.opens || state.phase === "preparation" ? "upcoming" : "open" };
    }),
    objective: objective(state, actor), delivered: String(Object.values(trader?.delivered ?? {}).reduce((a, b) => a + b, 0)),
    crafted: String(trader?.crafted ?? 0), lifetimeCrafted: String(trader?.lifetimeCrafted ?? 0), lifetimeDividends: String(trader?.lifetimeDividends ?? 0),
    earned: String(trader?.earned ?? 0), spent: String(trader?.spent ?? 0), boatsHelped: String(trader?.boatsHelped ?? 0),
    rescued: String(trader?.rescued ?? 0), titles,
    crowdBudget: String(get(state, crowd, "coin")), crowdSold: String(trader?.crowdSold ?? 0),
    events: schedule.events, job: trader?.job, jobAvailable: state.phase === "open" && !!trader && canTakeJob(state, actor),
    activity: state.activity.slice(-50), saveStatus: "saved",
    traders: Object.entries(state.traders).filter(([id]) => id !== actor).map(([id, trader]) => ({ id, name: trader.name, lastStop: trader.lastStop })),
    pendingActions: [], listings: Object.values(state.listings).map(listing => ({ id: listing.id, stall: listing.stall, shares: String(listing.shares),
      price: String(listing.price), seller: state.traders[listing.actor]!.name, mine: listing.actor === actor })),
    spectator: !trader,
  };
}

function botRoute(world: World, actor: string, order: FestivalOrder) {
  const recipeId = (Object.keys(recipes) as RecipeId[]).find(id => recipes[id].output === order.item)!;
  const recipe = recipes[recipeId];
  let state = world;
  const act = (intent: Intent) => {
    const now = nowAt(state);
    state = commitFor(state, actor, quoteFor(state, actor, intent, `agent-${state.revision}`, now), now);
  };
  try {
    if (!get(state, actor, order.item)) {
      for (const item of recipe.inputs) {
        if (get(state, actor, item)) continue;
        const open = merchantIds.filter(stall => stockTargets(stall)[item] && get(state, shop(stall), item) > 0 &&
          !state.market[stall].stockClosed && cashBand(get(state, shop(stall), "coin")) !== "dark");
        if (state.mode !== "campaign" && (item === "paper" || item === "oil") &&
          open.reduce((qty, stall) => qty + get(state, shop(stall), item), 0) <= 2) return world;
        const seller = open.map(stall => ({ stall, price: tradePrice("buy", items[item].price, get(state, shop(stall), item),
            stockTargets(stall)[item]!, ratio(state, stall), 1) })).sort((a, b) => a.price - b.price)[0];
        if (!seller) return world;
        act({ type: "buy", stall_id: seller.stall, item_id: item, quantity: "1" });
      }
      act({ type: "craft", recipe_id: recipeId, quantity: "1" });
    }
    act({ type: "fill_order", order_id: order.id, quantity: "1" });
    return get(state, actor, "coin") >= get(world, actor, "coin") ? state : world;
  } catch {
    // A route that can't complete leaves the world and the rival's cart untouched.
    return world;
  }
}

function restock(world: World) {
  let state = world;
  for (const stall of merchantIds) {
    const account = shop(stall);
    const cash = get(state, account, "coin");
    const market = state.market[stall];
    if (cash < 5) continue;
    const reserve = strategies[market.strategy].reserve;
    const target = Object.entries(stockTargets(stall)).find(([item, target]) => get(state, account, item) < target / 2);
    if (!target) continue;
    const [item, quantity] = target as [ItemId, number];
    const supplier = merchantIds.find(other => other !== stall && stockTargets(other)[item] &&
      get(state, shop(other), item) > stockTargets(other)[item]! * .75 && get(state, shop(other), "coin") >= 5);
    if (!supplier) continue;
    const source = shop(supplier);
    const cost = ask(items[item].price, get(state, source, item), stockTargets(supplier)[item]!, ratio(state, supplier)).price;
    const margin = ask(items[item].price, get(state, account, item) + 1, quantity, ratio(state, stall)).price;
    if (cash - cost < reserve || cost >= margin) continue;
    const ledger = apply(state.ledger, [move(account, source, "coin", cost, "Wholesale restock"), move(source, account, item, 1, "Wholesale restock")]);
    state = { ...state, ledger, revision: state.revision + 1, market: { ...state.market,
      [stall]: { ...market, thinking: `Restocked ${items[item].name.toLowerCase()} from ${merchants[supplier].name}.` },
      [supplier]: { ...state.market[supplier], profit: state.market[supplier].profit + cost, unitsSold: state.market[supplier].unitsSold + 1 } } };
    state = recordSupply(state, stall, item, source, 1, cost);
  }
  return state;
}

function agentTurn(world: World) {
  let state = advanceRiver(world);
  for (const event of plan(world).events.filter(event => event.at > world.elapsed - 10 && event.at <= world.elapsed)) {
    if (event.id === "paper_barge" || event.id === "oil_late") state = scheduleFreight(state);
    state = addActivity({ ...state, revision: state.revision + 1 }, event.label + " · " + event.detail);
  }
  if (state.mode !== "campaign" && state.elapsed === 40 && !plan(state).events.some(event => event.id === "paper_barge")) state = scheduleFreight(state);
  state = refreshContracts(refreshOfferings(restock(state)));
  const actors = Object.keys(state.traders).filter(actor => actor.startsWith("r:"));
  if (!actors.length) return state;
  const campaign = state.mode === "campaign";
  const actor = actors[(Math.floor(state.elapsed / 20) + state.seed + state.night) % actors.length]!;
  const canTrade = state.elapsed >= (campaign && state.night === 4 ? 40 : campaign ? 80 : 20) && state.elapsed % 20 === 0;
  if (!canTrade || Object.values(state.river.hauls).some(haul => haul.actor === actor)) return state;
  const offers = Object.values(state.offers).filter(offer => offer.kind === "rescue" || (!campaign || state.night >= 4));
  for (const offer of offers) {
    const n = Math.min(2 - (offer.contributions[actor] ?? 0), offer.total - pledged(offer));
    if (!n || (campaign && offer.kind === "rescue" && state.night === 2 && offer.stall === "oil_wharf") ||
      get(state, actor, "coin") < n * offer.price + 8) continue;
    const now = nowAt(state);
    const deal = quoteFor(state, actor, { type: "buy_offering", offering_id: offer.id, shares: String(n) }, `agent-${state.revision}`, now);
    state = commitFor(state, actor, deal, now);
    if (offer.kind === "rescue") return state;
    break;
  }
  // A player's Bell order is paid work waiting at the dock, so a free hauler weighs it before festival routes.
  if (hasOpenBellOrder(state)) {
    const hauled = startRivalHaul(state, actor);
    if (hauled !== state) return hauled;
  }
  const candidates = plan(state).orders.filter(order => !order.personal && order.opens <= state.elapsed && remaining(state, order) > 0 &&
    (!campaign || (state.night === 4 ? order.boat >= 3 || state.elapsed >= 140 : order.boat >= 2)));
  for (const order of candidates.sort((a, b) => orderPayout(state, b) - orderPayout(state, a))) {
    const next = botRoute(state, actor, order);
    if (next !== state) return next;
  }
  if (!campaign && state.elapsed % 40 === 0) {
    const seller = merchantIds.find(stall => get(state, actor, share(stall)) > 0 && buybackPrice(state, stall) > 0);
    if (seller) {
      const now = nowAt(state);
      const deal = quoteFor(state, actor, { type: "accept_buyback", buyback_id: "buyback-" + seller }, `agent-${state.revision}`, now);
      return commitFor(state, actor, deal, now);
    }
  }
  return startRivalHaul(state, actor);
}

export function advanceClock(world: World, elapsed: number, agents = true): World {
  if (world.phase !== "open") return world;
  const end = plan(world).duration;
  const target = Math.min(end, Math.max(world.elapsed, elapsed));
  let state = world;
  if (agents) {
    for (let at = state.tickAt + 10; at <= target && at < end; at += 10) {
      state = agentTurn({ ...state, elapsed: at, tickAt: at });
    }
  }
  state = { ...state, elapsed: target };
  return target >= end ? closeNight(state) : state;
}
