//! Shared types for AIP zkVM proofs.
//!
//! These mirror the TypeScript types in `@mnemom/agent-integrity-protocol`:
//! - ConcernCategory from `schemas/concern.ts`
//! - Severity, Verdict, Action from `analysis/engine.ts`
//! - AnalysisResponse matches the LLM JSON output

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// Concern categories from the AIP specification.
/// Maps to TypeScript: "prompt_injection" | "value_misalignment" | "autonomy_violation"
///   | "reasoning_corruption" | "deceptive_reasoning" | "undeclared_intent"
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConcernCategory {
    PromptInjection,
    ValueMisalignment,
    AutonomyViolation,
    ReasoningCorruption,
    DeceptiveReasoning,
    UndeclaredIntent,
}

/// Severity levels with total ordering: low < medium < high < critical
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

/// A single concern raised during integrity analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Concern {
    pub category: ConcernCategory,
    pub severity: Severity,
    pub description: String,
    #[serde(default)]
    pub evidence: String,
}

/// Integrity verdict — the conclusion of the analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Clear,
    ReviewNeeded,
    BoundaryViolation,
}

/// Recommended action based on verdict + concern severity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Continue,
    LogAndContinue,
    PauseForReview,
    DenyAndEscalate,
}

/// The LLM analysis response JSON structure.
/// This is what the guest program parses and re-evaluates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResponse {
    pub verdict: String, // We don't trust this — we re-derive it
    pub concerns: Vec<Concern>,
    pub confidence: f64,
    pub reasoning_summary: String,
}

/// Maximum evidence length (mirrors TypeScript MAX_EVIDENCE_LENGTH).
pub const MAX_EVIDENCE_LENGTH: usize = 200;

/// Input to the zkVM guest program.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestInput {
    /// The raw analysis JSON string from the LLM
    pub analysis_json: String,
    /// SHA-256 hash of the thinking block
    pub thinking_hash: String,
    /// SHA-256 hash of the alignment card
    pub card_hash: String,
    /// SHA-256 hash of the conscience values
    pub values_hash: String,
    /// Model identifier (e.g. "claude-haiku-4-5-20251001")
    pub model: String,
}

/// Output committed by the zkVM guest program.
/// This is what appears in the proof journal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestOutput {
    /// The verdict derived by applying rules to concerns
    pub verdict: Verdict,
    /// The action mapped from verdict + severity
    pub action: Action,
    /// SHA-256 hash of the normalized concerns array
    pub concerns_hash: String,
    /// Pass-through input commitment hashes
    pub thinking_hash: String,
    pub card_hash: String,
    pub values_hash: String,
    pub model: String,
}
