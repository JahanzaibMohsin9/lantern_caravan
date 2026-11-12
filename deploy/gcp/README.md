# Hosting on a Google Cloud VM

The live Row runs on one Debian 12 VM: Caddy serves the built game and HTTPS, and forwards `/v1/*` to the Node server on `127.0.0.1:4318`. The server runs as the `lantern` system user under systemd and keeps its data in `/var/lib/lantern-caravan`.

| | |
|---|---|
| Project | `lantern-caravan-2026` |
| VM | `lantern-caravan`, e2-small, `us-central1-a`, 20 GB disk, daily snapshots kept 7 days (`lantern-daily`) |
| Address | `35.193.245.99` (static), `https://lanterncaravan.duckdns.org` |

## First setup

```bash
gcloud compute scp --recurse deploy/gcp lantern-caravan:/tmp/deploy --project=lantern-caravan-2026 --zone=us-central1-a
gcloud compute ssh lantern-caravan --project=lantern-caravan-2026 --zone=us-central1-a --command="sudo DOMAIN=lanterncaravan.duckdns.org bash /tmp/deploy/setup.sh"
```

## Updating

Push to `main`, then:

```bash
gcloud compute ssh lantern-caravan --project=lantern-caravan-2026 --zone=us-central1-a --command="sudo lantern-update"
```

## Turning on NEAR settlement

The server starts with the local dev ledger. To settle the public Row on testnet, the operator key goes into the root-only settings file `/etc/lantern-caravan.env`, never into the repo:

1. On the VM, edit the settings: `sudo nano /etc/lantern-caravan.env`
2. Change `SETTLEMENT=dev` to `SETTLEMENT=near`, and add a line `NEAR_OPERATOR_KEY=ed25519:...` with the `private_key` value from `operator.lantern-caravan.testnet.json` in your `.near-credentials\testnet` folder.
3. `sudo systemctl restart lantern-caravan`, then check `https://lanterncaravan.duckdns.org/v1/chain/status`.

Merchants sign their own legs with their own function-call keys. On your machine, `npm run near:agent-keys -- --env agent-keys.env --check` adds a key to each merchant (only once) and writes a `NEAR_AGENT_KEYS=...` line; append that line to `/etc/lantern-caravan.env` and restart. Without it the operator signs for the merchants, as before. `/v1/chain/status` lists the `signers`.

On its first start with NEAR the server registers any missing agents and mints the market's genesis on the contract. Use FastNEAR's RPC (`NEAR_RPC_URL=https://test.rpc.fastnear.com`, the default): NEAR's old `rpc.testnet.near.org` endpoint is deprecated and rate-limits requests.

## Checking the chain against the Row

`npm run near:verify -- --data /var/lib/lantern-caravan` (run as the `lantern` user from `/opt/lantern-caravan`) compares every holder's on-chain balance with the live Row, after undoing agent activity that hasn't been flushed yet. It only reads, so it's safe next to the running server.

## Logs and status

```bash
sudo journalctl -u lantern-caravan -n 100 --no-pager
systemctl status lantern-caravan caddy
```
