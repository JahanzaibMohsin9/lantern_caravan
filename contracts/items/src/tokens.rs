//! The fixed token catalog. Every asset the game's ledger uses is listed here, so the contract
//! rejects anything it doesn't know instead of silently creating a new token.

/// A token the contract holds balances for.
pub struct TokenInfo {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    /// Hard cap on total supply, if any. Stall shares are capped at 20 per stall.
    pub max_supply: Option<u128>,
}

pub const SHARE_CAP: u128 = 20;

pub const TOKENS: &[TokenInfo] = &[
    TokenInfo { id: "coin", title: "Coin", description: "In-game coin with no real-world value.", max_supply: None },
    TokenInfo { id: "paper", title: "Paper", description: "Harvested at Millbrook.", max_supply: None },
    TokenInfo { id: "oil", title: "Lamp oil", description: "Pressed at Ember Falls.", max_supply: None },
    TokenInfo { id: "reed", title: "Reed frame", description: "Cut at Reedmarsh.", max_supply: None },
    TokenInfo { id: "cord", title: "Cord", description: "Spun at Millbrook.", max_supply: None },
    TokenInfo { id: "dye", title: "Dye", description: "Gathered in the Reedmarsh pools.", max_supply: None },
    TokenInfo { id: "lantern_paper", title: "Paper lantern", description: "Crafted from paper and oil.", max_supply: None },
    TokenInfo { id: "lantern_float", title: "Floating lantern", description: "Crafted from paper, oil and a reed frame.", max_supply: None },
    TokenInfo { id: "lantern_color", title: "Colored lantern", description: "Crafted from paper, oil, dye and cord.", max_supply: None },
    TokenInfo { id: "share:paper_mill", title: "Paper Mill share", description: "One of 20 shares in Mira's Paper Mill.", max_supply: Some(SHARE_CAP) },
    TokenInfo { id: "share:oil_wharf", title: "Oil Wharf share", description: "One of 20 shares in Sami's Oil Wharf.", max_supply: Some(SHARE_CAP) },
    TokenInfo { id: "share:reed_thread", title: "Reed & Thread share", description: "One of 20 shares in Toma's Reed & Thread.", max_supply: Some(SHARE_CAP) },
    TokenInfo { id: "share:indigo_atelier", title: "Indigo Atelier share", description: "One of 20 shares in Nila's Indigo Atelier.", max_supply: Some(SHARE_CAP) },
    TokenInfo { id: "share:lantern_house", title: "Lantern House share", description: "One of 20 shares in Asha's Lantern House.", max_supply: Some(SHARE_CAP) },
];

pub fn token(id: &str) -> Option<&'static TokenInfo> {
    TOKENS.iter().find(|token| token.id == id)
}

/// Game-internal holders (funds, escrows, dividend pools) live inside the contract under a prefixed key.
/// A colon can't appear in a NEAR account ID, so these keys can never collide with a real account.
pub const INTERNAL_PREFIXES: &[&str] = &["sys:", "esc:", "pool:"];

pub fn is_internal(holder: &str) -> bool {
    INTERNAL_PREFIXES.iter().any(|prefix| holder.starts_with(prefix) && holder.len() > prefix.len())
}
