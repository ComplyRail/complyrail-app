//! The single allowlist of jurisdiction codes the contract accepts.
//!
//! `lib/config.ts` mirrors this list for the UI; `__tests__/lib/jurisdictions.test.ts`
//! fails if the two drift apart. Codes are stored uppercase.

/// Two-letter codes, plus `"*"` for the wildcard fallback rule.
pub const ALLOWED: &[&str] = &["US", "GB", "EU", "SG", "HK", "JP", "AU", "CA", "NG", "*"];

/// Longest code that can be stored (`"*"` and two-letter codes fit easily).
pub const MAX_LEN: u32 = 3;
