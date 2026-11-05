import { orders } from "@lantern/content";
import { createWorld, player, type World } from "@lantern/game-core";
import { decodeWorld, encodeWorld } from "@lantern/game-core/codec";
import { amount } from "@lantern/protocol";
import { z } from "zod";

export const slots = ["first-light", "slot-2", "slot-3"] as const;
const saveSchema = z.object({ version: z.literal(2), updated: z.int().nonnegative(), world: z.unknown(), checkpoint: z.unknown() });
const legacy = z.object({
  version: z.literal(1), updated: z.int().nonnegative(), world: z.object({
    phase: z.enum(["preparation", "open", "results"]), revision: z.int().nonnegative(),
    elapsed: z.number().nonnegative().max(300), delivered: amount, crafted: amount, crowdSold: amount,
    ledger: z.record(z.string(), z.record(z.string(), amount)),
    cooldowns: z.record(z.string(), z.int()),
    orderWishes: z.record(z.string(), z.array(z.string())),
  }),
});
type SaveRow = { current: unknown; backup?: unknown };

export function pack(world: World, checkpoint: World) {
  return { version: 2, updated: Date.now(), world: encodeWorld(world), checkpoint: encodeWorld(checkpoint) };
}

export function unpack(save: unknown): { world: World; checkpoint: World; updated: number } {
  const current = saveSchema.safeParse(save);
  if (current.success) {
    const world = decodeWorld(current.data.world);
    const checkpoint = decodeWorld(current.data.checkpoint);
    if (!world.traders[player] || !checkpoint.traders[player] || world.night !== checkpoint.night || world.mode !== checkpoint.mode ||
      world.mode === "live" || checkpoint.phase !== "preparation") throw new Error("This save doesn't match a local campaign.");
    return { world, checkpoint, updated: current.data.updated };
  }

  const old = legacy.parse(save);
  const checkpoint = createWorld();
  const source = old.world;
  const ledger = { ...checkpoint.ledger, ...Object.fromEntries(Object.entries(source.ledger).map(([account, assets]) =>
    [account, Object.fromEntries(Object.entries(assets).map(([asset, value]) => [asset, Number(value)]))])) };
  const orderContributors = Object.fromEntries(orders.filter(order =>
    (ledger["esc:order:" + order.id]?.coin ?? 0) < order.quantity * order.payout).map(order => [order.id, [player]]));
  const world: World = { ...checkpoint, ledger, phase: source.phase, elapsed: source.elapsed, tickAt: Math.floor(source.elapsed / 10) * 10,
    revision: source.revision, orderWishes: source.orderWishes, orderContributors,
    traders: { ...checkpoint.traders, [player]: { ...checkpoint.traders[player]!, delivered: { lantern_paper: Number(source.delivered) },
      crafted: Number(source.crafted), lifetimeCrafted: Number(source.crafted), crowdSold: Number(source.crowdSold),
      cooldowns: source.cooldowns, boatsHelped: orders.filter(order => ledger["esc:order:" + order.id]?.coin === 0).length } } };
  return { world, checkpoint, updated: old.updated };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lantern-row", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("profiles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function read(slot: string): Promise<SaveRow | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("profiles").objectStore("profiles").get(slot);
      request.onsuccess = () => resolve(request.result as SaveRow | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function edit(change: (store: IDBObjectStore) => void) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("profiles", "readwrite");
      change(tx.objectStore("profiles"));
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function write(slot: string, world: World, checkpoint: World) {
  const current = pack(world, checkpoint);
  await edit(store => {
    const request = store.get(slot);
    request.onsuccess = () => {
      const previous = request.result as SaveRow | undefined;
      let backup = previous?.backup;
      if (previous) {
        try { unpack(previous.current); backup = previous.current; } catch { /* preserve the previous backup */ }
      }
      store.put({ current, backup }, slot);
    };
  });
}

export const remove = (slot: string) => edit(store => { store.delete(slot); });
