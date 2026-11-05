import { useState } from "react";
import { Anchor, Bell, Coins, Flame, LifeBuoy, PackagePlus } from "lucide-react";
import { items, merchants, type ItemId, type StallId } from "@lantern/content";
import { bargeTrims, bargeUpgrades, bellOrderLimits, reaches, routeDistance, sourceFor, villages, type BargeTrimId, type ReachId, type VillageId } from "@lantern/content/river";
import { routeLead } from "@lantern/river-sim";
import type { Intent, Snapshot } from "@lantern/protocol";
import { cargoColor } from "./render";
import { BargeLooks } from "./BargeLooks";

/** Seconds of night that must remain to cast off once the market is open. */
const lateCutoff = 45;

export function Landing({ snapshot, busy, submit, castOff }: { snapshot: Snapshot; busy: boolean;
  submit: (intent: Intent) => Promise<void>; castOff: (intent: Extract<Intent, { type: "start_run" }>) => void }) {
  const unlocked = snapshot.mode !== "campaign" || snapshot.night >= 2;
  const trimsUnlocked = snapshot.mode !== "campaign" || snapshot.night >= 3;
  const [trim, setTrim] = useState<BargeTrimId>(snapshot.barge.trim);
  const depart = () => castOff({ type: "start_run", barge_plan: [], trim });
  const left = snapshot.duration - snapshot.elapsed;
  const canCast = unlocked && !snapshot.spectator && (snapshot.phase === "preparation" || (snapshot.phase === "open" && left >= lateCutoff));
  const contracts = snapshot.river.contracts.filter(contract => !contract.taken);
  const ordersOpen = !snapshot.spectator && (snapshot.mode !== "campaign" || snapshot.night >= 4);
  const [tab, setTab] = useState<"barge" | "bell" | "order">(contracts.some(contract => contract.relief) ? "bell" : "barge");
  const mine = snapshot.river.contracts.find(contract => contract.mine);
  const loads = Object.entries(snapshot.villages).flatMap(([village, port]) => Object.entries(port.stock).map(([item, stock]) => ({
    village, item, stock, price: port.prices[item]!.buy, label: port.prices[item]!.label,
  })));
  const leads = routeLeads(snapshot).slice(0, 3);
  const leaving = snapshot.phase === "open"
    ? snapshot.mode === "live" ? "The Row keeps trading while you're upriver." : "The night's clock moves on by the length of your trip."
    : "Runs before the market opens cost no market time.";
  const ordered = [...contracts].sort((a, b) => Number(!!b.relief) - Number(!!a.relief));
  return <div className="landing">
    <div className="button-pair">
      <button className={tab === "barge" ? "primary" : "subtle"} onClick={() => setTab("barge")}><Anchor size={15}/> Barge</button>
      <button className={tab === "bell" ? "primary" : "subtle"} onClick={() => setTab("bell")}><Bell size={15}/> Harbor Bell
        {contracts.length > 0 && <span className="bell-count">{contracts.length}</span>}</button>
      {ordersOpen && <button className={tab === "order" ? "primary" : "subtle"} onClick={() => setTab("order")}><PackagePlus size={15}/> Post an order</button>}
    </div>
    {tab === "order" && ordersOpen && <BellOrderPanel snapshot={snapshot} busy={busy} submit={submit}/>}
    {!unlocked && <p className="hint">The barge is under repair until Night 2.</p>}
    {unlocked && !canCast && !snapshot.spectator && <p className="hint">{snapshot.phase === "open" ? "Too late to cast off tonight. The barge leaves again at preparation." :
      "The river is closed until the next evening."}</p>}
    {tab === "bell" && <div className="prep-list">
      {ordered.map(contract => <div className={"order-row" + (contract.relief ? " relief-row" : "")} key={contract.id}>
        {contract.relief ? <LifeBuoy size={16}/> : <Bell size={16}/>}<div className="row-main">
          <strong>{contract.kind === "escort" ? "Escort a rival" : contract.relief
            ? "Relight " + merchants[contract.stall as StallId].name + " · " + contract.quantity + " " + items[contract.item as ItemId].name
            : contract.quantity + " " + items[contract.item as ItemId].name + " for " + merchants[contract.stall as StallId].name}</strong>
          <small>{villages[contract.village as VillageId].name} · {contract.payout} coins{contract.relief ? " from the harbor, plus a restart float for the stall" : " · Escrowed"}{contract.mine ? " · Accepted" : ""}</small>
        </div>
        <button className="subtle" disabled={busy || !canCast || !!mine} onClick={() => void submit({ type: "accept_contract", contract_id: contract.id })}>
          {contract.mine ? "Accepted" : "Accept"}
        </button>
      </div>)}
      {!contracts.length && <p className="hint">The Harbor Bell is quiet. You can still buy cargo upriver.</p>}
      {mine && canCast && <button className="primary wide" disabled={busy} onClick={depart}>
        Cast off for {villages[mine.village as VillageId].name} <Anchor size={16}/>
      </button>}
    </div>}
    {tab === "barge" && <>
      <BargeLooks snapshot={snapshot} busy={busy} canFit={canCast} submit={submit}/>
      {(snapshot.river.almanac.tonight || snapshot.river.almanac.tomorrow) && <div className="landing-almanac" aria-label="Harbor almanac">
        <small>Harbor almanac</small>
        {(["tonight", "tomorrow"] as const).map(when => {
          const entry = snapshot.river.almanac[when];
          return entry && <p key={when}><b>{when === "tonight" ? "Tonight" : "Tomorrow"} · {entry.name} at {villages[entry.village as VillageId].name}.</b> {entry.detail}</p>;
        })}
      </div>}
      <label className="order-row"><span className="row-main"><strong>Barge trim</strong><small>Free to switch between runs · fitted at cast-off</small></span>
        <select aria-label="Barge trim" value={trim} disabled={busy || !canCast || !trimsUnlocked}
          onChange={event => setTrim(event.target.value as BargeTrimId)}>
          {Object.entries(bargeTrims).map(([id, value]) => <option key={id} value={id}>{value.name}</option>)}
        </select>
      </label>
      <p className="hint">{trimsUnlocked ? bargeTrims[trim].description : "Barge trims unlock on Night 3."}</p>
      {canCast && <p className="hint">{mine ? "Your accepted contract sets the course. " : "Buy freely at any village upriver, up to a full hold. "}{leaving}</p>}
      <div className="landing-board" aria-label="Upriver prices">
        {loads.map(({ village, item, stock, price, label }) => <div className="landing-load" key={item}>
          <i style={{ background: cargoColor[item] }}/>
          <span><strong>{items[item as ItemId].name}</strong><small>{villages[village as VillageId].name} · {stock} in stock · {label}</small></span>
          <b>{price}<Coins size={12}/></b>
        </div>)}
      </div>
      {leads.length > 0 && <div className="landing-leads"><small>Best spot hauls</small>
        {leads.map(lead => <span key={lead.item + lead.stall}><Flame size={12}/>{items[lead.item as ItemId].name}: {lead.port} {lead.buy} → {merchants[lead.stall as StallId].name} {lead.sell}</span>)}
      </div>}
      {snapshot.river.wrecks.length > 0 && <div className="landing-wrecks" aria-label="Wrecks on the river">
        <small>Wrecks on the river</small>
        {snapshot.river.wrecks.map(wreck => <div className="landing-wreck" key={wreck.id}><i/>
          <span><strong>Wreck of {wreck.name} on {reaches[wreck.reach as ReachId].name}</strong>
            <small>{Object.entries(wreck.cargo).map(([item, qty]) => qty + " " + items[item as ItemId].name.toLowerCase()).join(", ")} · {
              !wreck.open ? "the harbor marks it at the next dusk" : wreck.claimed ? "another barge is salvaging it"
                : wreck.nightsLeft === 1 ? "breaks up after tonight" : wreck.nightsLeft + " nights left"}</small></span>
        </div>)}
      </div>}
      {canCast && <button className="primary wide" disabled={busy} onClick={depart}>
        Cast off <small>{mine ? mine.kind === "escort" ? "escort" : "contract" : snapshot.barge.hold + "-unit hold"}</small><Anchor size={16}/>
      </button>}
      <details className="landing-upgrades"><summary>Barge upgrades</summary>
        {Object.entries(bargeUpgrades).filter(([id]) => !snapshot.barge.upgrades.includes(id) &&
          (!id.endsWith("_ii") || snapshot.barge.upgrades.includes(id.replace("_ii", "_i")))).map(([id, upgrade]) =>
          <button className="subtle" key={id} disabled={busy || Number(snapshot.coins) < upgrade.price || !canCast}
            onClick={() => void submit({ type: "buy_barge_upgrade", upgrade_id: id })}>{upgrade.name} · {upgrade.price} <Coins size={13}/></button>)}
      </details>
    </>}
  </div>;
}

export function routeLeads(snapshot: Snapshot) {
  return Object.entries(snapshot.villages).flatMap(([id, village]) => {
    const port = villages[id as VillageId];
    const risk = snapshot.river.reaches.filter(reach => reach.id === port.reach || reach.id === "heron_reach")
      .reduce((sum, reach) => sum + reach.danger * .6 + Number(reach.boom) * 2, 0);
    return Object.entries(village.prices).flatMap(([item, quote]) => Object.entries(snapshot.merchants)
      .filter(([, stall]) => stall.band !== "dark" && stall.prices[item] && Number(stall.stock[item]) < Number(stall.prices[item]!.target))
      .map(([stall, market]) => ({ item, stall, port: port.name, buy: Number(quote.buy), sell: Number(market.prices[item]!.sell),
        score: routeLead(Number(market.prices[item]!.sell), Number(quote.buy), routeDistance(id as VillageId), risk) })));
  }).sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Post a Bell order: escrow coins and let the rival haulers decide whether the job is worth their while. */
function BellOrderPanel({ snapshot, busy, submit }: { snapshot: Snapshot; busy: boolean; submit: (intent: Intent) => Promise<void> }) {
  const goods = Object.values(snapshot.villages).flatMap(port => Object.keys(port.stock)) as ItemId[];
  const [item, setItem] = useState<ItemId>(goods.includes("oil") ? "oil" : goods[0]!);
  const village = sourceFor(item)!, port = snapshot.villages[village];
  const villagePrice = Number(port?.prices[item]?.buy ?? items[item].price);
  const [quantity, setQuantity] = useState(6);
  const [price, setPrice] = useState<number>();
  const unitPrice = Math.min(bellOrderLimits.maxPrice, Math.max(bellOrderLimits.minPrice, price ?? villagePrice + 3));
  const total = quantity * unitPrice, purse = Number(snapshot.coins);
  const order = snapshot.river.myOrder;
  const closed = snapshot.phase === "results";
  if (order) return <div className="bell-order" aria-label="Your Bell order">
    <strong>{order.quantity} {items[order.item as ItemId].name.toLowerCase()} at {order.unitPrice} coins each</strong>
    <small>{order.escrow} coins held at the Harbor Bell · {order.delivered} delivered · {order.waiting} waiting for a hauler{order.cancelled ? " · cancelled" : ""}</small>
    {order.hauling.map((haul, i) => <p key={i} className="bell-order-haul"><Anchor size={13}/> {haul.name} is hauling {haul.quantity}
      {haul.eta > 0 ? " · arrives in " + Math.ceil(haul.eta) + " s" : " · arriving"}</p>)}
    <p className="hint" role="status">{order.news}</p>
    {!order.cancelled && <button className="subtle" disabled={busy || closed} onClick={() => void submit({ type: "cancel_bell_order", order_id: order.id })}>Cancel order</button>}
  </div>;
  return <div className="bell-order-form">
    <p className="hint">Ring the Harbor Bell for goods from upriver. Your coins wait at the bell; a rival hauler takes the job only if your price beats the village price by enough for the trip, and is paid per unit delivered. Whatever is left comes back when the night ends.</p>
    <label>Goods<select aria-label="Order item" value={item} onChange={event => { setItem(event.target.value as ItemId); setPrice(undefined); }}>
      {goods.map(id => <option key={id} value={id}>{items[id].name} · {villages[sourceFor(id)!].name}</option>)}
    </select></label>
    <label>Units<input aria-label="Order quantity" type="number" min={1} max={bellOrderLimits.quantity} value={quantity}
      onChange={event => setQuantity(Math.min(bellOrderLimits.quantity, Math.max(1, Math.round(Number(event.target.value) || 1))))}/></label>
    <label>Price per unit<input aria-label="Price per unit" type="number" min={bellOrderLimits.minPrice} max={bellOrderLimits.maxPrice} value={unitPrice}
      onChange={event => setPrice(Math.round(Number(event.target.value) || bellOrderLimits.minPrice))}/></label>
    <p className="hint">{villages[village].name} sells {items[item].name.toLowerCase()} at about {villagePrice} coins now{
      unitPrice <= villagePrice ? ". At this price no hauler will take the job." : "."}</p>
    <p className={"bell-order-total" + (total > purse ? " short" : "")}>Reserve <b>{total}</b> coins{total > purse ? " · you have " + purse + ", " + (total - purse) + " short" : ""}</p>
    <button className="primary wide" disabled={busy || closed || total > purse}
      onClick={() => void submit({ type: "post_bell_order", item_id: item, quantity, unit_price: unitPrice })}>
      Ring the bell <small>{quantity} × {unitPrice}</small><Bell size={16}/></button>
  </div>;
}
