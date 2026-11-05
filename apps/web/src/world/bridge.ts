import type { Snapshot } from "@lantern/protocol";

export const stops = [
  { id: "shed", name: "Shed", x: 320 },
  { id: "paper_mill", name: "Paper Mill", x: 560 },
  { id: "oil_wharf", name: "Oil Wharf", x: 805 },
  { id: "workshop", name: "Workshop", x: 1050 },
  { id: "reed_thread", name: "Reed & Thread", x: 1295 },
  { id: "indigo_atelier", name: "Indigo Atelier", x: 1540 },
  { id: "board", name: "Order Board", x: 1770 },
  { id: "lantern_house", name: "Lantern House", x: 2010 },
] as const;

export type Stop = typeof stops[number]["id"];
export type Panel = Stop | "inventory" | "settings" | "pause";
export type Effect = "buy" | "sell" | "craft" | "deliver" | "boat" | "deal" | "refuse";

type Events = {
  visit: Stop;
  arrive: Stop;
  snapshot: Snapshot;
  reduced: boolean;
  active: boolean;
  blocked: boolean;
  effect: Effect;
  current: Stop;
};
const target = new EventTarget();
const last: Partial<Pick<Events, "snapshot" | "active" | "blocked" | "reduced">> = {};
export const bridge = {
  send<K extends keyof Events>(name: K, detail: Events[K]) {
    if (name === "snapshot" || name === "active" || name === "blocked" || name === "reduced") {
      Object.assign(last, { [name]: detail });
    }
    target.dispatchEvent(new CustomEvent(name, { detail }));
  },
  on<K extends keyof Events>(name: K, listener: (detail: Events[K]) => void) {
    const handler = (event: Event) => listener((event as CustomEvent<Events[K]>).detail);
    target.addEventListener(name, handler);
    if (Object.hasOwn(last, name)) listener((last as Partial<Events>)[name]!);
    return () => target.removeEventListener(name, handler);
  },
};
