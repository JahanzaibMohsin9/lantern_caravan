use super::*;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

fn account(name: &str) -> AccountId { name.parse().unwrap() }
fn owner() -> AccountId { account("lantern-caravan.testnet") }
fn operator() -> AccountId { account("operator.lantern-caravan.testnet") }
fn mira() -> AccountId { account("mira.lantern-caravan.testnet") }
fn player() -> AccountId { account("ari.testnet") }

fn call_as(caller: AccountId) {
    testing_env!(VMContextBuilder::new().predecessor_account_id(caller).build());
}
fn contract() -> Contract {
    call_as(owner());
    Contract::new(owner(), operator())
}
fn mint(asset: &str, amount: u128, to: &str) -> LedgerOp {
    LedgerOp::Mint { asset: asset.into(), amount: U128(amount), to: to.into(), memo: "Test mint".into(), source: None }
}
fn transfer(asset: &str, amount: u128, from: &str, to: &str) -> LedgerOp {
    LedgerOp::Transfer { asset: asset.into(), amount: U128(amount), from: from.into(), to: to.into(), memo: "Test transfer".into() }
}
fn burn(asset: &str, amount: u128, from: &str) -> LedgerOp {
    LedgerOp::Burn { asset: asset.into(), amount: U128(amount), from: from.into(), memo: "Test burn".into(), sink: None }
}
fn balance(c: &Contract, holder: &str, asset: &str) -> u128 { c.mt_balance_of(holder.into(), asset.into()).0 }
fn supply(c: &Contract, asset: &str) -> u128 { c.mt_supply(asset.into()).unwrap().0 }
fn events() -> Vec<Value> {
    get_logs().iter().filter_map(|log| log.strip_prefix("EVENT_JSON:")).map(|json| serde_json::from_str(json).unwrap()).collect()
}

#[test]
fn the_operator_settles_a_harvest_a_purchase_and_a_flare() {
    let mut c = contract();
    call_as(operator());
    // The game's v:ember_falls maps to the village's own sub-account.
    let village = "ember-falls.lantern-caravan.testnet";
    let harvest = LedgerOp::Mint { asset: "oil".into(), amount: U128(24), to: village.into(), memo: "Harvest".into(),
        source: Some("sys:harvest".into()) };
    assert!(c.game_settle("night-1-harvest".into(), vec![harvest, mint("coin", 30, player().as_str())]));
    // A fresh call context, so the events below are only this action's.
    call_as(operator());
    assert!(c.game_settle("act-1".into(), vec![
        transfer("coin", 9, player().as_str(), village),
        transfer("oil", 3, village, player().as_str()),
        LedgerOp::Burn { asset: "oil".into(), amount: U128(1), from: player().to_string(), memo: "Flare".into(), sink: Some("sys:river".into()) },
    ]));
    assert_eq!(balance(&c, village, "oil"), 21);
    assert_eq!(balance(&c, player().as_str(), "oil"), 2);
    assert_eq!(balance(&c, player().as_str(), "coin"), 21);
    assert_eq!(supply(&c, "oil"), 23);
    assert_eq!(supply(&c, "coin"), 30);
    let logged = events();
    assert_eq!(logged.iter().map(|event| event["event"].as_str().unwrap()).collect::<Vec<_>>(), ["mt_transfer", "mt_burn"]);
    assert!(logged.iter().all(|event| event["standard"] == "nep245" && event["version"] == "1.0.0"));
    assert_eq!(logged[0]["data"].as_array().unwrap().len(), 2);
    assert_eq!(logged[1]["data"][0]["memo"], "act-1 · Flare · sink=sys:river");
    assert_eq!(logged[0]["data"][1], json!({ "old_owner_id": village, "new_owner_id": "ari.testnet",
        "token_ids": ["oil"], "amounts": ["3"], "memo": "act-1 · Test transfer" }));
    assert!(c.is_settled("act-1".into()));
}

#[test]
fn a_harvest_mint_names_its_source_in_the_event_memo() {
    let mut c = contract();
    call_as(operator());
    c.game_settle("h".into(), vec![LedgerOp::Mint { asset: "dye".into(), amount: U128(14), to: "reedmarsh.lantern-caravan.testnet".into(),
        memo: "Harvest".into(), source: Some("sys:harvest".into()) }]);
    let logged = events();
    assert_eq!(logged[0]["event"], "mt_mint");
    assert_eq!(logged[0]["data"][0]["memo"], "h · Harvest · source=sys:harvest");
}

#[test]
fn settling_the_same_action_twice_changes_nothing() {
    let mut c = contract();
    call_as(operator());
    assert!(c.game_settle("a".into(), vec![mint("coin", 10, "sys:rescue")]));
    call_as(operator());
    assert!(!c.game_settle("a".into(), vec![mint("coin", 10, "sys:rescue")]));
    assert_eq!(balance(&c, "sys:rescue", "coin"), 10);
    assert!(events().is_empty());
}

#[test]
fn a_failing_op_leaves_the_whole_action_unapplied() {
    let mut c = contract();
    call_as(operator());
    c.game_settle("fund".into(), vec![mint("coin", 5, player().as_str())]);
    call_as(operator());
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.game_settle("overdraw".into(), vec![transfer("coin", 3, player().as_str(), "esc:bell:1"), transfer("coin", 3, player().as_str(), "esc:bell:1")])
    }));
    assert!(result.is_err());
    assert_eq!(balance(&c, player().as_str(), "coin"), 5);
    assert_eq!(balance(&c, "esc:bell:1", "coin"), 0);
    assert!(!c.is_settled("overdraw".into()));
}

#[test]
fn ops_within_one_action_build_on_each_other() {
    let mut c = contract();
    call_as(operator());
    c.game_settle("craft".into(), vec![mint("paper", 1, player().as_str()), mint("oil", 1, player().as_str()),
        burn("paper", 1, player().as_str()), burn("oil", 1, player().as_str()), mint("lantern_paper", 1, player().as_str())]);
    assert_eq!(balance(&c, player().as_str(), "paper"), 0);
    assert_eq!(supply(&c, "paper"), 0);
    assert_eq!(balance(&c, player().as_str(), "lantern_paper"), 1);
}

#[test]
#[should_panic(expected = "Only the game operator can settle.")]
fn only_the_operator_can_settle() {
    let mut c = contract();
    call_as(player());
    c.game_settle("x".into(), vec![mint("coin", 1, player().as_str())]);
}

#[test]
#[should_panic(expected = "Unknown token gold.")]
fn unknown_tokens_are_refused() {
    let mut c = contract();
    call_as(operator());
    c.game_settle("x".into(), vec![mint("gold", 1, player().as_str())]);
}

#[test]
#[should_panic(expected = "Unknown holder p:guest")]
fn game_ids_must_be_mapped_to_accounts_first() {
    let mut c = contract();
    call_as(operator());
    c.game_settle("x".into(), vec![mint("coin", 1, "p:guest")]);
}

#[test]
#[should_panic(expected = "Paper Mill share is capped at 20.")]
fn stall_shares_never_exceed_twenty() {
    let mut c = contract();
    call_as(operator());
    c.game_settle("offer".into(), vec![mint("share:paper_mill", 15, player().as_str()), mint("share:paper_mill", 6, "esc:offer:1")]);
}

#[test]
#[should_panic(expected = "Amounts must be positive.")]
fn zero_amounts_are_refused() {
    let mut c = contract();
    call_as(operator());
    c.game_settle("x".into(), vec![mint("coin", 0, player().as_str())]);
}

#[test]
fn a_registered_agent_signs_its_own_transfers() {
    let mut c = contract();
    call_as(operator());
    c.register_agents(vec![mira()]);
    c.game_settle("stock".into(), vec![mint("paper", 12, mira().as_str()), mint("coin", 8, player().as_str())]);
    call_as(mira());
    assert!(c.agent_settle("restock-1".into(), vec![transfer("paper", 2, mira().as_str(), "esc:run:7")]));
    call_as(mira());
    assert!(!c.agent_settle("restock-1".into(), vec![transfer("paper", 2, mira().as_str(), "esc:run:7")]));
    assert_eq!(balance(&c, mira().as_str(), "paper"), 10);
    assert!(c.is_settled(format!("agent/{}/restock-1", mira())));
}

#[test]
#[should_panic(expected = "Agents can only transfer their own balances.")]
fn an_agent_cannot_move_someone_else_s_balance() {
    let mut c = contract();
    call_as(operator());
    c.register_agents(vec![mira()]);
    c.game_settle("fund".into(), vec![mint("coin", 8, player().as_str())]);
    call_as(mira());
    c.agent_settle("steal".into(), vec![transfer("coin", 8, player().as_str(), mira().as_str())]);
}

#[test]
#[should_panic(expected = "Agents can only transfer their own balances.")]
fn an_agent_cannot_mint() {
    let mut c = contract();
    call_as(operator());
    c.register_agents(vec![mira()]);
    call_as(mira());
    c.agent_settle("print".into(), vec![mint("coin", 100, mira().as_str())]);
}

#[test]
#[should_panic(expected = "Only a registered agent can sign its own transfers.")]
fn unregistered_accounts_are_not_agents() {
    let mut c = contract();
    call_as(player());
    c.agent_settle("x".into(), vec![transfer("coin", 1, player().as_str(), "sys:crowd")]);
}

#[test]
#[should_panic(expected = "Only the owner can change the operator.")]
fn only_the_owner_changes_the_operator() {
    let mut c = contract();
    call_as(operator());
    c.set_operator(player());
}

#[test]
#[should_panic(expected = "direct transfers are disabled")]
fn direct_transfers_are_disabled() {
    let mut c = contract();
    call_as(player());
    c.mt_transfer(mira(), "coin".into(), U128(1), None, None);
}

#[test]
fn views_report_balances_supply_tokens_and_metadata() {
    let mut c = contract();
    call_as(operator());
    c.game_settle("a".into(), vec![mint("coin", 7, player().as_str()), mint("share:oil_wharf", 2, player().as_str())]);
    assert_eq!(c.mt_batch_balance_of(player().to_string(), vec!["coin".into(), "share:oil_wharf".into(), "dye".into()]),
        vec![U128(7), U128(2), U128(0)]);
    assert_eq!(c.mt_batch_supply(vec!["coin".into(), "gold".into()]).iter().map(|s| s.map(|s| s.0)).collect::<Vec<_>>(), vec![Some(7), None]);
    assert_eq!(c.mt_tokens().len(), TOKENS.len());
    assert!(c.mt_token(vec!["oil".into(), "gold".into()])[1].is_none());
    assert_eq!(c.mt_metadata_contract().spec, "mt-1.0.0");
    let meta = c.mt_metadata_token_all(vec!["share:oil_wharf".into()]);
    let share = meta[0].as_ref().unwrap();
    assert_eq!(share.base.decimals.as_deref(), Some("0"));
    assert_eq!(share.token.extra.as_deref(), Some("{\"max_supply\":20}"));
}

#[test]
fn the_game_s_ledger_ops_deserialize_unchanged() {
    // Exactly what the game's quote → submit flow emits for a Bell order delivery.
    let ops: Vec<LedgerOp> = serde_json::from_value(json!([
        { "op": "transfer", "asset": "oil", "amount": "6", "from": "juno.lantern-caravan.testnet", "to": "ari.testnet", "memo": "Bell order delivery" },
        { "op": "transfer", "asset": "coin", "amount": "54", "from": "esc:bell:q-1", "to": "juno.lantern-caravan.testnet", "memo": "Bell order payout" },
        { "op": "burn", "asset": "oil", "amount": "2", "from": "esc:wreck:wreck-4-9", "memo": "Wreck broke up", "sink": "sys:river" },
        { "op": "mint", "asset": "paper", "amount": "24", "to": "millbrook.lantern-caravan.testnet", "memo": "Harvest", "source": "sys:harvest" }
    ])).unwrap();
    assert_eq!(ops.len(), 4);
    assert!(matches!(&ops[2], LedgerOp::Burn { sink: Some(sink), .. } if sink == "sys:river"));
    assert!(matches!(&ops[3], LedgerOp::Mint { source: Some(source), .. } if source == "sys:harvest"));
}
