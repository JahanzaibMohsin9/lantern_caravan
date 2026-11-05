import { useState, type ReactNode } from "react";
import { Anchor, ArrowDownLeft, ArrowRight, ArrowUpRight, Check, CircleHelp, Coins, LockKeyhole, Minus, Plus, Ship, Timer, X } from "lucide-react";
import { items, merchants, recipes, wishes, type ItemId, type StallId } from "@lantern/content";
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

type Actions = {
  submit: (intent: Intent) => Promise<void>;
  getQuote: (intent: Intent) => Promise<Quote | undefined>;
  accept: (quote: Quote) => Promise<boolean>;
  haggle: (offer: HaggleOffer) => Promise<HaggleResult | undefined>;
  busy: boolean;
};

export function Trade({ stall, snapshot, actions }: { stall: StallId; snapshot: Snapshot; actions: Actions }) {
  const data = snapshot.merchants[stall]!;
  const merchant = merchants[stall];
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [item, setItem] = useState<ItemId>(Object.keys(merchant.goods)[0] as ItemId ?? "lantern_paper");
  const [quantity, setQuantity] = useState(1);
  const [deal, setDeal] = useState<Quote>();
  const [offer, setOffer] = useState<string>();
  const [reply, setReply] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const hint = data.prices[item];
  const available = Number(snapshot.cargo.lantern_paper);
  const expired = !!deal && deal.expires_at <= snapshot.elapsed * 1000;
  const reset = () => { setDeal(undefined); setOffer(undefined); setReply(""); };
  const statusIcon = { healthy: "●", thriving: "✧", tight: "◐", dark: "◇" }[data.band];
  return <>
    <div className="merchant-line"><q>{merchant.greeting}</q><span className={`band band-${data.band}`}>{statusIcon} {data.band === "dark" ? "Closed" : data.band}</span></div>
    {stall === "lantern_house" ? <>
      <div className="order-row"><ItemIcon item="lantern_paper"/><div><strong>Paper lantern</strong><small>{available} in cart · {snapshot.crowdBudget} crowd budget</small></div><b className="gold">7 <Coins size={14}/></b></div>
      <button className="primary wide" disabled={!available || Number(snapshot.crowdSold) >= 6 || actions.busy}
        onClick={() => void actions.submit({ type: "sell_crowd", item_id: "lantern_paper", quantity: "1" })}>Sell one <ArrowUpRight size={17}/></button>
    </> : <>
      <div className="tabs" aria-label="Trade direction">
        <button className={side === "buy" ? "selected" : ""} aria-pressed={side === "buy"} onClick={() => { setSide("buy"); reset(); }}><ArrowDownLeft size={15}/> Buy</button>
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
          <button aria-label="Increase quantity" onClick={() => { setQuantity(quantity + 1); reset(); }} disabled={quantity === 6}><Plus size={15}/></button>
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
    </>}
  </>;
}

export function Workshop({ snapshot, actions }: { snapshot: Snapshot; actions: Actions }) {
  const count = Math.min(Number(snapshot.cargo.paper), Number(snapshot.cargo.oil));
  return <>
    <div className="recipe-feature">
      <span className="recipe-icon"><ItemIcon item="lantern_paper" size={35}/></span>
      <strong>Paper lantern</strong>
      <div className="ingredients">
        {recipes.paper_lantern.inputs.map(item => <span key={item} title={items[item].name}><ItemIcon item={item} size={16}/> {snapshot.cargo[item]} / 1</span>)}
      </div>
    </div>
    <div className="button-pair">
      <button className="primary" disabled={count < 1 || actions.busy} onClick={() => void actions.submit({ type: "craft", recipe_id: "paper_lantern", quantity: "1" })}>Craft one</button>
      {count > 1 && <button className="subtle" disabled={actions.busy} onClick={() => void actions.submit({ type: "craft", recipe_id: "paper_lantern", quantity: String(count) })}>Craft {count}</button>}
    </div>
    {count === 0 && <div className="hint"><CircleHelp size={15}/> One paper and one oil per lantern.</div>}
    <div className="locked"><LockKeyhole size={15}/> Floating lantern <span>Night 2</span></div>
    <div className="locked"><LockKeyhole size={15}/> Colored lantern <span>Night 3</span></div>
  </>;
}

export function Board({ snapshot, actions }: { snapshot: Snapshot; actions: Actions }) {
  const [wish, setWish] = useState("");
  return <>
    <div className="board-list">
      {snapshot.orders.map(order => {
        const canGive = Math.min(Number(order.remaining), Number(snapshot.cargo.lantern_paper));
        return <div className="order-row" key={order.id}>
          <span className={`tile-icon ${order.state === "filled" ? "lit" : ""}`}>
            {order.state === "filled" ? <Check size={19}/> : <Ship size={19}/>}
          </span>
          <div className="row-main"><strong>{order.name}</strong><small>{
            order.state === "filled" ? "Lit" : order.state === "upcoming" ? `Opens in ${formatTime(order.opens - snapshot.elapsed)}`
              : `${order.remaining} left · ${order.payout} coins each${order.personal ? " · Personal" : ""}`
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
