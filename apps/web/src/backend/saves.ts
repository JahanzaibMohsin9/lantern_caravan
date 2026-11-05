import { amount } from "@lantern/protocol";
import type { World } from "@lantern/game-core";
import { z } from "zod";

const saveSchema = z.object({
  version: z.literal(1),
  updated: z.int().nonnegative(),
  world: z.object({
    phase: z.enum(["preparation", "open", "results"]),
    revision: z.int().nonnegative(),
    elapsed: z.number().nonnegative().max(300),
    delivered: amount, crafted: amount, crowdSold: amount,
    ledger: z.record(z.string(), z.record(z.string(), amount)),
    cooldowns: z.record(z.string(), z.int()),
    orderWishes: z.record(z.string(), z.array(z.string())),
  }),
});
type Save = z.infer<typeof saveSchema>;
type SaveRow = { current: Save; backup?: Save };

function mapLedger<T, R>(ledger: Record<string, Record<string, T>>, convert: (value: T) => R) {
  return Object.fromEntries(Object.entries(ledger).map(([account, assets]) =>
    [account, Object.fromEntries(Object.entries(assets).map(([asset, value]) => [asset, convert(value)]))]));
}

function pack(world: World): Save {
  return {
    version: 1, updated: Date.now(), world: { ...world, delivered: String(world.delivered),
      crafted: String(world.crafted), crowdSold: String(world.crowdSold), ledger: mapLedger(world.ledger, String) },
  };
}

export function unpack(save: Save): World {
  const { world } = saveSchema.parse(save);
  return { ...world, delivered: Number(world.delivered), crafted: Number(world.crafted),
    crowdSold: Number(world.crowdSold), ledger: mapLedger(world.ledger, Number) };
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

export async function write(slot: string, world: World): Promise<void> {
  const save = pack(world);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("profiles", "readwrite");
      const store = tx.objectStore("profiles");
      const request = store.get(slot);
      request.onsuccess = () => {
        const previous = request.result as SaveRow | undefined;
        const current = saveSchema.safeParse(previous?.current);
        store.put({ current: save, backup: current.success ? current.data : previous?.backup }, slot);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
