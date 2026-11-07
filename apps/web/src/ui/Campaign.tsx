import { Anchor, ArrowRight, Bell, BookOpen, Check, Coins, Package, Play, Ship, Sparkles, Trash2, Users } from "lucide-react";
import { items, merchants, recipes, type ItemId, type StallId } from "@lantern/content";
import { strategies, upgrades, type StrategyId, type UpgradeId } from "@lantern/content/nights";
import type { ProfileSummary, Snapshot } from "@lantern/protocol";
import { LanternMark, ItemIcon } from "./icons";
import type { Stop } from "../world/bridge";
import { formatTime, type Actions } from "./Panels";

export const nightLabel = (night: number) => "Night " + String(night).padStart(2, "0");
const merchantName = (stall: string) => merchants[stall as StallId]?.name ?? stall;

export function guideFor(snapshot: Snapshot): { stop: Stop; line: string; item?: ItemId } | undefined {
  if (snapshot.mode !== "campaign" || snapshot.objective.complete) return;
  if (snapshot.job) return { stop: "shed", line: "Take the parcel to the dock" };
  if (snapshot.jobAvailable) return { stop: "board", line: "Pick up a dock job" };
  if (snapshot.night === 2 && snapshot.merchants.oil_wharf?.band === "dark") return { stop: "shed", line: "Ring the Harbor Bell: haul oil to relight the wharf, or pledge at Oil Wharf" };
  if (snapshot.night === 3 && snapshot.objective.steps.slice(0, 2).some(step => step.count === "0"))
    return { stop: "shed", line: "Cast off: break the Marsh Bend boom and fill a contract or escort" };
  const orders = snapshot.orders.filter(order => order.state === "open");
  if (orders.some(order => Number(snapshot.cargo[order.item]))) return { stop: "board", line: "Deliver a lantern" };
  if (snapshot.night === 2) {
    orders.sort((a, b) => Number(b.item === "lantern_paper") - Number(a.item === "lantern_paper"));
  }
  const order = orders[0] ?? snapshot.orders.find(order => order.state === "upcoming");
  const recipe = Object.values(recipes).find(recipe => recipe.output === order?.item);
  if (!recipe) return;
  const ingredient = recipe.inputs.find(item => !Number(snapshot.cargo[item]));
  if (!ingredient) return { stop: "workshop", line: "Craft a lantern", item: recipe.output };
  const sellers = Object.entries(snapshot.merchants)
    .filter(([, market]) => market.band !== "dark" && Number(market.stock[ingredient]))
    .sort(([, a], [, b]) => Number(a.prices[ingredient]!.buy) - Number(b.prices[ingredient]!.buy));
  if (!sellers[0]) return;
  return { stop: sellers[0][0] as Stop, line: "Pick up " + items[ingredient].name.toLowerCase(), item: ingredient };
}

export function Objective({ snapshot }: { snapshot: Snapshot }) {
  return <div className="objective">
    <div className="objective-icon"><LanternMark size={28}/></div>
    <div><div className="eyebrow">{snapshot.nightName}</div><strong>{snapshot.objective.complete ? "The river is lit" : snapshot.objective.name}</strong>
      <div className="objective-progress">
        {snapshot.objective.steps.length === 1 ? <>
          {Array.from({ length: Number(snapshot.objective.steps[0]!.target) }, (_, index) =>
            <i key={index} className={index < Number(snapshot.objective.steps[0]!.count) ? "filled" : ""}/>)}
          <small>{snapshot.objective.steps[0]!.count} / {snapshot.objective.steps[0]!.target} {snapshot.objective.steps[0]!.label}</small>
        </> : snapshot.objective.steps.map(step => <span className="objective-step" key={step.label} title={step.label}>
          {["wharf", "boom", "run", "flood"].includes(step.icon) ? <Anchor size={14}/> : step.icon === "bell" ? <Bell size={14}/> : <ItemIcon item={step.icon as ItemId} size={14}/>}
          <small>{step.icon === "wharf" ? Number(step.count) ? "Relit" : "Dark" : step.count + "/" + step.target}</small>
        </span>)}
      </div>
    </div>
  </div>;
}

export function Preparation({ snapshot, actions, advance, landing }: { snapshot: Snapshot; actions: Actions; advance: () => void; landing?: () => void }) {
  const owned = Object.entries(snapshot.merchants).filter(([, market]) => Number(market.owned));
  const available = (Object.entries(upgrades) as [UpgradeId, typeof upgrades[UpgradeId]][]).filter(([id, upgrade]) =>
    (snapshot.mode === "campaign" ? snapshot.night : 4) >= upgrade.unlock && !snapshot.upgrades.includes(id) &&
    (id !== "cart_ii" || snapshot.upgrades.includes("cart_i")));
  return <div className="result-shade">
    <section className="results preparation" aria-label="Night preparation">
      <span className="result-emblem"><LanternMark size={34}/></span>
      <div className="eyebrow">{nightLabel(snapshot.night)} · PREPARATION</div>
      <h2>{snapshot.nightName}</h2>
      <p className="hint">{snapshot.objective.name}{snapshot.night === 2 && " · 2 floating + 2 paper lanterns"}</p>
      {snapshot.mode === "campaign" && snapshot.night === 2 && <p className="hint">Ring the Harbor Bell → accept the oil relief haul → cast off → trade at Ember Falls → moor at The Landing. A rescue pledge at Oil Wharf also relights it.</p>}
      {snapshot.mode === "campaign" && snapshot.night === 3 && <p className="hint">Break the Marsh Bend boom, fill one contract or escort, and deliver 2 colored lanterns. Try a trim, salvage the storm wreck and visit two stops on Heron Reach. Shareholder strategy votes change contract premiums.</p>}
      {snapshot.mode === "campaign" && snapshot.night === 4 && <p className="hint">Post an order at The Landing: let the haulers bring the dye. The Firefly opens Floodtide at 1:10: if you are upriver, pass both locks and return within 60 seconds. Light all six boats for the Lantern Caravan.</p>}
      {owned.length > 0 && <div className="prep-list">
        <div className="eyebrow">Strategy votes</div>
        {owned.map(([stall, market]) => <label className="order-row" key={stall}>
          <span className="row-main"><strong>{merchantName(stall)}</strong><small>{market.owned} shares · {strategies[market.strategy].name}</small></span>
          <select aria-label={merchantName(stall) + " strategy"} value={market.vote ?? ""}
            disabled={actions.busy} onChange={event => void actions.submit({ type: "vote_strategy", stall_id: stall, strategy_id: event.target.value as StrategyId })}>
            <option value="" disabled>Cast a vote</option>
            {Object.entries(strategies).map(([id, strategy]) => <option key={id} value={id}>{strategy.icon} {strategy.name}</option>)}
          </select>
        </label>)}
      </div>}
      {available.length > 0 && <div className="prep-list">
        <div className="eyebrow">Cart upgrades</div>
        {available.map(([id, upgrade]) => <div className="order-row" key={id}>
          <Package size={17}/><div className="row-main"><strong>{upgrade.name}</strong><small>{upgrade.description}</small></div>
          <button className="subtle deliver" disabled={actions.busy || Number(snapshot.coins) < upgrade.price}
            onClick={() => void actions.submit({ type: "buy_upgrade", upgrade_id: id })}>{upgrade.price} <Coins size={13}/></button>
        </div>)}
      </div>}
      {landing && <button className="subtle wide" disabled={actions.busy} onClick={landing}>The Landing <ArrowRight size={16}/></button>}
      <button className="primary wide" disabled={actions.busy || snapshot.mode === "live"} onClick={advance}>
        {snapshot.mode === "live" ? "Market opens shortly" : "Open the market"} <Play size={16}/>
      </button>
    </section>
  </div>;
}

export function NightReport({ snapshot, busy, advance, retry, title, live }: {
  snapshot: Snapshot; busy: boolean; advance: () => void; retry: () => void; title: () => void; live?: () => void;
}) {
  const complete = snapshot.objective.complete;
  const finale = snapshot.mode === "campaign" && snapshot.night === 4 && complete;
  const dividends = Object.entries(snapshot.merchants).filter(([, merchant]) => Number(merchant.dividend));
  const canContinue = complete || snapshot.mode === "endless";
  return <div className={`result-shade ${finale ? "festival-finale" : ""}`}>
    <section className="results preparation" aria-label="Night results">
      <span className="result-emblem"><LanternMark size={43}/></span>
      <div className="eyebrow">{finale ? "CAMPAIGN COMPLETE" : nightLabel(snapshot.night) + " · RESULTS"}</div>
      <h2>{finale ? "Master of the Row" : complete ? snapshot.nightName : "The Row is closing"}</h2>
      <div className="result-metrics">
        {/* Tonight's river goals, as the Dock showed them. */}
        {snapshot.objective.steps.slice(0, 2).map(step => <div key={step.label}><Ship size={19}/><b>{step.count} / {step.target}</b><small>{step.label}</small></div>)}
        <div><Coins size={19}/><b>{snapshot.coins}</b><small>Coins</small></div>
      </div>
      {dividends.length > 0 && <div className="prep-list">
        <div className="eyebrow">Dividends</div>
        {dividends.map(([stall, market]) => <div className="order-row" key={stall}><Coins size={15} className="gold"/>
          <strong className="row-main">{merchantName(stall)}</strong><b className="gold">+{market.dividend}</b></div>)}
      </div>}
      <div className="result-details"><span>Earned <b>{snapshot.earned}</b></span><span>Spent <b>{snapshot.spent}</b></span>
        {finale && <span>Stalls saved <b>{snapshot.rescued}</b></span>}</div>
      {finale && <p className="hint"><Sparkles size={14}/> Four nights on the river, and the Row is supplied.</p>}
      <div className="button-pair">
        {snapshot.mode === "live" ? <button className="subtle" onClick={title}>Leave the Row</button> : <>
          <button className="primary" onClick={canContinue ? advance : retry} disabled={busy}>
            {finale ? "Play Endless" : canContinue ? "Next night" : "Retry night"} <ArrowRight size={16}/>
          </button>
          <button className="subtle" onClick={title}>Title</button>
        </>}
      </div>
      {finale && live && <button className="text-button" onClick={live}>Join the live market</button>}
    </section>
  </div>;
}

export function Journal({ snapshot, replay }: { snapshot: Snapshot; replay: () => void }) {
  return <>
    <div className="result-metrics">
      <div><Ship size={17}/><b>{snapshot.boatsHelped}</b><small>Boats helped</small></div>
      <div><Anchor size={17}/><b>{snapshot.rescued}</b><small>Stalls rescued</small></div>
      <div><Coins size={17}/><b>{snapshot.lifetimeDividends}</b><small>Dividends</small></div>
    </div>
    {!!snapshot.titles.length && <div className="title-chips">{snapshot.titles.map(title => <span key={title}><Check size={12}/> {title}</span>)}</div>}
    <details><summary>Merchant relationships</summary><div className="prep-list">
      {Object.entries(snapshot.merchants).map(([stall, merchant]) => <div className="split" key={stall}>
        <span>{merchantName(stall)}</span><b>{merchant.relationship > 0 ? "+" : ""}{merchant.relationship}</b>
      </div>)}</div></details>
    <div className="eyebrow">Activity</div>
    {snapshot.activity.length === 0 && <p className="hint"><BookOpen size={15}/> Your night is just beginning.</p>}
    {[...snapshot.activity].reverse().slice(0, 15).map((entry, index) => <div className="order-row" key={index}>
      <span className="row-main"><strong>{entry.line}</strong><small>{entry.actor && entry.actor + " · "}{entry.receipt?.label ?? nightLabel(entry.night)}</small></span>
      {entry.receipt?.url ? <a href={entry.receipt.url} target="_blank" rel="noreferrer">Details</a> : <small>{formatTime(entry.at)}</small>}
    </div>)}
    {snapshot.mode === "campaign" && <button className="subtle" onClick={replay}><Sparkles size={16}/> Show tutorial hints</button>}
  </>;
}

export function Profiles({ profiles, slots, busy, open, remove }: {
  profiles: ProfileSummary[]; slots: readonly string[]; busy: boolean; open: (slot: string) => void; remove: (slot: string) => void;
}) {
  return <>{slots.map((slot, index) => {
    const profile = profiles.find(entry => entry.slot === slot);
    return <div className="order-row" key={slot}>
      <span className="tile-icon"><Users size={17}/></span>
      <div className="row-main"><strong>Slot {index + 1}</strong><small>{profile?.updated ? nightLabel(profile.night ?? 1) + " · " +
        new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(profile.updated) : profile ? "Save unreadable" : "Empty"}</small></div>
      <button className="subtle deliver" disabled={busy || (!!profile && !profile.updated)} onClick={() => open(slot)}>{profile ? "Continue" : "New"}</button>
      {profile && <button className="icon-button" aria-label={`Delete slot ${index + 1}`} title={`Delete slot ${index + 1}`}
        disabled={busy} onClick={() => remove(slot)}><Trash2 size={15}/></button>}
    </div>;
  })}</>;
}
