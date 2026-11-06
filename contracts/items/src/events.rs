//! NEP-245 standard events (`EVENT_JSON:` logs). Explorers and indexers read these to show every
//! mint, transfer and burn; the memo carries the game's action ID and the op's own memo.

use near_sdk::env;
use near_sdk::serde::Serialize;
use near_sdk::serde_json::{self, json};

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MintLog<'a> {
    pub owner_id: &'a str,
    pub token_ids: [&'a str; 1],
    pub amounts: [String; 1],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BurnLog<'a> {
    pub owner_id: &'a str,
    pub token_ids: [&'a str; 1],
    pub amounts: [String; 1],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TransferLog<'a> {
    pub old_owner_id: &'a str,
    pub new_owner_id: &'a str,
    pub token_ids: [&'a str; 1],
    pub amounts: [String; 1],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorized_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<&'a str>,
}

fn emit<T: Serialize>(event: &str, data: &[T]) {
    let log = json!({ "standard": "nep245", "version": "1.0.0", "event": event, "data": data });
    env::log_str(&format!("EVENT_JSON:{}", serde_json::to_string(&log).unwrap_or_default()));
}

pub fn mint(data: &[MintLog]) { if !data.is_empty() { emit("mt_mint", data) } }
pub fn burn(data: &[BurnLog]) { if !data.is_empty() { emit("mt_burn", data) } }
pub fn transfer(data: &[TransferLog]) { if !data.is_empty() { emit("mt_transfer", data) } }
