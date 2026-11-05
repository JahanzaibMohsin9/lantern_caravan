import { useEffect, useRef, useState } from "react";
import {
  Anchor, ArrowRight, BookOpen, Check, ChevronRight, CircleAlert, Clock3, Coins, Compass, MoonStar,
  Activity, ChartNoAxesCombined, Eye, Globe2, Package, Pause, Play, Settings2, Sparkles, Users, Volume2, VolumeX, Waves,
} from "lucide-react";
import { merchants, type ItemId, type StallId } from "@lantern/content";
import type { HaggleOffer, Intent, ProfileSummary, Quote, RunReport, Snapshot } from "@lantern/protocol";
import { backend, devAuth, guest, live, liveDefault, publicView } from "../config";
import type { HttpBackend } from "../backend/http";
import { slots } from "../backend/saves";
import { bridge, stops, type Effect, type Panel, type Stop } from "../world/bridge";
import { mountRow } from "../world/Row";
import { mixMarket, play, unlockSound } from "../world/sound";
import { LanternMark, stopIcons } from "./icons";
import { Board, formatTime, Inventory, PanelFrame, Trade, Workshop } from "./Panels";
import { guideFor, Journal, NightReport, nightLabel, Objective, Preparation, Profiles } from "./Campaign";
import { MarketHistoryPanel, Rooms, Simulator } from "./MarketExtras";
import { Landing } from "../river/Landing";
import { RiverRun } from "../river/RiverRun";

const tell = (error: unknown) => error instanceof Error ? error.message : "Please try again.";
const id = () => crypto.randomUUID();

function localPreference(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

const effects: Partial<Record<Intent["type"], Effect>> = {
  buy: "buy", sell: "sell", craft: "craft", fill_order: "deliver", sell_crowd: "sell",
  buy_offering: "deal", finish_job: "sell", buy_upgrade: "deal", vote_strategy: "deal",
};

export function App() {
  const world = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const notificationTimer = useRef<number>(0);
  const timeScale = useRef(1);
  const debug = import.meta.env.DEV && new URLSearchParams(location.search).has("debug");
  const [snapshot, setSnapshot] = useState(() => backend.view());
  const [online, setOnline] = useState(false);
  const active = useRef<typeof backend | HttpBackend>(backend);
  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [entered, setEntered] = useState(false);
  const [panel, setPanel] = useState<Panel>();
  const [current, setCurrent] = useState<Stop>("workshop");
  const [preferred, setPreferred] = useState<ItemId>();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ line: string; error: boolean }>();
  const [volume, setVolume] = useState(() => Number(localPreference("lantern-volume", "0.5")));
  const [music, setMusic] = useState(() => Number(localPreference("lantern-music", "0.65")));
  const [effectsLevel, setEffectsLevel] = useState(() => Number(localPreference("lantern-effects", "0.85")));
  const [fps, setFps] = useState(0);
  const [reduced, setReduced] = useState(() => localPreference("lantern-reduced",
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "true" : "false") === "true");
  const [guide, setGuide] = useState(() => localPreference("lantern-guide", "true") === "true");
  const [lowGraphics, setLowGraphics] = useState(() => localPreference("lantern-low", "false") === "true");
  const [largePanels, setLargePanels] = useState(() => localPreference("lantern-large-panels", "false") === "true");
  const previousMarket = useRef<Snapshot | undefined>(undefined);
  const riverRun = entered && !snapshot.spectator ? snapshot.river.myRun : undefined;
  const landingOpen = entered && !snapshot.spectator && snapshot.phase === "preparation";
  const nightOpen = entered && snapshot.phase === "open";
  const roaming = nightOpen || (entered && online && snapshot.spectator);
  const paused = panel === "pause" || panel === "settings";
  const cargo = Object.values(snapshot.cargo).reduce((sum, count) => sum + Number(count), 0);
  const boats = snapshot.orders.filter(order => order.state === "filled").length;
  const next = guideFor(snapshot);
  const currentSlot = profiles.find(profile => profile.slot === snapshot.session_id && profile.updated);
  const event = snapshot.events.find(entry => snapshot.elapsed >= entry.at - 12 && snapshot.elapsed < entry.at + 8);

  function notify(line: string, error = false) {
    setToast({ line, error });
    clearTimeout(notificationTimer.current);
    notificationTimer.current = window.setTimeout(() => setToast(undefined), 3400);
  }

  useEffect(() => {
    const destroy = mountRow(world.current!);
    void guest.signIn();
    const unsubscribe = [bridge.on("arrive", setPanel), bridge.on("current", setCurrent)];
    let mounted = true;
    void backend.listProfiles().then(async saved => {
      const preferred = localPreference("lantern-slot", slots[0]);
      const available = saved.find(row => row.slot === preferred && row.updated) ?? saved.find(row => row.updated);
      if (available) await backend.restore(available.slot);
      if (!mounted) return;
      setProfiles(saved);
      setSnapshot(backend.view());
    }).catch(() => { if (mounted) notify("Couldn’t read the saves. You can still start a new night.", true); })
      .finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; destroy(); unsubscribe.forEach(fn => fn()); clearTimeout(notificationTimer.current); };
  }, []);

  useEffect(() => {
    if (!liveDefault || entered) return;
    let cancelled = false;
    async function sample() {
      if (locked.current || document.hidden) return;
      try {
        await publicView.joinRoom("the-row", { spectate: true });
        if (!cancelled) bridge.send("snapshot", publicView.view());
      } catch { /* show the local market while the server is offline */ }
    }
    void sample();
    const timer = window.setInterval(() => void sample(), 3500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [entered]);

  useEffect(() => { bridge.send("snapshot", snapshot); }, [snapshot]);
  useEffect(() => { bridge.send("active", roaming); }, [roaming]);
  useEffect(() => { bridge.send("river", !!riverRun); }, [riverRun]);
  useEffect(() => { bridge.send("blocked", !!panel); }, [panel]);
  useEffect(() => { bridge.send("reduced", reduced); }, [reduced]);
  useEffect(() => { bridge.send("lowGraphics", lowGraphics); }, [lowGraphics]);
  useEffect(() => {
    const previous = previousMarket.current;
    previousMarket.current = snapshot;
    if (!nightOpen || !previous || previous.session_id !== snapshot.session_id || previous.night_id !== snapshot.night_id) return;
    if (boats > previous.orders.filter(order => order.state === "filled").length) play("boat", volume * effectsLevel);
    if (Object.entries(snapshot.merchants).some(([stall, market]) => market.band !== "dark" && previous.merchants[stall]?.band === "dark")) {
      play("relit", volume * effectsLevel);
    }
  }, [snapshot, nightOpen, boats, volume, effectsLevel]);
  useEffect(() => {
    mixMarket(nightOpen && (!paused || online), volume, music, boats, snapshot.duration - snapshot.elapsed <= 60);
  }, [nightOpen, paused, online, volume, music, boats, snapshot.duration - snapshot.elapsed <= 60]);
  useEffect(() => {
    try {
      localStorage.setItem("lantern-volume", String(volume));
      localStorage.setItem("lantern-reduced", String(reduced));
      localStorage.setItem("lantern-guide", String(guide));
      localStorage.setItem("lantern-music", String(music));
      localStorage.setItem("lantern-effects", String(effectsLevel));
      localStorage.setItem("lantern-low", String(lowGraphics));
      localStorage.setItem("lantern-large-panels", String(largePanels));
    } catch { /* preferences are optional */ }
  }, [volume, reduced, guide, music, effectsLevel, lowGraphics, largePanels]);

  useEffect(() => {
    if (!debug) return;
    let frames = 0, started = performance.now(), frame = 0;
    const sample = (now: number) => {
      frames++;
      if (now - started >= 1000) { setFps(Math.round(frames * 1000 / (now - started))); started = now; frames = 0; }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [debug]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const host = window as Window & { __lantern?: unknown };
    host.__lantern = {
      getSnapshot: () => active.current.view(),
      quoteAndSubmit: (intent: Intent) => run(async () => {
        const state = active.current.view();
        const deal = await active.current.getQuote(state.session_id, state.night_id, intent);
        return active.current.submitAction(state.session_id, state.night_id, deal.quote_id, id());
      }),
      haggle: (offer: HaggleOffer) => {
        const state = active.current.view();
        return active.current.haggle(state.session_id, state.night_id, offer);
      },
      setTimeScale: (value: number) => { if (Number.isFinite(value)) timeScale.current = Math.max(1, Math.min(300, value)); },
    };
    return () => { delete host.__lantern; };
  }, []);

  useEffect(() => {
    if (!nightOpen || paused || online) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.min(1, (now - previous) / 1000);
      previous = now;
      if (document.hidden || locked.current) return;
      void backend.tick(delta * timeScale.current).then(next => {
        setSnapshot(next);
        if (next.phase === "results") setPanel(undefined);
      });
    }, 250);
    return () => clearInterval(timer);
  }, [nightOpen, paused, online]);

  useEffect(() => {
    if (!online || !entered) return;
    let cancelled = false;
    const poll = async () => {
      if (locked.current || document.hidden) return;
      try {
        const view = await live.getSnapshot(snapshot.session_id);
        if (cancelled) return;
        setSnapshot(view);
        if (live.notice) { notify(live.notice); live.notice = ""; }
      } catch { if (!cancelled) setSnapshot(live.view()); }
    };
    const refresh = window.setInterval(() => void poll(), 2000);
    const animate = window.setInterval(() => { if (!locked.current && !document.hidden) setSnapshot(live.view()); }, 250);
    window.addEventListener("focus", poll);
    window.addEventListener("online", poll);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
      window.clearInterval(animate);
      window.removeEventListener("focus", poll);
      window.removeEventListener("online", poll);
    };
  }, [online, entered, snapshot.session_id]);

  function visit(stop: Stop, item?: ItemId) {
    setPreferred(item);
    setPanel(undefined);
    bridge.send("visit", stop);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (riverRun || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        if (panel) setPanel(undefined);
        else if (roaming) setPanel("pause");
        return;
      }
      if (!entered || paused || (event.target instanceof HTMLElement &&
        (event.target.matches("input, select, textarea") || event.target.isContentEditable))) return;
      if (key === "j") setPanel(panel === "journal" ? undefined : "journal");
      if (key === "h") setPanel(panel === "history" ? undefined : "history");
      if (landingOpen && key === "1") { setPanel("shed"); return; }
      if (!roaming) return;
      const stop = /^[1-8]$/.test(key) ? stops[Number(key) - 1] : undefined;
      if (stop) visit(stop.id);
      else if (key === "e" && !panel) visit(current);
      else if (key === "i") setPanel(panel === "inventory" ? undefined : "inventory");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, roaming, paused, panel, current, landingOpen, riverRun]);

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      return await task();
    } catch (error) {
      notify(tell(error), true);
    } finally {
      setSnapshot(active.current.view());
      locked.current = false;
      setBusy(false);
    }
  }

  async function openMarket(slot: string = snapshot.session_id) {
    unlockSound();
    await run(async () => {
      const profile = profiles.find(profile => profile.slot === slot && profile.updated);
      const session = profile ? await backend.joinRoom(slot) : await backend.createSession({ slot });
      if (backend.view().phase === "preparation" && backend.view().night === 1) await backend.advancePhase(session.sessionId, id());
      try { localStorage.setItem("lantern-slot", slot); } catch { /* preferences are optional */ }
      setProfiles(await backend.listProfiles().catch(() => profiles));
      active.current = backend;
      setOnline(false);
      setPanel(undefined);
      setEntered(true);
    });
  }

  async function enterLive(room: string, mode: "watch" | "join" | "create") {
    unlockSound();
    await run(async () => {
      if (mode === "create") await live.createSession({ slot: "private", mode: "live" });
      else await live.joinRoom(room, { spectate: mode === "watch" });
      active.current = live;
      setOnline(true);
      setEntered(true);
      setPanel(undefined);
    });
  }

  function advance() {
    void run(async () => {
      const updated = await active.current.advancePhase(snapshot.session_id, id());
      setPanel(undefined);
      if (updated.phase === "results" && updated.night === 3 && updated.objective.complete) {
        feedback("finale");
      } else if (updated.phase === "results" && Object.values(updated.merchants).some(merchant => Number(merchant.dividend))) {
        feedback("sell");
      }
    });
  }

  function title() {
    void run(async () => {
      if (entered && !online) await backend.save();
      setProfiles(await backend.listProfiles().catch(() => profiles));
      active.current = backend;
      setOnline(false);
      setPanel(undefined);
      setEntered(false);
    });
  }

  function feedback(effect: Effect) {
    bridge.send("effect", effect);
    play(effect, volume * effectsLevel);
  }

  async function settle(quote: Quote) {
    const session = active.current;
    const before = session.view();
    const status = await session.submitAction(snapshot.session_id, snapshot.night_id, quote.quote_id, id());
    if (status.state === "pending" || status.state === "unknown") { notify("Confirming…"); return true; }
    if (status.state !== "confirmed") throw new Error(status.reason ?? "This action could not settle.");
    const after = session.view();
    const lit = after.orders.filter(order => order.state === "filled").length > before.orders.filter(order => order.state === "filled").length;
    const relit = Object.entries(after.merchants).find(([stall, merchant]) =>
      merchant.band !== "dark" && before.merchants[stall]?.band === "dark");
    const effect = relit || lit ? undefined : effects[quote.intent.type];
    if (effect) feedback(effect);
    notify(relit ? merchants[relit[0] as StallId].name + " relit!" : lit ? "A boat is lit!" : quote.summary);
    return true;
  }

  function castOff(intent: Extract<Intent, { type: "start_run" }>) {
    void run(async () => {
      await settle(await active.current.getQuote(snapshot.session_id, snapshot.night_id, intent));
      setPanel(undefined);
    });
  }

  function finishRiver(report: RunReport) {
    void run(async () => {
      const intent = { type: "finish_run", run_id: report.run_id, report } as const;
      await settle(await active.current.getQuote(snapshot.session_id, snapshot.night_id, intent));
      setCurrent("shed");
      setPanel("shed");
    });
  }

  const actions = {
    busy: busy || snapshot.spectator || (online && live.confirming),
    submit: async (intent: Intent) => {
      await run(async () => settle(await active.current.getQuote(snapshot.session_id, snapshot.night_id, intent)));
    },
    getQuote: (intent: Intent) => run(() => active.current.getQuote(snapshot.session_id, snapshot.night_id, intent)),
    accept: async (quote: Quote) => (await run(() => settle(quote))) ?? false,
    haggle: (offer: HaggleOffer) => run(async () => {
      const result = await active.current.haggle(snapshot.session_id, snapshot.night_id, offer);
      feedback(result.outcome === "refuse" ? "refuse" : "deal");
      return result;
    }),
  };

  function exportSave() {
    const url = URL.createObjectURL(new Blob([backend.exportSave()], { type: "application/json" }));
    const download = document.createElement("a");
    download.href = url;
    download.download = "lantern-row-" + snapshot.session_id + ".json";
    download.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const close = () => setPanel(undefined);
  const panelStall = panel && Object.hasOwn(merchants, panel) ? panel as StallId : undefined;
  const lowTime = nightOpen && snapshot.duration - snapshot.elapsed <= 60;
  const job = snapshot.job;

  return <main className="game-shell" data-reduced={reduced} data-large-panels={largePanels}>
    {riverRun && <RiverRun key={riverRun.id} manifest={riverRun.manifest} snapshot={snapshot} finish={finishRiver} busy={busy} reduced={reduced}
      live={online} low={lowGraphics} volume={volume * effectsLevel}/>}
    <div className="row-layer" inert={!!riverRun}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><LanternMark/></span><div><strong>Lantern Caravan</strong><span>LANTERN ROW · NIGHT MARKET</span></div></div>
      <div className="night-tag"><MoonStar size={16}/><span>{nightLabel(snapshot.night).toUpperCase()}</span><span className="divider"/><b>{snapshot.nightName}</b></div>
      <div className="hud">
        {snapshot.spectator ? <span className="meter" title="Spectator"><Eye size={18}/><b>Watch</b></span>
          : <span className="meter gold" title="Coins in your purse"><Coins size={18}/><b>{snapshot.coins}</b></span>}
        <button className="meter" disabled={!entered} onClick={() => setPanel("inventory")} aria-label={`Cart ${cargo} of ${snapshot.capacity} items`} title="Cart (I)">
          <Package size={17}/><b>{cargo}<span className="muted"> / {snapshot.capacity}</span></b>
        </button>
        <span className={`meter clock ${lowTime ? "low-time" : ""}`} title="Time until closing"><Clock3 size={17}/><b>{formatTime(snapshot.duration - snapshot.elapsed)}</b></span>
      </div>
      <div className="header-actions">
        {entered && <button className="icon-button journal-button" onClick={() => setPanel("journal")} aria-label="Journal" title="Journal (J)"><BookOpen size={18}/></button>}
        <button className="icon-button" onClick={() => setVolume(volume ? 0 : .5)} aria-label={volume ? "Mute sound" : "Unmute sound"} title={volume ? "Mute sound" : "Unmute sound"}>
          {volume ? <Volume2 size={19}/> : <VolumeX size={19}/>}
        </button>
        <button className="icon-button" onClick={() => setPanel(roaming ? "pause" : "settings")} aria-label={roaming ? "Pause" : "Settings"} title={roaming ? "Pause (Esc)" : "Settings"}>
          {roaming ? <Pause size={19}/> : <Settings2 size={19}/>}
        </button>
      </div>
    </header>

    <div className="stage" aria-label="Riverside market">
      <div ref={world} className="world"/>
      <div className="vignette" aria-hidden="true"/>
      {!entered && !panel && <div className="hero">
        <div className="eyebrow hero-kicker"><span/> A RIVERSIDE TRADING GAME</div>
        <h1>Lantern <em>Caravan</em></h1>
        <p>Trade by lanternlight.</p>
        <div className="hero-actions">
          <button className="primary enter" disabled={!ready || busy} onClick={() => void openMarket()}>
            <Play size={17} fill="currentColor"/>{ready ? currentSlot ? "Continue" : "Enter the Row" : "Opening the Row"}<ArrowRight size={19}/>
          </button>
          <button className="subtle enter" disabled={!ready} onClick={() => setPanel("profiles")}><Users size={17}/> Profiles</button>
        </div>
        <div className="hero-links">
          <button onClick={() => setPanel("rooms")}><Globe2 size={15}/> Live market</button>
          <button disabled={busy} onClick={() => void enterLive("the-row", "watch")}><Eye size={15}/> Watch</button>
          <button onClick={() => setPanel("history")}><ChartNoAxesCombined size={15}/> History</button>
          <button onClick={() => setPanel("simulator")}><Activity size={15}/> Simulator</button>
        </div>
      </div>}

      {nightOpen && <>
        <Objective snapshot={snapshot}/>
        {!panel && guide && next && <div className="guide">
          <button className="guide-next" onClick={() => visit(next.stop, next.item)}><Sparkles size={15}/>{next.line}<ChevronRight size={16}/></button>
          <button className="guide-skip" onClick={() => setGuide(false)} aria-label="Hide tutorial hint">Skip</button>
        </div>}
        {!panel && !online && snapshot.objective.complete && <button className="primary finish" disabled={busy} onClick={advance}>Close the night <ArrowRight size={17}/></button>}
        {event && !panel && <div className="event-flag" title={event.detail}><Sparkles size={16}/><b>{event.label}</b><span>{snapshot.elapsed < event.at ? "· " + formatTime(event.at - snapshot.elapsed) : event.detail}</span></div>}
      </>}

      <div className="stage-footer">
        <div className="key-hints"><span><kbd>A</kbd><kbd>D</kbd> Walk</span><span><kbd>E</kbd> Interact</span><span><kbd>I</kbd> Cart</span></div>
        <div className="river-meter" title={`${boats} of 6 boats lit`} aria-label={`${boats} of 6 boats lit`}>
          <Waves size={16}/><span aria-hidden="true">{Array.from({ length: 6 }, (_, index) =>
            <i key={index} className={snapshot.orders.some(order => order.boat === index && order.state === "filled") ? "filled" : ""}/>)}</span><b>{boats} / 6</b>
        </div>
      </div>

      {entered && !panel && !snapshot.spectator && snapshot.phase === "preparation" && <Preparation snapshot={snapshot} actions={actions} advance={advance} landing={landingOpen ? () => setPanel("shed") : undefined}/>}
      {entered && !panel && !snapshot.spectator && snapshot.phase === "results" && <NightReport snapshot={snapshot} busy={busy} advance={advance} title={title}
        live={() => setPanel("rooms")}
        retry={() => void run(async () => { await backend.retry(); setPanel(undefined); })}/>}

      {panelStall && <PanelFrame key={panel} title={merchants[panelStall].name} eyebrow={merchants[panelStall].keeper} icon={(() => {
        const Icon = stopIcons[panelStall]; return <Icon size={24}/>;
      })()} onClose={close}><Trade stall={panelStall} snapshot={snapshot} actions={actions} preferred={preferred}/></PanelFrame>}
      {panel === "workshop" && <PanelFrame title="Workshop" eyebrow="CRAFT" icon={<LanternMark/>} onClose={close}><Workshop snapshot={snapshot} actions={actions} preferred={preferred} shop={item => {
        const seller = Object.entries(snapshot.merchants).filter(([, market]) => market.band !== "dark" && Number(market.stock[item]))
          .sort(([, a], [, b]) => Number(a.prices[item]!.buy) - Number(b.prices[item]!.buy))[0];
        if (seller) visit(seller[0] as Stop, item);
        else notify("The Row is out of " + item + ".", true);
      }}/></PanelFrame>}
      {panel === "board" && <PanelFrame title="Order Board" eyebrow="FESTIVAL" icon={<Waves size={24}/>} onClose={close}><Board snapshot={snapshot} actions={actions}/></PanelFrame>}
      {panel === "inventory" && <PanelFrame title="Handcart" eyebrow={`${cargo} / ${snapshot.capacity} SLOTS`} icon={<Package size={24}/>} onClose={close}><Inventory snapshot={snapshot}/></PanelFrame>}
      {panel === "journal" && <PanelFrame title="Journal" eyebrow="YOUR NIGHTS" icon={<BookOpen size={24}/>} onClose={close}><Journal snapshot={snapshot} replay={() => { setGuide(true); close(); }}/></PanelFrame>}
      {panel === "rooms" && <PanelFrame title="Live Market" eyebrow="THE ROW" icon={<Globe2 size={24}/>} onClose={close}>
        <Rooms auth={devAuth} busy={busy} enter={(room, mode) => void enterLive(room, mode)}/>
      </PanelFrame>}
      {panel === "history" && <PanelFrame title="Market History" eyebrow="CHRONICLE" icon={<ChartNoAxesCombined size={24}/>} onClose={close}>
        <MarketHistoryPanel backend={live} room={online ? snapshot.session_id : "the-row"}/>
      </PanelFrame>}
      {panel === "simulator" && <PanelFrame title="Market Simulator" eyebrow="RIVALS ONLY" icon={<Activity size={24}/>} onClose={close}><Simulator/></PanelFrame>}
      {panel === "profiles" && <PanelFrame title="Profiles" eyebrow="LOCAL SAVES" icon={<Users size={24}/>} onClose={close}>
        <Profiles profiles={profiles} slots={slots} busy={busy} open={slot => void openMarket(slot)} remove={slot => {
          if (!window.confirm(`Delete Slot ${slots.findIndex(entry => entry === slot) + 1}?`)) return;
          void run(async () => { await backend.deleteProfile(slot); setProfiles(await backend.listProfiles()); });
        }}/>
      </PanelFrame>}
      {panel === "shed" && <PanelFrame title="The Landing" eyebrow="WEST END" icon={<Anchor size={24}/>} onClose={close}>
        <Landing snapshot={snapshot} busy={actions.busy} submit={actions.submit} castOff={castOff}/>
        {job ? <button className="primary wide" disabled={busy || snapshot.elapsed < job.readyAt} onClick={() =>
          void actions.submit({ type: "finish_job", job_id: job.id })}>{snapshot.elapsed < job.readyAt ?
            "Boat arrives in " + formatTime(job.readyAt - snapshot.elapsed) : "Deliver parcel · 4 coins"} <Anchor size={16}/></button>
          : snapshot.phase === "open" && <button className="subtle wide" onClick={() => visit("board")}>Visit Order Board <ArrowRight size={16}/></button>}
      </PanelFrame>}
      {panel === "pause" && <PanelFrame title="Paused" eyebrow={snapshot.nightName} icon={<Pause size={24}/>} onClose={close}>
        {online && <p className="hint">The market keeps running. Room {snapshot.session_id}.</p>}
        <button className="primary wide" onClick={close}>Resume <Play size={16}/></button>
        <button className="subtle wide" onClick={() => setPanel("settings")}>Settings <Settings2 size={17}/></button>
        <button className="subtle wide" onClick={title}>Title <ArrowRight size={17}/></button>
      </PanelFrame>}
      {panel === "settings" && <PanelFrame title="Settings" eyebrow="LANTERN ROW" icon={<Settings2 size={24}/>} onClose={close}>
        <label className="settings-row"><span>Master volume</span><input type="range" min="0" max="1" step=".05" value={volume} onChange={event => setVolume(Number(event.target.value))}/></label>
        <label className="settings-row"><span>Music</span><input type="range" min="0" max="1" step=".05" value={music} onChange={event => setMusic(Number(event.target.value))}/></label>
        <label className="settings-row"><span>Effects</span><input type="range" min="0" max="1" step=".05" value={effectsLevel} onChange={event => setEffectsLevel(Number(event.target.value))}/></label>
        <label className="settings-row"><span>Reduced motion</span><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)}/></label>
        <label className="settings-row"><span>Low graphics</span><input type="checkbox" checked={lowGraphics} onChange={event => setLowGraphics(event.target.checked)}/></label>
        <label className="settings-row"><span>Larger panels</span><input type="checkbox" checked={largePanels} onChange={event => setLargePanels(event.target.checked)}/></label>
        <label className="settings-row"><span>Tutorial hints</span><input type="checkbox" checked={guide} onChange={event => setGuide(event.target.checked)}/></label>
        {!online && <div className="button-pair">
          <button className="subtle" onClick={exportSave} disabled={!entered && !currentSlot}>Export save</button>
          <label className="subtle file-button">Import save<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file || (currentSlot && !window.confirm(`Overwrite Slot ${slots.findIndex(slot => slot === snapshot.session_id) + 1}?`))) return;
            void run(async () => {
              await backend.importSave(snapshot.session_id, await file.text());
              setProfiles(await backend.listProfiles());
              notify("Save imported");
            });
          }}/></label>
        </div>}
        <details><summary>Credits</summary><p className="hint">Original silhouettes and synthesized audio. Type by Fraunces and Manrope. Icons by Lucide.</p></details>
      </PanelFrame>}

      {toast && <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"}>
        {toast.error ? <CircleAlert size={18}/> : <Check size={18}/>} {toast.line}
      </div>}
      {debug && <div className="debug-panel">
        <span>Seed {snapshot.seed} · r{snapshot.revision} · {snapshot.phase} · {fps} FPS</span>
        <select aria-label="Time scale" defaultValue="1" onChange={event => { timeScale.current = Number(event.target.value); }}>
          {[1, 10, 60, 300].map(value => <option value={value} key={value}>{value}×</option>)}
        </select>
        {!online && <button className="subtle deliver" onClick={() => snapshot.phase === "open" ?
          void run(() => backend.tick(snapshot.duration)) : advance()}>{snapshot.phase === "open" ? "Close now" : "Next phase"}</button>}
      </div>}
    </div>

    <nav className="route" aria-label="Market locations">
      <div className="route-heading"><Compass size={19}/><span>THE ROW</span></div>
      <div className="route-stops">
        {stops.map((stop, index) => {
          const Icon = stopIcons[stop.id];
          const dark = snapshot.merchants[stop.id]?.band === "dark";
          return <button className={current === stop.id ? "route-stop here" : "route-stop"} key={stop.id} onClick={() => stop.id === "shed" && landingOpen ? setPanel("shed") : visit(stop.id)}
            disabled={(!roaming && !(stop.id === "shed" && landingOpen)) || paused} aria-current={current === stop.id ? "location" : undefined} title={`${stop.name} (${index + 1})${dark ? " · Closed" : ""}`}>
            <Icon size={18}/><span>{stop.name}</span>{dark ? <span className="route-dark" aria-label="Closed">◇</span> : <kbd>{index + 1}</kbd>}
          </button>;
        })}
      </div>
    </nav>
    <footer className="game-footer">
      <span><i className={snapshot.saveStatus === "unsaved" || (online && live.connection !== "Connected") ? "unsaved" : ""}/>
        {online ? live.environmentLabel + " · " + (live.confirming ? "Confirming…" : live.connection) : backend.environmentLabel}
        {online && <span data-room-code={snapshot.session_id}> · {snapshot.session_id === "the-row" ? "The Row" : "Room " + snapshot.session_id}</span>}
        {snapshot.saveStatus === "unsaved" && " · Unsaved"}</span>
      <span>LANTERN ROW <span className="divider"/> v1.0</span>
    </footer>
    </div>
  </main>;
}
