/**
 * Public proof, no sign-in: the contract and its settlement queue, the latest player trades on the public Row with both
 * token legs and their transactions, and the agents' own NEAR accounts. Everything links to the explorer.
 */
import { useEffect, useState } from "react";
import { Bell, ExternalLink, RefreshCw, Ship, Shuffle, Swords } from "lucide-react";
import type { ChronicleEntry } from "@lantern/protocol";
import { items, merchants, type ItemId } from "@lantern/content";
import type { Intent } from "@lantern/protocol";
import type { HttpBackend, PublicReceipts } from "../backend/http";
import { describeTrade } from "./describe";

const explorer = (account: string) => "https://testnet.nearblocks.io/address/" + account;
const short = (account: string) => /^[0-9a-f]{64}$/.test(account) ? account.slice(0, 6) + "…" + account.slice(-4)
  : account.replace(/^([0-9a-f]{8})[0-9a-f]+\./, "$1….");
const keepers = Object.fromEntries(Object.values(merchants).map(merchant => [merchant.keeper.toLowerCase(), merchant]));

function agentLabel(account: string) {
  const name = account.split(".")[0]!;
  const merchant = keepers[name];
  if (merchant) return { name: merchant.keeper, role: merchant.name };
  if (["pell", "juno", "ren"].includes(name)) return { name: name[0]!.toUpperCase() + name.slice(1), role: "Rival hauler" };
  if (name === "freight") return { name: "Freight barge", role: "Hauler" };
  return { name: name.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join(" "), role: "Village" };
}

function Account({ party }: { party?: { name: string; account: string } }) {
  if (!party) return <span>the harbor</span>;
  // Only real NEAR accounts link to the explorer; harbor funds and off-chain rooms stay plain.
  const onChain = /^[0-9a-f]{64}$/.test(party.account) || /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(party.account);
  return <span className="verify-party"><b>{party.name}</b>
    {onChain ? <a href={explorer(party.account)} target="_blank" rel="noreferrer">{short(party.account)}</a> : /^(sys|esc|pool):/.test(party.account) ? <small>harbor fund</small> : null}</span>;
}

/** The Chronicle lines that make up the agent economy: a merchant posts a job, haulers choose, deliver and get paid. */
const agentKinds = [
  { test: /rang the Harbor Bell/, icon: Bell, label: "Merchant posts a job" },
  { test: / left .*’s /, icon: Shuffle, label: "Hauler gives way" },
  { test: /: Hauling /, icon: Ship, label: "Hauler decides" },
  { test: /collected the Harbor Bell/, icon: Bell, label: "Hauler paid" },
  { test: /drove pirates off|abandoned the boom/, icon: Swords, label: "River calmed" },
];

export function VerifyPanel({ backend }: { backend: HttpBackend }) {
  const [data, setData] = useState<PublicReceipts>();
  const [agents, setAgents] = useState<ChronicleEntry[]>([]);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setError(false);
    void backend.receipts().then(result => { if (live) setData(result); }).catch(() => { if (live) setError(true); });
    void backend.getChronicle("the-row").then(page => {
      if (live) setAgents(page.entries.filter(entry => agentKinds.some(kind => kind.test.test(entry.line))).slice(0, 8));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [backend, refresh]);
  const chain = data?.chain;
  return <div className="verify">
    <p className="hint">The public Row's coins, goods and stall shares are tokens on one NEP-245 contract on NEAR testnet.
      Every confirmed player action is its own transaction, and the AI merchants, haulers and villages hold their own accounts.</p>
    {error && <p className="hint" role="alert">The live server is unavailable right now.</p>}
    {chain?.enabled && <div className="verify-chain">
      <a href={chain.contractUrl} target="_blank" rel="noreferrer"><b>{chain.contract}</b> <ExternalLink size={12}/></a>
      <span><b>{chain.settled}</b> transactions settled · <b>{chain.queued}</b> waiting</span>
      {chain.last && <a href={chain.last.url} target="_blank" rel="noreferrer">Latest transaction <ExternalLink size={12}/></a>}
    </div>}
    <div className="split"><span className="eyebrow">RECENT PLAYER TRADES</span>
      <button className="text-button" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13}/> Refresh</button></div>
    {data && !data.receipts.length && <p className="hint">No player trades yet. Join The Row and sell something at the Dock.</p>}
    {data?.receipts.map(receipt => <article className="verify-receipt" key={receipt.actionId}>
      <div className="split"><strong>{describeTrade(receipt.intent as Intent, receipt.legs) ?? receipt.intent.type}</strong>
        {receipt.url && <a href={receipt.url} target="_blank" rel="noreferrer">Transaction <ExternalLink size={12}/></a>}</div>
      <small>{receipt.actor} · {receipt.night.replace("night-", "Night ")}{receipt.at ? " · " + new Date(receipt.at).toLocaleString() : ""}</small>
      <ul>{receipt.legs.map((leg, index) => <li key={index}>
        <b>{leg.amount} {(items[leg.asset as ItemId]?.name ?? (leg.asset === "coin" ? "coin" : leg.asset)).toLowerCase()}</b>
        <Account party={leg.from}/> <span aria-hidden="true">→</span> <Account party={leg.to}/>
      </li>)}</ul>
    </article>)}
    {!!agents.length && <>
      <span className="eyebrow">AGENTS AT WORK</span>
      <p className="hint">The AI merchants and haulers trade from their own balances. Each decision is logged with its reason.</p>
      <ul className="verify-decisions">{agents.map(entry => {
        const kind = agentKinds.find(candidate => candidate.test.test(entry.line))!;
        const Icon = kind.icon;
        return <li key={entry.id}><Icon size={14}/><span><small>{kind.label} · Night {entry.night}</small>{entry.line}</span></li>;
      })}</ul>
    </>}
    {!!data?.agents.length && <>
      <span className="eyebrow">AGENT ACCOUNTS</span>
      <ul className="verify-agents">{data.agents.map(account => {
        const label = agentLabel(account);
        return <li key={account}><b>{label.name}</b> <small>{label.role}</small>
          <a href={explorer(account)} target="_blank" rel="noreferrer">{account} <ExternalLink size={11}/></a></li>;
      })}</ul>
    </>}
    <details><summary>Check a balance yourself</summary>
      <code className="verify-code">near view items.lantern-caravan.testnet mt_balance_of '{"{"}"account_id":"mira.lantern-caravan.testnet","token_id":"coin"{"}"}'</code>
    </details>
  </div>;
}
