//! RISC Zero guest program for AIP verdict derivation proofs.
//!
//! This binary runs inside the zkVM and proves that applying the AIP
//! verdict rules to the analysis response deterministically produces
//! the claimed verdict and action. It does NOT trust the LLM's stated
//! verdict — it re-derives it from the concerns.
//!
//! Cycle budget target: ~10K RISC-V cycles.

#![no_main]
#![no_std]

extern crate alloc;

use alloc::string::String;
use risc0_zkvm::guest::env;
use aip_zkvm_core::{
    AnalysisResponse, GuestInput, GuestOutput, MAX_EVIDENCE_LENGTH,
    derive_verdict, map_verdict_to_action, hash_concerns,
};

risc0_zkvm::guest::entry!(main);

fn main() {
    // 1. Read input from host
    let input: GuestInput = env::read();

    // 2. Extract JSON from potential markdown fences
    let json_str = extract_json(&input.analysis_json);

    // 3. Parse the analysis response
    let mut response: AnalysisResponse = serde_json::from_str(&json_str)
        .expect("Failed to parse analysis JSON");

    // 4. Truncate evidence to MAX_EVIDENCE_LENGTH (mirrors TypeScript)
    for concern in response.concerns.iter_mut() {
        if concern.evidence.len() > MAX_EVIDENCE_LENGTH {
            concern.evidence = concern.evidence[..MAX_EVIDENCE_LENGTH].into();
        }
    }

    // 5. Re-derive verdict from concerns (does NOT trust LLM's stated verdict)
    let verdict = derive_verdict(&response.concerns);

    // 6. Map verdict to action
    let action = map_verdict_to_action(&verdict, &response.concerns);

    // 7. Hash the normalized concerns
    let concerns_hash = hash_concerns(&response.concerns);

    // 8. Commit output to journal
    let output = GuestOutput {
        verdict,
        action,
        concerns_hash,
        thinking_hash: input.thinking_hash,
        card_hash: input.card_hash,
        values_hash: input.values_hash,
        model: input.model,
    };

    env::commit(&output);
}

/// Extract JSON from potential markdown code fences.
/// Finds the first '{' and last '}' in the string.
fn extract_json(input: &str) -> String {
    if let (Some(start), Some(end)) = (input.find('{'), input.rfind('}')) {
        if start <= end {
            return input[start..=end].into();
        }
    }
    input.into()
}
