import { items, merchants, type ItemId, type StallId } from "@lantern/content";
import { strategies, upgrades, type StrategyId, type UpgradeId } from "@lantern/content/nights";
import type { Intent, LedgerOp } from "@lantern/protocol";
import { apply } from "./ledger";
import {
  addActivity, burn, cashBand, get, getTrader, listingEscrow, merchantIds, mint, move, offerEscrow, payoutPool,
  share, shop, stockTargets, supply, unlock, type Offering, type World,
} from "./model";

const supported: StallId[] = merchantIds.filter(stall => stall !== "lantern_house");
const MAX_SHARES = 20;
export const pledged = (offer: Offering) => Object.values(offer.contributions).reduce((sum, amount) => sum + amount, 0);

export function owners(state: World, stall: StallId) {
  const holders = Object.fromEntries(Object.keys(state.traders).map(actor => [actor, get(state, actor, share(stall))]));
  for (const listing of Object.values(state.listings)) {
    if (listing.stall === stall) holders[listing.actor] = (holders[listing.actor] ?? 0) + get(state, listingEscrow(listing.id), share(stall));
  }
  return holders;
}

export function bookValue(state: World, stall: StallId, fallback = 1) {
  const inventory = Object.keys(stockTargets(stall)).reduce((sum, item) =>
    sum + get(state, shop(stall), item) * items[item as ItemId].price, 0);
  return (inventory + get(state, shop(stall), "coin")) / (supply(state, share(stall)) || fallback);
}

export function buybackPrice(state: World, stall: StallId) {
  if (state.mode === "campaign") return 0;
  const cash = get(state, shop(stall), "coin");
  const price = Math.max(1, Math.floor(bookValue(state, stall)));
  return supply(state, share(stall)) > 0 && cash > 3 * strategies[state.market[stall].strategy].reserve + 30 &&
    cash >= price + 5 ? price : 0;
}

function setMarket(state: World, stall: StallId, change: Partial<World["market"][StallId]>): World {
  return { ...state, market: { ...state.market, [stall]: { ...state.market[stall], ...change } } };
}

function refund(state: World, offer: Offering): World {
  const ledger = apply(state.ledger, Object.entries(offer.contributions).map(([actor, amount]) =>
    move(offerEscrow(offer.id), actor, "coin", amount * offer.price, "Offering refund")));
  const offers = { ...state.offers };
  delete offers[offer.id];
  return addActivity({ ...state, ledger, offers, revision: state.revision + 1 }, `${merchants[offer.stall].name} refunded its offering.`);
}

export function refreshOfferings(world: World) {
  let state = world;
  for (const offer of Object.values(state.offers)) {
    if (state.elapsed >= offer.ends || (offer.kind === "expansion" && get(state, shop(offer.stall), "coin") < 5)) state = refund(state, offer);
  }
  for (const stall of supported) {
    const cash = get(state, shop(stall), "coin");
    const market = state.market[stall];
    const dark = cashBand(cash) === "dark";
    const guided = state.mode === "campaign" && state.night === 3 && stall === "paper_mill" && state.elapsed >= 42;
    if (Object.values(state.offers).some(offer => offer.stall === stall)) continue;
    const kind = dark && !market.rescued ? "rescue"
      : !dark && market.offerCount === 0 && (guided || (cash < 25 && market.drift > 10000)) ? "expansion" : undefined;
    if (!kind) continue;
    const total = kind === "rescue" ? 4 : 2;
    if (supply(state, share(stall)) + total > MAX_SHARES) continue;
    const id = `${state.night}-${stall}-${market.offerCount + 1}`;
    const price = kind === "rescue" ? 5 : Math.max(5, Math.ceil(bookValue(state, stall, 10)));
    const contributions: Offering["contributions"] = {};
    let ledger = state.ledger;
    if (kind === "rescue" && state.mode === "campaign" && state.night === 2 && stall === "oil_wharf") {
      contributions["r:juno"] = 2;
      ledger = apply(ledger, [move("r:juno", offerEscrow(id), "coin", 10, "Juno pledges to relight the wharf")]);
    }
    const offer: Offering = { id, stall, kind, total, price, ends: kind === "rescue" ? 300 : Math.min(300, state.elapsed + 90), contributions };
    const thinking = kind === "rescue" ? "Out of cash. Help reopen the stall." : "Raising coins for a larger shipment.";
    state = setMarket({ ...state, ledger, offers: { ...state.offers, [id]: offer }, revision: state.revision + 1 },
      stall, { offerCount: market.offerCount + 1, thinking });
    state = addActivity(state, kind === "rescue" ? `${merchants[stall].name} went dark.` : `${merchants[stall].name} opened an expansion offering.`);
  }
  return state;
}

type OwnershipIntent = Extract<Intent, { type: "buy_offering" | "vote_strategy" | "buy_upgrade" | "accept_buyback" | "list_shares" | "cancel_listing" | "buy_listing" }>;

export function ownershipQuote(state: World, actor: string, intent: OwnershipIntent, quoteId: string): { effects: LedgerOp[]; summary: string } {
  const trader = getTrader(state, actor);
  switch (intent.type) {
    case "buy_offering": {
      const offer = Object.hasOwn(state.offers, intent.offering_id) ? state.offers[intent.offering_id] : undefined;
      if (!offer || state.elapsed >= offer.ends) throw new Error("That offering has closed.");
      const count = Number(intent.shares);
      const owned = offer.contributions[actor] ?? 0;
      const funded = pledged(offer);
      if (owned + count > 2 || funded + count > offer.total) throw new Error("That offering has fewer shares available.");
      const memo = `Pledge ${count} · ${count * offer.price} coins`;
      const account = offerEscrow(offer.id);
      const effects = [move(actor, account, "coin", count * offer.price, memo)];
      if (funded + count === offer.total) {
        effects.push(move(account, shop(offer.stall), "coin", offer.total * offer.price, "Offering funded"));
        for (const [buyer, amount] of Object.entries({ ...offer.contributions, [actor]: owned + count })) {
          effects.push(mint(buyer, share(offer.stall), amount, "Shares issued"));
        }
      }
      return { effects, summary: memo };
    }
    case "vote_strategy": {
      const stall = intent.stall_id as StallId;
      if (!supported.includes(stall) || !owners(state, stall)[actor]) throw new Error("You need shares in this stall to vote.");
      if (!Object.hasOwn(strategies, intent.strategy_id)) throw new Error("Choose a market strategy.");
      return { effects: [], summary: `Vote · ${strategies[intent.strategy_id as StrategyId].name}` };
    }
    case "buy_upgrade": {
      const id = intent.upgrade_id as UpgradeId;
      if (!Object.hasOwn(upgrades, id) || upgrades[id].unlock > unlock(state)) throw new Error("That upgrade is locked.");
      if (trader.upgrades.includes(id)) throw new Error("You already own that upgrade.");
      if (id === "cart_ii" && !trader.upgrades.includes("cart_i")) throw new Error("Upgrade to Cart I first.");
      const upgrade = upgrades[id];
      if (state.mode === "campaign" && state.night === 2 && get(state, actor, "coin") - upgrade.price < 10) {
        throw new Error("Set aside 10 coins for the Oil Wharf rescue.");
      }
      return { effects: [move(actor, "sys:freight", "coin", upgrade.price, "Cart upgrade")], summary: `${upgrade.name} upgraded` };
    }
    case "accept_buyback": {
      const stall = supported.find(stall => intent.buyback_id === `buyback-${stall}`);
      if (!stall) throw new Error("No buyback is available.");
      const price = buybackPrice(state, stall);
      if (!price || get(state, actor, share(stall)) < 1) throw new Error("No share is available for this buyback.");
      return { effects: [burn(actor, share(stall), 1, "Merchant buyback"), move(shop(stall), actor, "coin", price, "Merchant buyback")],
        summary: `Buyback · ${price} coins` };
    }
    case "list_shares": {
      if (state.mode === "campaign") throw new Error("The share board opens after the campaign.");
      const stall = intent.stall_id as StallId;
      const count = Number(intent.shares);
      const price = Number(intent.price_per_share);
      if (!supported.includes(stall) || count > get(state, actor, share(stall))) throw new Error("You don’t have those shares.");
      if (price > 9999) throw new Error("List a price between 1 and 9,999 coins.");
      return { effects: [move(actor, listingEscrow(quoteId), share(stall), count, "Shares listed")], summary: "Shares listed" };
    }
    case "cancel_listing":
    case "buy_listing": {
      const listing = Object.hasOwn(state.listings, intent.listing_id) ? state.listings[intent.listing_id] : undefined;
      if (!listing) throw new Error("That listing is gone.");
      const account = listingEscrow(listing.id);
      if (intent.type === "cancel_listing") {
        if (listing.actor !== actor) throw new Error("Only the seller can cancel this listing.");
        return { effects: [move(account, actor, share(listing.stall), listing.shares, "Listing cancelled")], summary: "Listing cancelled" };
      }
      if (listing.actor === actor) throw new Error("This is your listing.");
      const total = listing.price * listing.shares;
      return { effects: [move(actor, listing.actor, "coin", total, "Shares purchased"),
        move(account, actor, share(listing.stall), listing.shares, "Shares purchased")], summary: `Shares purchased · ${total} coins` };
    }
  }
}

export function afterOwnership(previous: World, state: World, actor: string, intent: Intent, quoteId: string): World {
  if (intent.type === "list_shares") {
    return { ...state, listings: { ...state.listings, [quoteId]: { id: quoteId, actor, stall: intent.stall_id as StallId,
      shares: Number(intent.shares), price: Number(intent.price_per_share) } } };
  }
  if (intent.type === "cancel_listing" || intent.type === "buy_listing") {
    const listing = previous.listings[intent.listing_id]!;
    const listings = { ...state.listings };
    delete listings[intent.listing_id];
    const next = { ...state, listings };
    return intent.type === "buy_listing" ? setMarket(next, listing.stall, { lastSharePrice: listing.price }) : next;
  }
  if (intent.type !== "buy_offering") return state;
  const offer = previous.offers[intent.offering_id]!;
  const contributions = { ...offer.contributions, [actor]: (offer.contributions[actor] ?? 0) + Number(intent.shares) };
  if (pledged({ ...offer, contributions }) < offer.total) {
    return { ...state, offers: { ...state.offers, [offer.id]: { ...offer, contributions } } };
  }

  const offers = { ...state.offers };
  delete offers[offer.id];
  const reopened = offer.kind === "rescue";
  const traders = { ...state.traders };
  if (reopened) {
    for (const buyer of Object.keys(contributions)) {
      const trader = traders[buyer]!;
      traders[buyer] = { ...trader, rescued: trader.rescued + 1, rescuedTonight: [...trader.rescuedTonight, offer.stall],
        relationship: { ...trader.relationship, [offer.stall]: Math.min(10, (trader.relationship[offer.stall] ?? 0) + 3) } };
    }
  }
  const next = setMarket({ ...state, offers, traders }, offer.stall,
    { rescued: reopened || state.market[offer.stall].rescued, lastSharePrice: offer.price,
      thinking: reopened ? "The lights are back. Thank you." : "The next shipment is paid for." });
  return addActivity(next, reopened ? `${merchants[offer.stall].name} relit!` : `${merchants[offer.stall].name} funded its expansion.`);
}

export function openNight(world: World): World {
  if (world.phase !== "preparation") return world;
  let state: World = { ...world, phase: "open", revision: world.revision + 1 };
  const traders = { ...state.traders };
  for (const stall of supported) {
    const votes = new Map<StrategyId, number>();
    for (const [actor, count] of Object.entries(owners(state, stall))) {
      if (!count) continue;
      const trader = traders[actor]!;
      const cash = get(state, shop(stall), "coin");
      const strategiesByTaste: StrategyId[] = actor === "r:juno" ? ["steady", "festival", "steady", "bold"]
        : actor === "r:pell" ? ["bargain", "bargain", "festival", "steady"] : ["bold", "festival", "bargain", "steady"];
      const policy = !actor.startsWith("r:") || (state.mode === "campaign" && actor === "r:juno") ? undefined
        : cash < 28 ? "steady" : strategiesByTaste[(state.night + state.seed + supported.indexOf(stall)) % 4];
      const vote = trader.votes[stall] ?? policy;
      if (vote) votes.set(vote, (votes.get(vote) ?? 0) + count);
      traders[actor] = { ...trader,
        relationship: { ...trader.relationship, [stall]: Math.min(10, (trader.relationship[stall] ?? 0) + 1) } };
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1]);
    if (ranked[0] && ranked[0][1] > (ranked[1]?.[1] ?? 0)) {
      state = setMarket(state, stall, { strategy: ranked[0][0] });
      state = addActivity(state, `${merchants[stall].name} voted ${strategies[ranked[0][0]].name}.`);
    }
  }
  return refreshOfferings({ ...state, traders });
}

export function closeOwnership(world: World): World {
  let state = world;
  for (const offer of Object.values(world.offers)) state = refund(state, offer);
  for (const stall of supported) {
    const market = state.market[stall];
    const shares = supply(state, share(stall));
    const cash = get(state, shop(stall), "coin");
    const pool = shares && cash >= 5 ? Math.min(state.mode === "campaign" ? cash : Math.max(0, cash - 10), Math.max(0, Math.floor(market.profit * .30))) : 0;
    const each = shares ? Math.floor(pool / shares) : 0;
    const effects: LedgerOp[] = [];
    const traders = { ...state.traders };
    if (pool > 0) effects.push(move(shop(stall), payoutPool(stall), "coin", pool, "Dividend pool"));
    for (const [actor, amount] of Object.entries(owners(state, stall))) {
      const dividend = amount * each;
      const trader = traders[actor]!;
      traders[actor] = { ...trader, dividends: { ...trader.dividends, [stall]: dividend },
        lifetimeDividends: trader.lifetimeDividends + dividend };
      if (dividend) effects.push(move(payoutPool(stall), actor, "coin", dividend, "Dividend paid"));
    }
    const remainder = pool - each * shares;
    if (remainder) effects.push(move(payoutPool(stall), shop(stall), "coin", remainder, "Dividend remainder"));
    const demand = market.unitsSold >= 5 ? 500 : market.unitsSold < 2 ? -500 : 0;
    state = setMarket({ ...state, traders, ledger: apply(state.ledger, effects) }, stall,
      { dividendHistory: [...market.dividendHistory, each].slice(-5),
        drift: state.mode === "campaign" ? market.drift : Math.max(5000, Math.min(20000, market.drift + demand)) });
    if (each) state = addActivity(state, `${merchants[stall].name} paid ${each} coin${each === 1 ? "" : "s"} per share.`);
  }
  return state;
}
