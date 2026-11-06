//! Lantern Caravan items: one NEP-245 multi-token contract for every coin, material, lantern and
//! stall share in the game.
//!
//! The game server runs the rules and settles each confirmed action here through `game_settle`,
//! an atomic batch of mint, transfer and burn moves keyed by the game's action ID, so a retry can
//! never apply twice. Merchants, rival haulers and villages are real NEAR accounts; once
//! registered as agents they can also sign their own transfers with `agent_settle` (relayed with
//! NEP-366 delegate actions, so the operator pays the gas). Funds and escrows such as
//! `sys:rescue` or `esc:bell:<id>` are internal holders inside the contract.
//!
//! In this version balances move only through settlement: `mt_transfer` and friends are present
//! for standard compatibility but refuse, so the chain can never drift from the game's ledger.

mod events;
mod tokens;

use std::collections::HashMap;

use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub use tokens::{token, TokenInfo, SHARE_CAP, TOKENS};

/// Upper bound on ops in one settlement, to keep every call well inside the gas limit.
pub const MAX_OPS: usize = 200;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Agents,
    Balances,
    Supply,
    Settled,
}

/// One ledger move, in exactly the shape the game's protocol uses (`ledgerOpSchema`).
#[near(serializers = [json])]
#[serde(tag = "op", rename_all = "lowercase")]
#[derive(Clone, Debug, PartialEq)]
pub enum LedgerOp {
    Mint { asset: String, amount: U128, to: String, memo: String, #[serde(default)] source: Option<String> },
    Burn { asset: String, amount: U128, from: String, memo: String, #[serde(default)] sink: Option<String> },
    Transfer { asset: String, amount: U128, from: String, to: String, memo: String },
}

/// NEP-245 `Token`: these are fungible-style multi-tokens, so there is no single owner.
#[near(serializers = [json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct MtContractMetadata {
    pub spec: String,
    pub name: String,
}

#[near(serializers = [json])]
pub struct MtBaseTokenMetadata {
    pub name: String,
    pub id: String,
    pub symbol: Option<String>,
    pub icon: Option<String>,
    pub decimals: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub copies: Option<u64>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct MtTokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct MtTokenMetadataAll {
    pub base: MtBaseTokenMetadata,
    pub token: MtTokenMetadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    operator: AccountId,
    agents: LookupSet<AccountId>,
    /// Key: `token|holder`.
    balances: LookupMap<String, u128>,
    supply: LookupMap<String, u128>,
    /// Settled action IDs. Agent actions are namespaced as `agent/<account>/<id>`.
    settled: LookupSet<String>,
}

fn key(token: &str, holder: &str) -> String {
    format!("{token}|{holder}")
}

fn check_holder(holder: &str) {
    require!(tokens::is_internal(holder) || holder.parse::<AccountId>().is_ok(),
        format!("Unknown holder {holder}: use a NEAR account ID or an internal sys:, esc: or pool: key."));
}

fn check_token(asset: &str) -> &'static TokenInfo {
    match token(asset) {
        Some(info) => info,
        None => env::panic_str(&format!("Unknown token {asset}.")),
    }
}

fn event_memo(action_id: &str, memo: &str, tag: Option<(&str, &Option<String>)>) -> String {
    match tag {
        Some((name, Some(value))) => format!("{action_id} · {memo} · {name}={value}"),
        _ => format!("{action_id} · {memo}"),
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, operator: AccountId) -> Self {
        Self {
            owner,
            operator,
            agents: LookupSet::new(StorageKey::Agents),
            balances: LookupMap::new(StorageKey::Balances),
            supply: LookupMap::new(StorageKey::Supply),
            settled: LookupSet::new(StorageKey::Settled),
        }
    }

    // ---------- Administration ----------

    pub fn set_operator(&mut self, operator: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can change the operator.");
        self.operator = operator;
    }

    /// Registers merchant, rival and village accounts so they can sign their own transfers.
    pub fn register_agents(&mut self, accounts: Vec<AccountId>) {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner || caller == self.operator, "Only the owner or operator can register agents.");
        for account in accounts {
            self.agents.insert(account);
        }
    }

    pub fn get_owner(&self) -> AccountId { self.owner.clone() }
    pub fn get_operator(&self) -> AccountId { self.operator.clone() }
    pub fn is_agent(&self, account_id: AccountId) -> bool { self.agents.contains(&account_id) }

    // ---------- Settlement ----------

    /// Applies one game action's ledger ops, all or nothing. Only the operator may call it.
    /// Returns `false`, changing nothing, if `action_id` was already settled.
    pub fn game_settle(&mut self, action_id: String, ops: Vec<LedgerOp>) -> bool {
        require!(env::predecessor_account_id() == self.operator, "Only the game operator can settle.");
        self.settle(action_id, ops, None)
    }

    /// The net effects of one night's agent-only activity, settled as a single batch.
    pub fn game_settle_batch(&mut self, batch_id: String, ops: Vec<LedgerOp>) -> bool {
        require!(env::predecessor_account_id() == self.operator, "Only the game operator can settle.");
        self.settle(format!("batch/{batch_id}"), ops, None)
    }

    /// A registered agent moves its own balances: only transfers, and only from itself.
    pub fn agent_settle(&mut self, action_id: String, ops: Vec<LedgerOp>) -> bool {
        let agent = env::predecessor_account_id();
        require!(self.agents.contains(&agent), "Only a registered agent can sign its own transfers.");
        let id = format!("agent/{agent}/{action_id}");
        self.settle(id, ops, Some(agent.as_str()))
    }

    pub fn is_settled(&self, action_id: String) -> bool { self.settled.contains(&action_id) }

    // ---------- NEP-245 core ----------

    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128,
        approval: Option<(AccountId, u64)>, memo: Option<String>) {
        let _ = (receiver_id, token_id, amount, approval, memo);
        env::panic_str("Lantern Caravan items move through game settlement; direct transfers are disabled in this version.");
    }

    #[payable]
    pub fn mt_batch_transfer(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>) {
        let _ = (receiver_id, token_ids, amounts, approvals, memo);
        env::panic_str("Lantern Caravan items move through game settlement; direct transfers are disabled in this version.");
    }

    #[payable]
    pub fn mt_transfer_call(&mut self, receiver_id: AccountId, token_id: String, amount: U128,
        approval: Option<(AccountId, u64)>, memo: Option<String>, msg: String) {
        let _ = (receiver_id, token_id, amount, approval, memo, msg);
        env::panic_str("Lantern Caravan items move through game settlement; direct transfers are disabled in this version.");
    }

    #[payable]
    pub fn mt_batch_transfer_call(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>, msg: String) {
        let _ = (receiver_id, token_ids, amounts, approvals, memo, msg);
        env::panic_str("Lantern Caravan items move through game settlement; direct transfers are disabled in this version.");
    }

    /// Accepts NEAR account IDs and internal holders such as `sys:rescue`.
    pub fn mt_balance_of(&self, account_id: String, token_id: String) -> U128 {
        U128(self.balances.get(&key(&token_id, &account_id)).copied().unwrap_or(0))
    }

    pub fn mt_batch_balance_of(&self, account_id: String, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.into_iter().map(|token_id| self.mt_balance_of(account_id.clone(), token_id)).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        token(&token_id).map(|_| U128(self.supply.get(&token_id).copied().unwrap_or(0)))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|token_id| self.mt_supply(token_id)).collect()
    }

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<Token>> {
        token_ids.into_iter().map(|token_id| token(&token_id).map(|info| Token { token_id: info.id.to_string(), owner_id: None })).collect()
    }

    /// Every token in the catalog, for explorers and the judge walkthrough.
    pub fn mt_tokens(&self) -> Vec<Token> {
        TOKENS.iter().map(|info| Token { token_id: info.id.to_string(), owner_id: None }).collect()
    }

    // ---------- NEP-245 metadata ----------

    pub fn mt_metadata_contract(&self) -> MtContractMetadata {
        MtContractMetadata { spec: "mt-1.0.0".to_string(), name: "Lantern Caravan".to_string() }
    }

    pub fn mt_metadata_token_all(&self, token_ids: Vec<String>) -> Vec<Option<MtTokenMetadataAll>> {
        token_ids.into_iter().map(|token_id| token(&token_id).map(|info| MtTokenMetadataAll {
            base: MtBaseTokenMetadata { name: info.title.to_string(), id: info.id.to_string(), symbol: None, icon: None,
                decimals: Some("0".to_string()), base_uri: None, reference: None, copies: None, reference_hash: None },
            token: MtTokenMetadata { title: Some(info.title.to_string()), description: Some(info.description.to_string()),
                media: None, media_hash: None, issued_at: None, expires_at: None, starts_at: None, updated_at: None,
                extra: info.max_supply.map(|cap| format!("{{\"max_supply\":{cap}}}")), reference: None, reference_hash: None },
        })).collect()
    }
}

impl Contract {
    /// Checks every op against balances updated in memory, in order, and only then writes them,
    /// so a failing op leaves nothing half-applied.
    fn settle(&mut self, id: String, ops: Vec<LedgerOp>, only_from: Option<&str>) -> bool {
        require!(!id.is_empty() && id.len() <= 200, "Action IDs are 1 to 200 characters.");
        if self.settled.contains(&id) {
            return false;
        }
        require!(!ops.is_empty() && ops.len() <= MAX_OPS, format!("Settle 1 to {MAX_OPS} ops at a time."));
        let mut balances: HashMap<String, u128> = HashMap::new();
        let mut supply: HashMap<String, u128> = HashMap::new();
        let balance = |balances: &HashMap<String, u128>, this: &Self, k: &str| balances.get(k).copied()
            .unwrap_or_else(|| this.balances.get(k).copied().unwrap_or(0));
        let mut mints = Vec::new();
        let mut burns = Vec::new();
        let mut transfers = Vec::new();
        for op in &ops {
            match op {
                LedgerOp::Mint { asset, amount, to, memo, source } => {
                    require!(only_from.is_none(), "Agents can only transfer their own balances.");
                    let info = check_token(asset);
                    check_holder(to);
                    require!(amount.0 > 0, "Amounts must be positive.");
                    let total = supply.get(asset).copied().unwrap_or_else(|| self.supply.get(asset).copied().unwrap_or(0))
                        .checked_add(amount.0).unwrap_or_else(|| env::panic_str("Supply overflow."));
                    if let Some(cap) = info.max_supply {
                        require!(total <= cap, format!("{} is capped at {cap}.", info.title));
                    }
                    supply.insert(asset.clone(), total);
                    let k = key(asset, to);
                    let next = balance(&balances, self, &k).checked_add(amount.0).unwrap_or_else(|| env::panic_str("Balance overflow."));
                    balances.insert(k, next);
                    mints.push((to.clone(), asset.clone(), amount.0, event_memo(&id, memo, Some(("source", source)))));
                }
                LedgerOp::Burn { asset, amount, from, memo, sink } => {
                    require!(only_from.is_none(), "Agents can only transfer their own balances.");
                    check_token(asset);
                    check_holder(from);
                    require!(amount.0 > 0, "Amounts must be positive.");
                    let k = key(asset, from);
                    let next = balance(&balances, self, &k).checked_sub(amount.0)
                        .unwrap_or_else(|| env::panic_str(&format!("{from} holds too little {asset} to burn {}.", amount.0)));
                    balances.insert(k, next);
                    let total = supply.get(asset).copied().unwrap_or_else(|| self.supply.get(asset).copied().unwrap_or(0)) - amount.0;
                    supply.insert(asset.clone(), total);
                    burns.push((from.clone(), asset.clone(), amount.0, event_memo(&id, memo, Some(("sink", sink)))));
                }
                LedgerOp::Transfer { asset, amount, from, to, memo } => {
                    if let Some(agent) = only_from {
                        require!(from == agent, "Agents can only transfer their own balances.");
                    }
                    check_token(asset);
                    check_holder(from);
                    check_holder(to);
                    require!(amount.0 > 0, "Amounts must be positive.");
                    require!(from != to, "A transfer needs two different holders.");
                    let source = key(asset, from);
                    let left = balance(&balances, self, &source).checked_sub(amount.0)
                        .unwrap_or_else(|| env::panic_str(&format!("{from} holds too little {asset} to send {}.", amount.0)));
                    balances.insert(source, left);
                    let target = key(asset, to);
                    let next = balance(&balances, self, &target).checked_add(amount.0).unwrap_or_else(|| env::panic_str("Balance overflow."));
                    balances.insert(target, next);
                    transfers.push((from.clone(), to.clone(), asset.clone(), amount.0, event_memo(&id, memo, None)));
                }
            }
        }
        for (k, value) in balances {
            if value == 0 { self.balances.remove(&k); } else { self.balances.insert(k, value); }
        }
        for (k, value) in supply {
            self.supply.insert(k, value);
        }
        self.settled.insert(id);
        events::mint(&mints.iter().map(|(owner, asset, amount, memo)| events::MintLog { owner_id: owner,
            token_ids: [asset], amounts: [amount.to_string()], memo: Some(memo) }).collect::<Vec<_>>());
        events::transfer(&transfers.iter().map(|(from, to, asset, amount, memo)| events::TransferLog { old_owner_id: from,
            new_owner_id: to, token_ids: [asset], amounts: [amount.to_string()], authorized_id: None, memo: Some(memo) }).collect::<Vec<_>>());
        events::burn(&burns.iter().map(|(owner, asset, amount, memo)| events::BurnLog { owner_id: owner,
            token_ids: [asset], amounts: [amount.to_string()], memo: Some(memo) }).collect::<Vec<_>>());
        true
    }
}

#[cfg(test)]
mod tests;
