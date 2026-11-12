import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowRight, Droplets, ExternalLink, Eye, FastForward, Globe2, Pause, Play, Plus } from "lucide-react";
import { items, merchants, type ItemId, type StallId } from "@lantern/content";
import { reaches, villageGoods, villages, type VillageId } from "@lantern/content/river";
import { strategies } from "@lantern/content/nights";
import { advanceClock, createWorld, floodMarket, newNight, openNight, snapshotFor, type World } from "@lantern/game-core";
import type { ChronicleEntry, HistoryRange, HistoryRow, MarketBackend, StallHistoryRow } from "@lantern/protocol";
import type { DevNameAuth } from "../auth/dev";
import { formatTime } from "./Panels";
import { privyAppId } from "../config";

// Privy's SDK is large, so it loads only when someone opens the Live market panel.
const PrivySignIn = lazy(() => import("../auth/PrivySignIn"));

export function Rooms({ auth, enter, busy }: {
  auth: DevNameAuth; enter: (room: string, mode: "watch" | "join" | "create") => void; busy: boolean;
}) {
  const [state, setState] = useState(auth.getState());
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => auth.onChange(setState), [auth]);
  const [socialError, setSocialError] = useState("");
  const signing = state.status === "signing_in";
  const named = name.trim().length > 0;
  return <>
    {state.status !== "signed_in" ? <form className="prep-list room-form" onSubmit={event => {
      event.preventDefault();
      setSocialError("");
      void auth.signIn(name);
    }}>
      <label htmlFor="display-name">Display name</label>
      <input id="display-name" autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} maxLength={24} required/>
      {privyAppId && <Suspense fallback={<button type="button" className="primary" disabled>Loading sign-in…</button>}>
        <PrivySignIn appId={privyAppId} disabled={signing || !named} signOutRequested={() => auth.signedOut}
          onToken={async token => { setSocialError(""); await auth.signInWithPrivy(token, name); }} onError={setSocialError}/>
      </Suspense>}
      {privyAppId && <small className="hint">Google or email gives you your own NEAR testnet account. No wallet or seed phrase.</small>}
      <button className={privyAppId ? "subtle" : "primary"} disabled={signing}>{signing ? "Signing in…" : "Sign in"} <ArrowRight size={16}/></button>
      {privyAppId && <small className="hint">Sign in as a guest with just the name.</small>}
      {(socialError || state.error) && <small role="alert">{socialError || state.error}</small>}
    </form> : <>
      <div className="split"><strong>{state.player?.displayName}</strong><button className="text-button" onClick={() => void auth.signOut()}>Sign out</button></div>
      {state.detailsUrl && <a className="text-button near-account" href={state.detailsUrl} target="_blank" rel="noreferrer">
        Your NEAR account <ExternalLink size={12}/></a>}
      <button className="primary" disabled={busy} onClick={() => enter("the-row", "join")}><Globe2 size={17}/> Join The Row</button>
      <button className="subtle" disabled={busy} onClick={() => enter("", "create")}><Plus size={17}/> Create private room</button>
      <form className="room-code" onSubmit={event => { event.preventDefault(); enter(code.toLowerCase(), "join"); }}>
        <input aria-label="Room code" placeholder="Room code" value={code} onChange={event => setCode(event.target.value)} pattern="[a-zA-Z0-9-]+" maxLength={45} required/>
        <button className="subtle" disabled={busy}>Join</button>
      </form>
    </>}
    <button className="subtle" disabled={busy} onClick={() => enter("the-row", "watch")}><Eye size={17}/> Watch The Row</button>
  </>;
}

function Chart({ values, label }: { values: number[]; label: string }) {
  if (!values.length) return <div className="chart-empty">No {label.toLowerCase()} recorded yet.</div>;
  const high = Math.max(...values);
  const low = Math.min(...values);
  const last = values.length - 1;
  const points = values.map((value, index) =>
    [last ? 4 + index / last * 300 : 154, 61 - (value - low) / Math.max(1, high - low) * 50] as const);
  return <div className="market-chart">
    <div className="split"><small>{label}</small><b className="gold">{values[last]}</b></div>
    <svg viewBox="0 0 308 69" role="img" aria-label={`${label}, range ${low} to ${high}, latest ${values[last]}`}>
      {[10, 35, 60].map(y => <path key={y} d={`M4 ${y}H304`} stroke="#544154" strokeDasharray="2 4"/>)}
      <polyline points={points.map(([x, y]) => x + "," + y).join(" ")} stroke="#f0b17f" strokeWidth="1.8" fill="none"/>
      <circle cx={points[last]![0]} cy={points[last]![1]} r="3" fill="#ffc18a"/>
    </svg>
  </div>;
}

const periods = { day: "24 hours", week: "7 days", all: "All time" } as const;
const suppliers = ["paper_mill", "oil_wharf", "reed_thread", "indigo_atelier"] as const;

export function MarketHistoryPanel({ backend, room }: { backend: MarketBackend; room: string }) {
  const [category, setCategory] = useState("stalls");
  const [range, setRange] = useState<HistoryRange>("day");
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ rows: HistoryRow[]; entries: ChronicleEntry[] }>();
  const [error, setError] = useState("");
  const [stall, setStall] = useState<StallId>("paper_mill");
  const [chosen, setChosen] = useState("");
  useEffect(() => {
    let disposed = false;
    setError("");
    setResult(undefined);
    void Promise.all([backend.getHistory(room, range), backend.getChronicle(room)]).then(([history, chronicle]) => {
      if (!disposed) setResult({ rows: history.rows, entries: chronicle.entries });
    }).catch(() => { if (!disposed) setError("The market history is unavailable."); });
    return () => { disposed = true; };
  }, [backend, room, range, refresh]);

  const goods = Object.keys(merchants[stall].goods);
  const item = goods.includes(chosen) ? chosen : goods[0];
  const stallRows = (result?.rows ?? []).filter((row): row is StallHistoryRow => !row.kind || row.kind === "stall");
  const selected = stallRows.filter(row => row.stall === stall && row.item === item);
  const perStrategy = new Map<string, Map<number, number>>();
  for (const row of stallRows) {
    if (row.stall !== stall) continue;
    const nights = perStrategy.get(row.strategy) ?? new Map<number, number>();
    nights.set(row.night, Number(row.dividend));
    perStrategy.set(row.strategy, nights);
  }
  return <>
    <div className="tabs">
      {(Object.keys(periods) as HistoryRange[]).map(period => <button className={period === range ? "selected" : ""} key={period}
        onClick={() => setRange(period)}>{periods[period]}</button>)}
    </div>
    {error ? <><p role="alert" className="hint">{error}</p><button className="subtle" onClick={() => setRefresh(refresh + 1)}>Retry</button></>
      : !result ? <p className="hint" role="status">Loading market history…</p> : <>
        <div className="tabs" aria-label="History series">
          {["stalls", "villages", "reaches"].map(value => <button key={value} className={category === value ? "selected" : ""}
            onClick={() => setCategory(value)}>{value[0]!.toUpperCase() + value.slice(1)}</button>)}
        </div>
        {category === "stalls" ? <><div className="button-pair">
          <select value={stall} aria-label="Stall" onChange={event => setStall(event.target.value as StallId)}>
            {suppliers.map(stall => <option key={stall} value={stall}>{merchants[stall].name}</option>)}
          </select>
          <select value={item} aria-label="Item" onChange={event => setChosen(event.target.value)}>
            {goods.map(id => <option key={id} value={id}>{items[id as ItemId].name}</option>)}
          </select>
        </div>
        <Chart values={selected.map(row => Number(row.price))} label={items[item as ItemId]?.name + " ask"}/>
        <Chart values={selected.map(row => Number(row.coins))} label="Stall coins"/>
        {selected.some(row => Number(row.sharePrice)) && <Chart values={selected.map(row => Number(row.sharePrice ?? 0))} label="Share price"/>}
        <details><summary>Strategy results</summary>
          {[...perStrategy].map(([strategy, nights]) => <div className="split" key={strategy}>
            <span>{strategies[strategy as keyof typeof strategies].name} · {nights.size} nights</span>
            <small>{([...nights.values()].reduce((a, b) => a + b, 0) / nights.size).toFixed(1)} / share</small>
          </div>)}
        </details></> : <RiverHistory rows={result.rows} category={category}/> }
        <div className="eyebrow">Chronicle</div>
        {!result.entries.length && <p className="hint">Nothing has happened yet.</p>}
        {result.entries.slice(0, 10).map(entry => <div className="order-row" key={entry.id}><div className="row-main">
          <strong>{entry.line}</strong><small>Night {entry.night} · {formatTime(entry.at)} {entry.actor ? "· " + entry.actor : ""}</small>
        </div></div>)}
      </>}
  </>;
}

function RiverHistory({ rows, category }: { rows: HistoryRow[]; category: string }) {
  const [village, setVillage] = useState<VillageId>("millbrook");
  const [reach, setReach] = useState("heron_reach");
  const [chosen, setChosen] = useState("");
  if (category === "reaches") {
    const selected = rows.filter(row => row.kind === "reach" && row.reach === reach);
    return <>
      <select aria-label="Reach" value={reach} onChange={event => setReach(event.target.value)}>
        {Object.entries(reaches).map(([id, reach]) => <option key={id} value={id}>{reach.name}</option>)}
      </select>
      <Chart label="Reach danger" values={selected.flatMap(row => row.kind === "reach" ? [row.danger] : [])}/>
      <Chart label="Boom present" values={selected.flatMap(row => row.kind === "reach" ? [Number(row.boom)] : [])}/>
    </>;
  }
  const goods = Object.keys(villageGoods(village)), item = goods.includes(chosen) ? chosen : goods[0]!;
  const selected = rows.filter(row => row.kind === "village" && row.village === village && row.item === item);
  return <>
    <div className="button-pair">
      <select aria-label="Village" value={village} onChange={event => setVillage(event.target.value as VillageId)}>
        {Object.entries(villages).map(([id, village]) => <option key={id} value={id}>{village.name}</option>)}
      </select>
      <select aria-label="Village item" value={item} onChange={event => setChosen(event.target.value)}>
        {goods.map(id => <option key={id} value={id}>{items[id as ItemId].name}</option>)}
      </select>
    </div>
    <Chart label="Village coins" values={selected.flatMap(row => row.kind === "village" ? [Number(row.coins)] : [])}/>
    <Chart label={items[item as ItemId].name + " source ask"} values={selected.flatMap(row => row.kind === "village" ? [Number(row.price)] : [])}/>
    <Chart label={items[item as ItemId].name + " village stock"} values={selected.flatMap(row => row.kind === "village" ? [Number(row.stock)] : [])}/>
    <p className="hint">Source asks before personal trust discounts. Stock excludes cargo reserved by barges.</p>
  </>;
}

/** A week on the Row is seven market nights. At 60× a night takes five seconds, so a week plays in about 35. */
const weekNights = 7;

export function Simulator() {
  const model = useRef<World | undefined>(undefined);
  const [seed, setSeed] = useState(42);
  const [speed, setSpeed] = useState(60);
  const [running, setRunning] = useState(false);
  const [weekEnds, setWeekEnds] = useState<number>();
  const [view, setView] = useState(() => snapshotFor(createWorld("live"), "simulator", ""));
  const [points, setPoints] = useState<number[]>([]);
  const fresh = () => openNight(createWorld("live", seed));
  const show = (world: World) => {
    model.current = world;
    const next = snapshotFor(world, "simulator", "");
    setView(next);
    setPoints(old => [...old, Number(next.merchants.oil_wharf?.prices.oil?.buy ?? 0)].slice(-90));
  };
  function reset() {
    model.current = fresh();
    setView(snapshotFor(model.current, "simulator", ""));
    setPoints([]);
    setRunning(false);
    setWeekEnds(undefined);
  }
  function runWeek() {
    const world = model.current ?? fresh();
    model.current = world;
    setSpeed(60);
    setWeekEnds(world.night + weekNights);
    setRunning(true);
  }
  function flood() {
    let world = model.current ?? fresh();
    if (world.phase !== "open") world = openNight(newNight(world));
    const before = Number(snapshotFor(world, "simulator", "").merchants.oil_wharf?.prices.oil?.buy ?? 0);
    setPoints(old => old.length ? old : [before]);
    show(floodMarket(world, "oil_wharf", "oil", 12).world);
  }
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      let world = model.current ?? fresh();
      if (world.phase === "results") {
        if (weekEnds !== undefined && world.night + 1 >= weekEnds) {
          setRunning(false);
          setWeekEnds(undefined);
          return;
        }
        world = openNight(newNight(world));
      }
      show(advanceClock(world, world.elapsed + speed / 5));
    }, 200);
    return () => clearInterval(timer);
  }, [running, seed, speed, weekEnds]);
  const oil = view.merchants.oil_wharf?.prices.oil;
  return <>
    <div className="split"><strong>Night {view.night}{weekEnds !== undefined ? ` · week ends after night ${weekEnds - 1}` : ""}</strong>
      <span>{formatTime(view.elapsed)} · {view.orders.filter(order => order.state === "filled").length}/6 lit</span></div>
    <div className="tabs">
      {[10, 60, 300].map(rate => <button className={rate === speed ? "selected" : ""} key={rate} onClick={() => setSpeed(rate)}>{rate}×</button>)}
    </div>
    <div className="room-code">
      <label>Seed <input type="number" min="0" value={seed} onChange={event => setSeed(Math.min(2147483647, Math.max(0, Math.floor(Number(event.target.value)))))} /></label>
      <button className="subtle" onClick={reset}>Reset</button>
      <button className="primary" onClick={() => { setWeekEnds(undefined); setRunning(!running); }}>{running ? <Pause size={16}/> : <Play size={16}/>} {running ? "Pause" : "Run"}</button>
    </div>
    <div className="room-code">
      <button className="primary" disabled={running} onClick={runWeek}><FastForward size={16}/> Run a week</button>
      <button className="subtle" onClick={flood}><Droplets size={16}/> Flood Oil Wharf with oil</button>
    </div>
    <Chart values={points} label="Oil Wharf oil price"/>
    {oil?.why && <p className="hint price-why"><strong>Sami's reasoning:</strong> {oil.why}</p>}
    <div className="eyebrow">Latest activity</div>
    {view.activity.slice(-5).reverse().map((entry, index) => <small key={index}>Night {entry.night} · {entry.line}</small>)}
  </>;
}
