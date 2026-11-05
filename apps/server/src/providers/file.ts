import { mkdir, readFile, readdir, rename, writeFile, appendFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionLogEntry, ChronicleEntry, HistoryRange, HistoryRow, StateStore } from "@lantern/protocol";

export async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function atomic(file: string, data: unknown) {
  const temp = file + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(data));
  await rename(temp, file);
}

export class FileStateStore<T> implements StateStore<T> {
  constructor(readonly directory: string) {}

  async init() { await mkdir(this.directory, { recursive: true }); }

  async roomIds() {
    return (await readdir(this.directory)).filter(name => /^room-[a-z0-9-]+\.json$/.test(name))
      .map(name => name.slice(5, -5));
  }

  private path(room: string, file: string) {
    if (!/^[a-z0-9-]{1,45}$/.test(room)) throw new Error("Invalid room code.");
    return join(this.directory, file.replace("{room}", room));
  }

  async load(roomId: string) {
    return readJson<{ state: T; revision: number }>(this.path(roomId, "room-{room}.json"));
  }

  async save(roomId: string, state: T, expectedRevision: number) {
    const before = await this.load(roomId);
    if ((before?.revision ?? 0) !== expectedRevision) throw new Error("Room revision changed.");
    const revision = expectedRevision + 1;
    await atomic(this.path(roomId, "room-{room}.json"), { state, revision });
    return revision;
  }

  private async append(room: string, file: string, rows: unknown[]) {
    if (rows.length) await appendFile(this.path(room, file), rows.map(row => JSON.stringify(row)).join("\n") + "\n", "utf8");
  }

  private async *lines<R>(room: string, file: string): AsyncGenerator<R> {
    const stream = createReadStream(this.path(room, file), { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line) continue;
        try { yield JSON.parse(line) as R; } catch { /* a process may have stopped during an append */ }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      lines.close();
      stream.destroy();
    }
  }

  async appendActionLog(entry: ActionLogEntry) { await this.append(entry.roomId, "actions-{room}.ndjson", [entry]); }
  async appendHistory(roomId: string, rows: HistoryRow[]) { await this.append(roomId, "history-{room}.ndjson", rows); }
  async appendChronicle(roomId: string, entries: ChronicleEntry[]) { await this.append(roomId, "chronicle-{room}.ndjson", entries); }

  async queryHistory(roomId: string, range: HistoryRange) {
    const cutoff = range === "all" ? 0 : Date.now() - (range === "day" ? 1 : 7) * 86400000;
    let groups: { index: number; rows: HistoryRow[] }[] = [];
    let stride = 1, index = 0, time = -1;
    let latest: HistoryRow[] = [];
    for await (const row of this.lines<HistoryRow>(roomId, "history-{room}.ndjson")) {
      if (row.time < cutoff) continue;
      if (row.time !== time) {
        if (latest.length && index % stride === 0) groups.push({ index, rows: latest });
        if (groups.length >= 1400) { stride *= 2; groups = groups.filter(group => group.index % stride === 0); }
        latest = [];
        index++;
        time = row.time;
      }
      latest.push(row);
    }
    return [...groups.flatMap(group => group.rows), ...latest];
  }

  async queryChronicle(roomId: string, cursor?: string, limit = 30) {
    const rows: ChronicleEntry[] = [];
    let count = 0;
    for await (const entry of this.lines<ChronicleEntry>(roomId, "chronicle-{room}.ndjson")) {
      if (entry.id === cursor) break;
      rows.push(entry);
      count++;
      if (rows.length > limit) rows.shift();
    }
    const entries = rows.reverse();
    return { entries, cursor: count > limit ? entries.at(-1)?.id : undefined };
  }
}
