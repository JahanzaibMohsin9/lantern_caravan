import { Anchor, Anvil, Box, Droplet, House, Lamp, Layers3, Paintbrush, ScrollText, Sprout, Waves, Wind } from "lucide-react";
import type { ItemId } from "@lantern/content";
import type { Stop } from "../world/bridge";

export const stopIcons = {
  shed: House, paper_mill: ScrollText, oil_wharf: Droplet, workshop: Anvil,
  reed_thread: Sprout, indigo_atelier: Paintbrush, board: Anchor, lantern_house: Lamp,
} satisfies Record<Stop, typeof Box>;

const itemIcons = {
  paper: ScrollText, oil: Droplet, reed: Sprout, cord: Wind, dye: Paintbrush,
  lantern_paper: Lamp, lantern_float: Waves, lantern_color: Layers3,
} satisfies Record<ItemId, typeof Box>;

export function ItemIcon({ item, size = 18 }: { item: ItemId; size?: number }) {
  const Icon = itemIcons[item];
  return <Icon className={`item-icon item-${item}`} size={size} aria-hidden="true" />;
}

export function LanternMark({ size = 27 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M17 6a3 3 0 0 1 6 0v2m-3 25v4m-4-2 4 3 4-3M12 10h16m-16 20h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    <path d="M13 11c-2.5 3-4.5 5.7-4.5 9S10.5 26 13 29h14c2.5-3 4.5-5.7 4.5-9S29.5 14 27 11H13Z" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="1.6"/>
    <path d="M16 12c-3.5 5.4-3.5 10.6 0 16m8-16c3.5 5.4 3.5 10.6 0 16m-4-15v14" stroke="currentColor" strokeOpacity=".78" strokeWidth="1.25" strokeLinecap="round"/>
    <path d="M4 17v6m-3-3h6m29-3v6m-3-3h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>;
}
