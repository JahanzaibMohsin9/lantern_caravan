import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Check, ChevronRight, CircleAlert, Clock3, Coins, Compass, MoonStar,
  Package, Pause, Play, Settings2, Ship, Sparkles, Volume2, VolumeX, Waves,
} from "lucide-react";
import { merchants, type StallId } from "@lantern/content";
import type { HaggleOffer, Intent, Quote, Snapshot } from "@lantern/protocol";
import { capacity, duration } from "@lantern/game-core";
import { backend } from "../config";
import { bridge, stops, type Effect, type Panel, type Stop } from "../world/bridge";
import { mountRow } from "../world/Row";
import { play } from "../world/sound";
import { LanternMark, stopIcons } from "./icons";
import { Board, formatTime, Inventory, PanelFrame, Trade, Workshop } from "./Panels";

const tell = (error: unknown) => error instanceof Error ? error.message : "Please try again.";
const id = () => crypto.randomUUID();

function localPreference(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function App() {
  const world = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const notificationTimer = useRef<number>(0);
  const [snapshot, setSnapshot] = useState(() => backend.view());
  const [ready, setReady] = useState(false);
  const [returning, setReturning] = useState(false);
  const [entered, setEntered] = useState(false);
  const [panel, setPanel] = useState<Panel>();
  const [current, setCurrent] = useState<Stop>("workshop");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ line: string; error: boolean }>();
  const [volume, setVolume] = useState(() => Number(localPreference("lantern-volume", "0.5")));
  const [reduced, setReduced] = useState(() => localPreference("lantern-reduced",
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "true" : "false") === "true");
  const [guide, setGuide] = useState(() => localPreference("lantern-guide", "true") === "true");
  const nightOpen = entered && snapshot.phase === "open";
  const paused = panel === "pause" || panel === "settings";
  const delivered = Number(snapshot.delivered);
  const cargo = Object.values(snapshot.cargo).reduce((sum, count) => sum + Number(count), 0);
  const boats = snapshot.orders.filter(order => order.state === "filled").length;
  const lanterns = Number(snapshot.cargo.lantern_paper);
  const canCraft = Number(snapshot.cargo.paper) > 0 && Number(snapshot.cargo.oil) > 0;

  function notify(line: string, error = false) {
    setToast({ line, error });
    clearTimeout(notificationTimer.current);
    notificationTimer.current = window.setTimeout(() => setToast(undefined), 3000);
  }

  useEffect(() => {
    const destroy = mountRow(world.current!);
    const unsubscribe = [
      bridge.on("arrive", setPanel),
      bridge.on("current", setCurrent),
    ];
    let mounted = true;
    void backend.restore().then(found => {
      if (!mounted) return;
      setReturning(found);
      setSnapshot(backend.view());
    }).catch(() => { if (mounted) notify("Couldn’t read the last save. You can still start a new night.", true); })
      .finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; destroy(); unsubscribe.forEach(fn => fn()); clearTimeout(notificationTimer.current); };
  }, []);

  useEffect(() => { bridge.send("snapshot", snapshot); }, [snapshot]);
  useEffect(() => { bridge.send("active", nightOpen); }, [nightOpen]);
  useEffect(() => { bridge.send("blocked", !!panel); }, [panel]);
  useEffect(() => { bridge.send("reduced", reduced); }, [reduced]);
  useEffect(() => {
    try {
      localStorage.setItem("lantern-volume", String(volume));
      localStorage.setItem("lantern-reduced", String(reduced));
      localStorage.setItem("lantern-guide", String(guide));
    } catch { /* preferences are optional */ }
  }, [volume, reduced, guide]);

  useEffect(() => {
    if (!nightOpen || paused) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = (now - previous) / 1000;
      previous = now;
      if (document.hidden) return;
      void backend.tick(delta).then(next => {
        setSnapshot(next);
        if (next.phase === "results") setPanel(undefined);
      });
    }, 250);
    return () => clearInterval(timer);
  }, [nightOpen, paused]);

  function visit(stop: Stop) {
    setPanel(undefined);
    bridge.send("visit", stop);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        if (panel) setPanel(undefined);
        else if (nightOpen) setPanel("pause");
        return;
      }
      if (!nightOpen || paused || (event.target instanceof HTMLElement &&
        (event.target.matches("input, select, textarea") || event.target.isContentEditable))) return;
      const stop = /^[1-8]$/.test(key) ? stops[Number(key) - 1] : undefined;
      if (stop) visit(stop.id);
      else if (key === "e" && !panel) visit(current);
      else if (key === "i") setPanel(panel === "inventory" ? undefined : "inventory");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nightOpen, paused, panel, current]);

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      return await task();
    } catch (error) {
      notify(tell(error), true);
    } finally {
      setSnapshot(backend.view());
      locked.current = false;
      setBusy(false);
    }
  }

  async function openMarket(restart = false) {
    await run(async () => {
      const session = !returning || restart
        ? (await backend.createSession({ slot: "first-light" })).sessionId
        : snapshot.session_id;
      if (backend.view().phase === "preparation") await backend.advancePhase(session, id());
      setReturning(true);
      setPanel(undefined);
      setEntered(true);
    });
  }

  function feedback(effect: Effect) {
    bridge.send("effect", effect);
    play(effect, volume);
  }

  async function settle(quote: Quote) {
    const before = backend.view().orders.filter(order => order.state === "filled").length;
    await backend.submitAction(snapshot.session_id, snapshot.night_id, quote.quote_id, id());
    const after = backend.view().orders.filter(order => order.state === "filled").length;
    const effect = { buy: "buy", sell: "sell", craft: "craft", fill_order: "deliver", sell_crowd: "sell" } as const;
    feedback(after > before ? "boat" : effect[quote.intent.type]);
    notify(after > before ? "A boat is lit!" : quote.summary);
    return true;
  }

  const actions = {
    busy,
    submit: async (intent: Intent) => {
      await run(async () => settle(await backend.getQuote(snapshot.session_id, snapshot.night_id, intent)));
    },
    getQuote: (intent: Intent) => run(() => backend.getQuote(snapshot.session_id, snapshot.night_id, intent)),
    accept: async (quote: Quote) => (await run(() => settle(quote))) ?? false,
    haggle: (offer: HaggleOffer) => run(async () => {
      const result = await backend.haggle(snapshot.session_id, snapshot.night_id, offer);
      feedback(result.outcome === "refuse" ? "refuse" : "deal");
      return result;
    }),
  };

  const close = () => setPanel(undefined);
  const panelStall = panel && Object.hasOwn(merchants, panel) ? panel as StallId : undefined;
  const lowTime = nightOpen && duration - snapshot.elapsed <= 60;
  const nextStop = lanterns ? "board" : canCraft ? "workshop" : Number(snapshot.cargo.paper) === 0 ? "paper_mill" : "oil_wharf";
  const nextHint = { board: "Deliver a lantern", workshop: "Craft a lantern", paper_mill: "Pick up paper", oil_wharf: "Pick up oil" }[nextStop];

  return <main className="game-shell" data-reduced={reduced}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><LanternMark/></span><div><strong>Lantern Row</strong><span>RIVERSIDE NIGHT MARKET</span></div></div>
      <div className="night-tag"><MoonStar size={16}/><span>NIGHT 01</span><span className="divider"/><b>First Light</b></div>
      <div className="hud">
        <span className="meter gold" title="Coins in your purse"><Coins size={18}/><b>{snapshot.coins}</b></span>
        <button className="meter" disabled={!entered} onClick={() => setPanel("inventory")} aria-label={`Cart ${cargo} of ${capacity} items`} title="Cart (I)">
          <Package size={17}/><b>{cargo}<span className="muted"> / {capacity}</span></b>
        </button>
        <span className={`meter clock ${lowTime ? "low-time" : ""}`} title="Time until closing"><Clock3 size={17}/><b>{formatTime(duration - snapshot.elapsed)}</b></span>
      </div>
      <div className="header-actions">
        <button className="icon-button" onClick={() => setVolume(volume ? 0 : .5)} aria-label={volume ? "Mute sound" : "Unmute sound"} title={volume ? "Mute sound" : "Unmute sound"}>
          {volume ? <Volume2 size={19}/> : <VolumeX size={19}/>}
        </button>
        <button className="icon-button" onClick={() => setPanel(nightOpen ? "pause" : "settings")} aria-label={nightOpen ? "Pause" : "Settings"} title={nightOpen ? "Pause (Esc)" : "Settings"}>
          {nightOpen ? <Pause size={19}/> : <Settings2 size={19}/>}
        </button>
      </div>
    </header>

    <div className="stage" aria-label="Riverside market">
      <div ref={world} className="world"/>
      <div className="vignette" aria-hidden="true"/>
      {!entered && !panel && <div className="hero">
        <div className="eyebrow hero-kicker"><span/> A RIVERSIDE TRADING GAME</div>
        <h1>Lantern <em>Row</em></h1>
        <p>Trade by lanternlight.</p>
        <button className="primary enter" disabled={!ready || busy} onClick={() => void openMarket()}>
          <Play size={17} fill="currentColor"/>{ready ? returning ? "Continue" : "Enter the Row" : "Opening the Row"}<ArrowRight size={19}/>
        </button>
      </div>}

      {nightOpen && <>
        <div className="objective">
          <div className="objective-icon"><LanternMark size={28}/></div>
          <div><div className="eyebrow">FIRST LIGHT</div><strong>{delivered >= 3 ? "The river is lit" : "Light the river"}</strong>
            <div className="objective-progress">
              {[0, 1, 2].map(index => <i key={index} className={index < delivered ? "filled" : ""}/>)}
              <small>{Math.min(delivered, 3)} / 3 delivered</small>
            </div>
          </div>
        </div>
        {!panel && delivered < 3 && guide && <div className="guide">
          <button className="guide-next" onClick={() => visit(nextStop)}><Sparkles size={15}/>{nextHint}<ChevronRight size={16}/></button>
          <button className="guide-skip" onClick={() => setGuide(false)} aria-label="Hide tutorial hint">Skip</button>
        </div>}
        {!panel && delivered >= 3 && <button className="primary finish" disabled={busy} onClick={() => void run(async () => {
          await backend.advancePhase(snapshot.session_id, id());
        })}>Close the night <ArrowRight size={17}/></button>}
      </>}

      <div className="stage-footer">
        <div className="key-hints"><span><kbd>A</kbd><kbd>D</kbd> Walk</span><span><kbd>E</kbd> Interact</span><span><kbd>I</kbd> Cart</span></div>
        <div className="river-meter" title={`${boats} of 6 boats lit`} aria-label={`${boats} of 6 boats lit`}>
          <Waves size={16}/><span aria-hidden="true">{Array.from({ length: 6 }, (_, index) =>
            <i key={index} className={snapshot.orders.some(order => order.boat === index && order.state === "filled") ? "filled" : ""}/>)}</span><b>{boats} / 6</b>
        </div>
      </div>

      {entered && snapshot.phase === "results" && !panel && <div className="result-shade">
        <section className="results" aria-label="Night results">
          <span className="result-emblem"><LanternMark size={43}/></span>
          <div className="eyebrow">NIGHT 01 · RESULTS</div>
          <h2>{delivered >= 3 ? "First Light" : "The Row is closing"}</h2>
          <div className="result-metrics">
            <div><Ship size={19}/><b>{boats}</b><small>Boats lit</small></div>
            <div><LanternMark size={23}/><b>{delivered} / 3</b><small>Delivered</small></div>
            <div><Coins size={19}/><b>{snapshot.coins}</b><small>Coins</small></div>
          </div>
          <div className="button-pair">
            <button className="primary" onClick={() => void openMarket(true)} disabled={busy}>Replay night <ArrowRight size={17}/></button>
            <button className="subtle" onClick={() => setEntered(false)}>Title</button>
          </div>
        </section>
      </div>}

      {panelStall && <PanelFrame key={panel} title={merchants[panelStall].name} eyebrow={merchants[panelStall].keeper} icon={(() => {
        const Icon = stopIcons[panelStall]; return <Icon size={24}/>;
      })()} onClose={close}>
        <Trade stall={panelStall} snapshot={snapshot} actions={actions}/>
      </PanelFrame>}
      {panel === "workshop" && <PanelFrame title="Workshop" eyebrow="CRAFT" icon={<LanternMark/>} onClose={close}><Workshop snapshot={snapshot} actions={actions}/></PanelFrame>}
      {panel === "board" && <PanelFrame title="Order Board" eyebrow="FESTIVAL" icon={<Ship size={24}/>} onClose={close}><Board snapshot={snapshot} actions={actions}/></PanelFrame>}
      {panel === "inventory" && <PanelFrame title="Handcart" eyebrow={`${cargo} / ${capacity} SLOTS`} icon={<Package size={24}/>} onClose={close}><Inventory snapshot={snapshot}/></PanelFrame>}
      {panel === "shed" && <PanelFrame title="Shed" eyebrow="WEST END" icon={<Compass size={24}/>} onClose={close}>
        <p className="hint">The market starts at Paper Mill.</p><button className="subtle wide" onClick={() => visit("paper_mill")}>Visit Paper Mill <ArrowRight size={16}/></button>
      </PanelFrame>}
      {panel === "pause" && <PanelFrame title="Paused" eyebrow="FIRST LIGHT" icon={<Pause size={24}/>} onClose={close}>
        <button className="primary wide" onClick={close}>Resume <Play size={16}/></button>
        <button className="subtle wide" onClick={() => setPanel("settings")}>Settings <Settings2 size={17}/></button>
        <button className="subtle wide" onClick={() => { setEntered(false); close(); }}>Title <ArrowRight size={17}/></button>
      </PanelFrame>}
      {panel === "settings" && <PanelFrame title="Settings" eyebrow="LANTERN ROW" icon={<Settings2 size={24}/>} onClose={close}>
        <label className="settings-row"><span>Sound</span><input type="range" min="0" max="1" step=".05" value={volume} onChange={event => setVolume(Number(event.target.value))}/></label>
        <label className="settings-row"><span>Reduced motion</span><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)}/></label>
        <label className="settings-row"><span>Tutorial hints</span><input type="checkbox" checked={guide} onChange={event => setGuide(event.target.checked)}/></label>
      </PanelFrame>}

      {toast && <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"}>
        {toast.error ? <CircleAlert size={18}/> : <Check size={18}/>} {toast.line}
      </div>}
    </div>

    <nav className="route" aria-label="Market locations">
      <div className="route-heading"><Compass size={19}/><span>THE ROW</span></div>
      <div className="route-stops">
        {stops.map((stop, index) => {
          const Icon = stopIcons[stop.id];
          return <button className={current === stop.id ? "route-stop here" : "route-stop"} key={stop.id} onClick={() => visit(stop.id)}
            disabled={!nightOpen || paused} aria-current={current === stop.id ? "location" : undefined} title={`${stop.name} (${index + 1})`}>
            <Icon size={18}/><span>{stop.name}</span><kbd>{index + 1}</kbd>
          </button>;
        })}
      </div>
    </nav>
    <footer className="game-footer">
      <span><i className={snapshot.saveStatus === "unsaved" ? "unsaved" : ""}/>{backend.environmentLabel}{snapshot.saveStatus === "unsaved" && " · Unsaved"}</span>
      <span>FIRST LIGHT BUILD <span className="divider"/> v0.1</span>
    </footer>
  </main>;
}
