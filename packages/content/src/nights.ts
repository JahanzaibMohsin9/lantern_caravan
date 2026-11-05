import { orders, type ItemId } from "./index";

export type FestivalOrder = {
  id: string; name: string; opens: number; quantity: number; payout: number; boat: number;
  personal: boolean; item: ItemId;
};
export type NightEvent = { id: string; label: string; detail: string; at: number };

const fleet = ["The Heron", "The Kingfisher", "The Swallow", "The Tern", "The Egret", "The Firefly"];
const festival = (boat: number, item: ItemId, quantity: number, opens: number, payout: number, personal = false): FestivalOrder =>
  ({ id: `boat-${boat}`, name: fleet[boat]!, opens, quantity, payout, boat, personal, item });

export const strategies = {
  steady: { name: "Steady", reserve: 15, price: 10000, tolerance: -100, icon: "◈", description: "Keeps cash in reserve" },
  bold: { name: "Bold", reserve: 5, price: 10500, tolerance: 0, icon: "▲", description: "Restocks aggressively" },
  festival: { name: "Festival", reserve: 10, price: 10000, tolerance: 200, icon: "✦", description: "Stocks festival ingredients" },
  bargain: { name: "Bargain", reserve: 10, price: 9500, tolerance: 300, icon: "↓", description: "Lower prices, more trade" },
} as const;
export type StrategyId = keyof typeof strategies;

export const upgrades = {
  cart_i: { name: "Cart I", price: 25, unlock: 2, description: "6 → 8 slots" },
  cart_ii: { name: "Cart II", price: 50, unlock: 4, description: "8 → 10 slots" },
  lantern_strings: { name: "Lantern strings", price: 15, unlock: 2, description: "Amber lights for your cart" },
} as const;
export type UpgradeId = keyof typeof upgrades;

const events: NightEvent[] = [
  { id: "wind_rises", label: "Wind rising", detail: "New floating orders pay more.", at: 35 },
  { id: "visiting_artists", label: "Visiting artists", detail: "New colored orders pay more.", at: 50 },
  { id: "festival_rush", label: "Festival rush", detail: "The Firefly is taking orders.", at: 70 },
];
const festivalOrders = [
  festival(0, "lantern_paper", 1, 0, 10, true),
  festival(1, "lantern_float", 1, 0, 15),
  festival(2, "lantern_color", 1, 0, 18),
  festival(3, "lantern_float", 1, 35, 15),
  festival(4, "lantern_color", 1, 50, 18),
  festival(5, "lantern_paper", 1, 70, 12),
];

export function nightPlan(night: number, mode: "campaign" | "endless" | "live", seed: number) {
  if (mode === "campaign") {
    if (night === 1) return { name: "First Light", duration: 300, orders: orders.map(order => ({ ...order, item: "lantern_paper" as const })), events: [] };
    if (night === 2) return { name: "The Dark Wharf", duration: 300,
      orders: [festival(0, "lantern_float", 2, 0, 15, true), festival(1, "lantern_paper", 2, 0, 10),
        festival(2, "lantern_paper", 1, 50, 10), festival(3, "lantern_float", 1, 100, 15),
        festival(4, "lantern_paper", 1, 140, 10), festival(5, "lantern_float", 1, 180, 15)], events: [] };
    return { name: "Festival of Lights", duration: 300, orders: festivalOrders, events };
  }
  const shift = Math.abs((seed ^ Math.imul(night, 113)) % 4);
  const traffic: NightEvent[] = [
    { id: "oil_late", label: "Late oil barge", detail: "Oil stocks recover after the barge arrives.", at: 100 },
    { id: "paper_barge", label: "Paper barge", detail: "Eight rolls arrive at Paper Mill.", at: 60 },
    { id: "quiet_patch", label: "Quiet patch", detail: "Crowd buying pauses for 45 seconds.", at: 100 },
  ];
  return { name: mode === "live" ? "The Live Row" : "Afterglow", duration: 300, events: shift % 2 ? events : traffic,
    orders: festivalOrders.map((order, i) => ({ ...order, personal: false,
      opens: i < 2 ? 0 : order.opens + shift * 5, quantity: i === 0 ? 1 : night > 7 && i % 2 === 0 ? 2 : 1 })) };
}

export const rivalNames = { "r:pell": "Pell", "r:juno": "Juno", "r:ren": "Ren" };
