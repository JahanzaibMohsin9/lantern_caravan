# Lantern Caravan items contract

One [NEP-245](https://github.com/near/NEPs/blob/master/neps/nep-0245.md) multi-token contract for everything the game's ledger holds: `coin`, the five materials (`paper`, `oil`, `reed`, `cord`, `dye`), the three lanterns (`lantern_paper`, `lantern_float`, `lantern_color`) and the five stall shares (`share:<stall>`, capped at 20 each). The catalog is fixed in [`src/tokens.rs`](src/tokens.rs); unknown tokens are refused.

## How balances move

| Method | Caller | What it does |
|---|---|---|
| `game_settle(action_id, ops)` | operator only | Applies one game action's ledger ops (mint, transfer, burn, in the game's own `LedgerOp` JSON shape) all or nothing. Returns `false` and changes nothing if `action_id` was already settled, so retries are safe. |
| `game_settle_batch(batch_id, ops)` | operator only | The same, for a night's net agent activity. |
| `agent_settle(action_id, ops)` | a registered agent | A merchant, rival hauler or village signs its own transfers. Only transfers, only from itself. Relay it as a NEP-366 delegate action so the operator pays the gas. |
| `register_agents(accounts)` | owner or operator | Marks merchant, rival and village sub-accounts as agents. |
| `set_operator(operator)` | owner only | Rotates the game server's signer. |

Every op is checked against balances updated in memory, in order, before anything is written: an overdraw, an unknown token or holder, a zero amount or a share above its cap rejects the whole action. Holders are NEAR account IDs, or internal keys for the game's funds and escrows (`sys:*`, `esc:*`, `pool:*`); a colon can't appear in an account ID, so the two never collide. The game server maps its own IDs (`p:<player>`, `m:<stall>`, `r:<rival>`, `v:<village>`) to accounts before settling.

`mt_transfer`, `mt_batch_transfer` and the `_call` variants exist for standard compatibility but refuse in this version, so the chain can never drift from the game's ledger.

## Events and views

Each settlement logs standard `EVENT_JSON` events (`mt_mint`, `mt_transfer`, `mt_burn`, `standard: "nep245"`). The memo is `<action_id> · <op memo>`, plus `source=sys:harvest` on harvest mints and `sink=sys:river` on river losses, so anyone can check that goods are minted only by village harvests.

Views: `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply`, `mt_token`, `mt_tokens`, `mt_metadata_contract`, `mt_metadata_token_all`, `is_settled`, `is_agent`, `get_owner`, `get_operator`. Balance views accept internal holders too (`mt_balance_of("sys:rescue", "coin")`).

## Build and test

```bash
cargo test
cargo near build non-reproducible-wasm --no-abi
```

On Windows, `cargo test` needs `AWS_LC_SYS_PREBUILT_NASM=1` set (a test-only dependency otherwise needs the NASM assembler). Use `cargo near build non-reproducible-wasm` for the deployable file: it optimizes the wasm for the NEAR runtime and writes `target/near/lantern_items.wasm` (about 213 KB). On Windows add `--no-abi`: generating the ABI links a native library, which fails there, and deploying doesn't need it. A plain `cargo build --target wasm32-unknown-unknown --release` compiles, but its output hasn't been checked against the runtime.

## Deploy (testnet)

```bash
near contract deploy items.lantern-caravan.testnet use-file target/near/lantern_items.wasm with-init-call new file-args init-args.json prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
```

`init-args.json` holds the owner and operator. Passing them from a file avoids Windows PowerShell 5.1 stripping the quotes from inline JSON. The contract account pays for its own storage, so keep a few testnet NEAR on it.

Deployed: [`items.lantern-caravan.testnet`](https://testnet.nearblocks.io/address/items.lantern-caravan.testnet).
