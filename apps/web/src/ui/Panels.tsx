import { useState, type ReactNode } from "react";
import { Anchor, ArrowDownLeft, ArrowRight, ArrowUpRight, Check, Coins, LockKeyhole, Minus, Plus, Timer, X } from "lucide-react";
import { items, merchants, recipes, wishes, type ItemId, type StallId } from "@lantern/content";
import { strategies } from "@lantern/content/nights";
import type { HaggleOffer, HaggleResult, Intent, Quote, Snapshot } from "@lantern/protocol";
import { ItemIcon } from "./icons";

export const formatTime = (seconds: number) => {
  const rounded = Math.max(0, Math.ceil(seconds));
  return Math.floor(rounded / 60) + ":" + String(rounded % 60).padStart(2, "0");
};

export function PanelFrame({ title, eyebrow, icon, onClose, children }: {
  title: string; eyebrow: string; icon: ReactNode; onClose: () => void; children: ReactNode;
}) {
  return <section className="panel" aria-labelledby="panel-heading">
    <header className="panel-header">
      <span className="panel-emblem">{icon}</span>
      <div><div className="eyebrow">{eyebrow}</div><h2 id="panel-heading">{title}</h2></div>
      <button className="icon-button close" onClick={onClose} aria-label="Close panel" autoFocus><X size={20}/></button>
    </header>
    <div className="panel-body">{children}</div>
  </section>;
}

export type Actions = {
  submit: (intent: Intent) => Promise<void>;
  getQuote: (intent: Intent) => Promise<Quote | undefined>;
  accept: (quote: Quote) => Promise<boolean>;
  haggle: (offer: HaggleOffer) => Promise<HaggleResult | undefined>;
  busy: boolean;
};

export function Trade({ stall, snapshot, actions, preferred }: { stall: StallId; snapshot: Snapshot; actions: Actions; preferred?: ItemId }) {
  const data = snapshot.merchants[stall]!;
  const merchant = merchants[stall];
  const [tab, setTab] = useState<"trade" | "ownership">(data.band === "dark" && !data.stockClosed ? "ownership" : "trade");
  const [side, setSide] = useState<"buy" | "sell">(data.stockClosed ? "sell" : "buy");
  const [item, setItem] = useState<ItemId>(() => preferred && Object.hasOwn(merchant.goods, preferred) ? preferred
    : Object.keys(merchant.goods)[0] as ItemId ?? "lantern_paper");
  const [quantity, setQuantity] = useState(1);
  const [deal, setDeal] = useState<Quote>();
  const [offer, setOffer] = useState<string>();
  const [reply, setReply] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const hint = data.prices[item];
  const expired = !!deal && deal.expires_at <= snapshot.elapsed * 1000;
  const reset = () => { setDeal(undefined); setOffer(undefined); setReply(""); };
  const statusIcon = { healthy: "●", thriving: "✧", tight: "◐", dark: "◇" }[data.band];
  return <>
    <div className="merchant-line"><q>{data.band === "dark" ? data.thinking : merchant.greeting}</q><span className={`band band-${data.band}`}>{statusIcon} {data.band === "dark" ? "Closed" : data.band}</span></div>
    {stall !== "lantern_house" && <div className="tabs" aria-label="Stall information">
      <button className={tab === "trade" ? "selected" : ""} aria-pressed={tab === "trade"} onClick={() => setTab("trade")}>Trade</button>
      <button className={tab === "ownership" ? "selected" : ""} aria-pressed={tab === "ownership"} onClick={() => setTab("ownership")}>
        Ownership {data.offering && <span className="live-dot" aria-label="New offering"/>}
      </button>
    </div>}
    {stall === "lantern_house" ? <Crowd snapshot={snapshot} actions={actions}/>
      : tab === "ownership" ? <Ownership stall={stall} snapshot={snapshot} actions={actions}/>
      : data.band === "dark" && !data.stockClosed ? <button className="subtle" onClick={() => setTab("ownership")}>View rescue offering <ArrowRight size={16}/></button> : <>
      <div className="tabs" aria-label="Trade direction">
        <button className={side === "buy" ? "selected" : ""} aria-pressed={side === "buy"} disabled={data.stockClosed} onClick={() => { setSide("buy"); reset(); }}><ArrowDownLeft size={15}/> Buy</button>
        <button className={side === "sell" ? "selected" : ""} aria-pressed={side === "sell"} onClick={() => { setSide("sell"); reset(); }}><ArrowUpRight size={15}/> Sell</button>
      </div>
      <div className="stock">
        {Object.entries(data.prices).map(([key, price]) => {
          const id = key as ItemId;
          const count = side === "buy" ? data.stock[id] : snapshot.cargo[id];
          return <button className={id === item ? "stock-row selected" : "stock-row"} key={key} aria-pressed={id === item}
            onClick={() => { setItem(id); setQuantity(1); reset(); }}>
            <span className="tile-icon"><ItemIcon item={id}/></span>
            <span className="row-main"><strong>{items[id].name}</strong><small>{side === "buy" ? `${count}/${price.target} · ${price.label}` : `${count} in cart`}</small></span>
            <span className="gold">{price[side]} <Coins size={14}/></span>
          </button>;
        })}
      </div>
      {hint && <div className="trade-controls">
        <div className="split"><span>Quantity</span><div className="stepper">
          <button aria-label="Decrease quantity" onClick={() => { setQuantity(quantity - 1); reset(); }} disabled={quantity === 1}><Minus size={15}/></button>
          <b aria-live="polite">{quantity}</b>
          <button aria-label="Increase quantity" onClick={() => { setQuantity(quantity + 1); reset(); }} disabled={quantity >= Number(snapshot.capacity)}><Plus size={15}/></button>
        </div></div>
        {reply && <p className="offer-reply" role="status">{reply}</p>}
        {deal && !expired ? <div className="quote">
          <div className="split"><strong>{deal.summary}</strong><small title="Quote time remaining"><Timer size={13}/> {Math.ceil((deal.expires_at - snapshot.elapsed * 1000) / 1000)}s</small></div>
          <button className="primary wide" disabled={actions.busy} onClick={async () => { if (await actions.accept(deal)) reset(); }}>
            Confirm {side} <Check size={17}/>
          </button>
        </div> : <>
          {expired && <p className="offer-reply">Quote expired.</p>}
          <button className="primary wide" disabled={actions.busy} onClick={async () => {
            const next = await actions.getQuote({ type: side, item_id: item, stall_id: stall, quantity: String(quantity) });
            setOffer(undefined);
            setReply("");
            setDeal(next);
          }}>Review {side} <ArrowRight size={17}/></button>
        </>}
        {offer === undefined ? <button className="text-button" disabled={actions.busy || snapshot.elapsed < cooldown}
          onClick={() => { setDeal(undefined); setReply(""); setOffer(hint[side]); }}>
          {snapshot.elapsed < cooldown ? `Offer again in ${Math.ceil(cooldown - snapshot.elapsed)}s` : "Make an offer"}
        </button> : <form className="offer" onSubmit={async event => {
          event.preventDefault();
          const result = await actions.haggle({ stall_id: stall, side, item_id: item, quantity: String(quantity), price_per_unit: offer });
          if (result) {
            setReply(result.line);
            setDeal(result.quote);
            setCooldown(snapshot.elapsed + result.retry_after_ms / 1000);
            setOffer(undefined);
          }
        }}>
          <label><Coins size={15}/><input type="number" min="1" max="999" step="1" required value={offer} onChange={e => setOffer(e.target.value)} aria-label="Offer per item"/> / item</label>
          <button className="subtle" disabled={actions.busy}>Offer</button>
        </form>}
      </div>}
      <p className="hint" title={data.thinking}>{strategies[data.strategy].icon} {strategies[data.strategy].name} <span className="muted">· {data.relationship < 0 ? "Guarded" : data.relationship > 2 ? "Friendly" : "Open to offers"}</span></p>
    </>}
  </>;
}

const lanternIds = ["lantern_paper", "lantern_float", "lantern_color"] as const;
const recipeIds = ["paper_lantern", "floating_lantern", "colored_lantern"] as const;

function Crowd({ snapshot, actions }: { snapshot: Snapshot; actions: Actions }) {
  const cargo = lanternIds.filter(item => Number(snapshot.cargo[item]) > 0);
  return <>
    <p className="hint"><Coins size={15}/> {snapshot.crowdBudget} crowd budget · {Math.max(0, 6 - Number(snapshot.crowdSold))} sales left</p>
    {cargo.length === 0 && <div className="locked"><ItemIcon item="lantern_paper"/> No lanterns in your cart</div>}
    {cargo.map(item => <div className="order-row" key={item}><ItemIcon item={item}/><div className="row-main">
      <strong>{items[item].name}</strong><small>{snapshot.cargo[item]} in cart · {items[item].price} coins each</small>
    </div><button className="subtle deliver" disabled={actions.busy || Number(snapshot.crowdBudget) < items[item].price || Number(snapshot.crowdSold) >= 6}
      onClick={() => void actions.submit({ type: "sell_crowd", item_id: item, quantity: "1" })}>Sell one</button></div>)}
  </>;
}

const chartColors = ["#ebaf80", "#a8c9aa", "#b69bdb", "#de9aa2"];

function Ownership({ stall, snapshot, actions }: { stall: StallId; snapshot: Snapshot; actions: Actions }) {
  const data = snapshot.merchants[stall]!;
  const offering = data.offering;
  const [risk, setRisk] = useState(false);
  const [oneShare, setOneShare] = useState(false);
  const maximum = Number(offering?.available ?? 0);
  const count = oneShare ? Math.min(1, maximum) : maximum;
  const cost = count * Number(offering?.price ?? 0);
  const total = data.shareholders.reduce((sum, holder) => sum + Number(holder.count), 0);
  let angle = 0;
  const segments = data.shareholders.map((holder, index) => {
    const next = angle + Number(holder.count) / total * 360;
    const slice = `${chartColors[index % chartColors.length]} ${angle}deg ${next}deg`;
    angle = next;
    return slice;
  });
  return <>
    {!!data.suppliedBy?.length && <p className="hint">Supplied tonight by {data.suppliedBy.map(provider => provider.name + " " + provider.quantity).join(", ")}.</p>}
    {offering && <div className="ownership-offer">
      <div className="split"><strong>{offering.kind === "rescue" ? "Rescue offering" : "Expansion offering"}</strong><small>{formatTime(offering.ends - snapshot.elapsed)}</small></div>
      <div className="split"><span>{offering.left} of {offering.total} shares left</span><b className="gold">{offering.price} <Coins size={14}/> each</b></div>
      {data.band !== "dark" && <small>{data.thinking}</small>}
      {maximum > 1 && <label className="wish-label"><span>Buy one share</span><input type="checkbox" checked={oneShare} onChange={event => { setOneShare(event.target.checked); setRisk(false); }}/></label>}
      {risk && <small className="offer-risk">Dividends depend on profit. A buyer may never appear, and you could lose what you invest.</small>}
      <button className="primary wide" disabled={!count || actions.busy || Number(snapshot.coins) < cost}
        onClick={async () => {
          if (!risk) { setRisk(true); return; }
          await actions.submit({ type: "buy_offering", offering_id: offering.id, shares: String(count) });
          setRisk(false);
        }}>{!count ? "Pledge placed" : risk ? `Confirm pledge · ${cost} coins` : `Pledge ${count} · ${cost} coins`} <Coins size={15}/></button>
    </div>}
    <div className="ownership-metrics">
      <div><small>Your shares</small><b>{data.owned}</b></div>
      <div><small>Last price</small><b>{Number(data.sharePrice) ? data.sharePrice : "—"}</b></div>
      <div><small>Book value</small><b>{Number(data.bookValue) ? data.bookValue : "—"}</b></div>
    </div>
    {total > 0 && <div className="ownership-chart">
      <span className="ownership-ring" aria-hidden="true" style={{ background: `conic-gradient(${segments.join(",")})` }}/>
      <ul>{data.shareholders.map((holder, index) => <li key={index}><i style={{ background: chartColors[index % chartColors.length] }}/>{holder.name} <b>{holder.count}</b></li>)}</ul>
    </div>}
    {data.dividendHistory.length > 0 && <div className="split history-bars" title="Coins paid per share over the last five nights">
      <small>Dividends per share</small><span aria-label={data.dividendHistory.join(", ")}>{data.dividendHistory.map((value, index) =>
        <i key={index} title={value} style={{ height: `${4 + 16 * Number(value) / Math.max(1, ...data.dividendHistory.map(Number))}px` }}/>)}</span>
    </div>}
    <p className="hint">{strategies[data.strategy].icon} {strategies[data.strategy].name} · {strategies[data.strategy].description}</p>
    {data.buyback && <button className="subtle" disabled={actions.busy} onClick={() =>
      void actions.submit({ type: "accept_buyback", buyback_id: data.buyback!.id })}>Sell one share · {data.buyback.price} coins</button>}
  </>;
}

export function Workshop({ snapshot, actions, preferred, shop }: {
  snapshot: Snapshot; actions: Actions; preferred?: ItemId; shop: (item: ItemId) => void;
}) {
  const [selected, setSelected] = useState(() => recipeIds.find(id => recipes[id].output === preferred) ?? "paper_lantern");
  const recipe = recipes[selected];
  const count = Math.min(...recipe.inputs.map(item => Number(snapshot.cargo[item])));
  return <>
    {(snapshot.night > 1 || snapshot.mode !== "campaign") && <div className="tabs recipe-tabs" aria-label="Recipes">
      {recipeIds.map((id, index) => <button key={id} className={id === selected ? "selected" : ""} disabled={recipes[id].unlock > snapshot.night && snapshot.mode === "campaign"}
        aria-pressed={id === selected} onClick={() => setSelected(id)}><ItemIcon item={recipes[id].output} size={15}/>{["Paper", "Floating", "Color"][index]}</button>)}
    </div>}
    <div className="recipe-feature">
      <span className="recipe-icon"><ItemIcon item={recipe.output} size={35}/></span>
      <strong>{items[recipe.output].name}</strong>
      <div className="ingredients">
        {recipe.inputs.map(item => <button key={item} type="button" disabled={snapshot.spectator}
          aria-label={"Shop for " + items[item].name.toLowerCase()} title={"Shop for " + items[item].name.toLowerCase()}
          className={Number(snapshot.cargo[item]) ? "stocked" : ""} onClick={() => shop(item)}>
          <ItemIcon item={item} size={16}/> {snapshot.cargo[item]} / 1
        </button>)}
      </div>
    </div>
    <div className="button-pair">
      <button className="primary" disabled={count < 1 || actions.busy} onClick={() => void actions.submit({ type: "craft", recipe_id: selected, quantity: "1" })}>Craft one</button>
      {count > 1 && <button className="subtle" disabled={actions.busy} onClick={() => void actions.submit({ type: "craft", recipe_id: selected, quantity: String(count) })}>Craft {count}</button>}
    </div>
    {snapshot.mode === "campaign" && snapshot.night < 2 && <div className="locked"><LockKeyhole size={15}/> Floating lantern <span>Night 2</span></div>}
    {snapshot.mode === "campaign" && snapshot.night < 3 && <div className="locked"><LockKeyhole size={15}/> Colored lantern <span>Night 3</span></div>}
  </>;
}

export function Board({ snapshot, actions }: { snapshot: Snapshot; actions: Actions }) {
  const [wish, setWish] = useState("");
  const [tab, setTab] = useState<"orders" | "shares">("orders");
  return <>
    {snapshot.mode !== "campaign" && <div className="tabs" aria-label="Notice board">
      <button className={tab === "orders" ? "selected" : ""} onClick={() => setTab("orders")}>Orders</button>
      <button className={tab === "shares" ? "selected" : ""} onClick={() => setTab("shares")}>Share board</button>
    </div>}
    {tab === "shares" ? <ShareBoard snapshot={snapshot} actions={actions}/> : <>
    <div className="board-list">
      {snapshot.orders.map(order => {
        const canGive = Math.min(Number(order.remaining), Number(snapshot.cargo[order.item]));
        return <div className="order-row" key={order.id}>
          <span className={`tile-icon ${order.state === "filled" ? "lit" : ""}`} title={items[order.item as ItemId]?.name}>
            {order.state === "filled" ? <Check size={19}/> : <ItemIcon item={order.item as ItemId}/>}
          </span>
          <div className="row-main"><strong>{order.name}</strong><small>{
            order.state === "filled" ? "Lit" : order.state === "upcoming" ? `Opens in ${formatTime(order.opens - snapshot.elapsed)}`
              : order.state === "expired" ? "Closed" : `${order.remaining} left · ${order.payout} coins each${order.personal ? " · Personal" : ""}`
          }</small>{order.state === "filled" && order.wishes[0] && <small title={order.wishes.join("\n")}>“{order.wishes[0]}”</small>}</div>
          {order.state === "open" && <button className="subtle deliver" disabled={!canGive || actions.busy}
            onClick={() => void actions.submit({ type: "fill_order", order_id: order.id, quantity: String(canGive), ...(wish ? { wish_id: wish } : {}) })}>
            {canGive ? `Deliver ${canGive}` : <><Anchor size={14}/> Open</>}
          </button>}
        </div>;
      })}
    </div>
    <label className="wish-label">Attach a wish <select value={wish} onChange={event => setWish(event.target.value)}>
      <option value="">No wish</option>
      {wishes.map(line => <option key={line}>{line}</option>)}
    </select></label>
    {snapshot.jobAvailable && <button className="subtle wide" disabled={actions.busy} onClick={() =>
      void actions.submit({ type: "start_job" })}><Anchor size={16}/> Dock job · 4 coins</button>}
    {snapshot.job && <p className="hint"><Anchor size={15}/> Take your parcel to The Landing.</p>}
    </>}
  </>;
}

function ShareBoard({ snapshot, actions }: { snapshot: Snapshot; actions: Actions }) {
  const stalls = Object.keys(merchants).filter(stall => Number(snapshot.merchants[stall]?.owned) > 0);
  const [chosen, setChosen] = useState("");
  const [price, setPrice] = useState("5");
  const stall = chosen || stalls[0];
  return <>
    {snapshot.listings.length === 0 && <p className="hint">No shares listed.</p>}
    {snapshot.listings.map(listing => <div className="order-row" key={listing.id}>
      <span className="tile-icon"><Coins size={16}/></span>
      <div className="row-main"><strong>{merchants[listing.stall as StallId].name}</strong><small>{listing.shares} · {listing.price} coins each · {listing.seller}</small></div>
      <button className="subtle deliver" disabled={actions.busy} onClick={() =>
        void actions.submit({ type: listing.mine ? "cancel_listing" : "buy_listing", listing_id: listing.id })}>{listing.mine ? "Cancel" : "Buy"}</button>
    </div>)}
    {stall && <form className="share-form" onSubmit={event => {
      event.preventDefault();
      void actions.submit({ type: "list_shares", stall_id: stall, shares: "1", price_per_share: price });
    }}>
      <select aria-label="Stall to list" value={stall} onChange={event => setChosen(event.target.value)}>
        {stalls.map(id => <option value={id} key={id}>{merchants[id as StallId].name}</option>)}
      </select>
      <input aria-label="Price per share" type="number" min="1" max="9999" value={price} onChange={event => setPrice(event.target.value)}/>
      <button className="subtle deliver" disabled={actions.busy}>List one</button>
    </form>}
  </>;
}

export function Inventory({ snapshot }: { snapshot: Snapshot }) {
  const cargo = Object.entries(snapshot.cargo).filter(([, count]) => Number(count));
  return cargo.length ? <div className="stock">{cargo.map(([key, count]) => {
    const item = key as ItemId;
    return <div className="stock-row" key={key}><span className="tile-icon"><ItemIcon item={item}/></span>
      <strong className="row-main">{items[item].name}</strong><b>{count}</b></div>;
  })}</div> : <p className="hint">Your cart is empty.</p>;
}
