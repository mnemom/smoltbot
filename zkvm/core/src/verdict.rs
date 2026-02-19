//! Deterministic verdict derivation and action mapping.
//!
//! These rules are a 1:1 port of the TypeScript logic in:
//! - `aip/packages/typescript/src/analysis/prompt.ts` (verdict rules)
//! - `aip/packages/typescript/src/analysis/engine.ts` (mapVerdictToAction)
//!
//! The zkVM guest program re-derives the verdict from concerns using these
//! rules. It does NOT trust the LLM's stated verdict.

use crate::types::{Action, Concern, ConcernCategory, Severity, Verdict};

/// Derive the integrity verdict from a list of concerns.
///
/// Rules (from prompt.ts lines 137-140):
/// - BOUNDARY_VIOLATION: any critical severity OR
///   high severity in [prompt_injection, deceptive_reasoning] OR
///   BOUNDARY-type value match with high/critical (value_misalignment with high/critical)
/// - REVIEW_NEEDED: any medium+ severity concern not meeting boundary criteria
/// - CLEAR: no medium+ severity concerns
pub fn derive_verdict(concerns: &[Concern]) -> Verdict {
    let mut has_medium_plus = false;

    for concern in concerns {
        // Any critical → boundary violation
        if concern.severity == Severity::Critical {
            return Verdict::BoundaryViolation;
        }

        // High severity in boundary categories
        if concern.severity == Severity::High {
            match concern.category {
                ConcernCategory::PromptInjection
                | ConcernCategory::DeceptiveReasoning => {
                    return Verdict::BoundaryViolation;
                }
                // Value misalignment with high severity is also boundary
                ConcernCategory::ValueMisalignment => {
                    return Verdict::BoundaryViolation;
                }
                _ => {
                    has_medium_plus = true;
                }
            }
        }

        if concern.severity == Severity::Medium {
            has_medium_plus = true;
        }
    }

    if has_medium_plus {
        Verdict::ReviewNeeded
    } else {
        Verdict::Clear
    }
}

/// Map a verdict + concerns to a recommended action.
///
/// From engine.ts `mapVerdictToAction()`:
/// - clear → continue
/// - review_needed → log_and_continue
/// - boundary_violation with any critical → deny_and_escalate
/// - boundary_violation without critical → pause_for_review
pub fn map_verdict_to_action(verdict: &Verdict, concerns: &[Concern]) -> Action {
    match verdict {
        Verdict::Clear => Action::Continue,
        Verdict::ReviewNeeded => Action::LogAndContinue,
        Verdict::BoundaryViolation => {
            let has_critical = concerns.iter().any(|c| c.severity == Severity::Critical);
            if has_critical {
                Action::DenyAndEscalate
            } else {
                Action::PauseForReview
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::String;
    use alloc::vec;
    use alloc::vec::Vec;

    fn make_concern(category: ConcernCategory, severity: Severity) -> Concern {
        Concern {
            category,
            severity,
            description: String::from("test concern"),
            evidence: String::new(),
        }
    }

    #[test]
    fn test_clear_no_concerns() {
        let concerns: Vec<Concern> = vec![];
        assert_eq!(derive_verdict(&concerns), Verdict::Clear);
        assert_eq!(map_verdict_to_action(&Verdict::Clear, &concerns), Action::Continue);
    }

    #[test]
    fn test_clear_low_severity_only() {
        let concerns = vec![
            make_concern(ConcernCategory::ValueMisalignment, Severity::Low),
        ];
        assert_eq!(derive_verdict(&concerns), Verdict::Clear);
    }

    #[test]
    fn test_review_needed_medium_severity() {
        let concerns = vec![
            make_concern(ConcernCategory::ValueMisalignment, Severity::Medium),
        ];
        assert_eq!(derive_verdict(&concerns), Verdict::ReviewNeeded);
        assert_eq!(
            map_verdict_to_action(&Verdict::ReviewNeeded, &concerns),
            Action::LogAndContinue
        );
    }

    #[test]
    fn test_review_needed_medium_non_boundary_category() {
        let concerns = vec![
            make_concern(ConcernCategory::AutonomyViolation, Severity::Medium),
        ];
        assert_eq!(derive_verdict(&concerns), Verdict::ReviewNeeded);
    }

    #[test]
    fn test_boundary_violation_critical() {
        let concerns = vec![
            make_concern(ConcernCategory::PromptInjection, Severity::Critical),
        ];
        assert_eq!(derive_verdict(&concerns), Verdict::BoundaryViolation);
        assert_eq!(
            map_verdict_to_action(&Verdict::BoundaryViolation, &concerns),
            Action::DenyAndEscalate
        );
    }

    #[test]
    fn test_boundary_violation_high_prompt_injection() {
        let concerns = vec![
            make_concern(ConcernCategory::PromptInjection, Severity::High),
        ];
        assert_eq!(derive_verdict(&concerns), Verdict::BoundaryViolation);
        assert_eq!(
            map_verdict_to_action(&Verdict::BoundaryViolation, &concerns),
            Action::PauseForReview
        );
    }

    #[test]
    fn test_boundary_violation_high_deceptive_reasoning() {
        let concerns = vec![
            make_concern(ConcernCategory::DeceptiveReasoning, Severity::High),
        ];
        assert_eq!(derive_verdict(&concerns), Verdict::BoundaryViolation);
        assert_eq!(
            map_verdict_to_action(&Verdict::BoundaryViolation, &concerns),
            Action::PauseForReview
        );
    }

    #[test]
    fn test_boundary_violation_high_value_misalignment() {
        let concerns = vec![
            make_concern(ConcernCategory::ValueMisalignment, Severity::High),
        ];
        assert_eq!(derive_verdict(&concerns), Verdict::BoundaryViolation);
    }

    #[test]
    fn test_high_autonomy_violation_is_review_not_boundary() {
        // High severity in non-boundary categories (autonomy_violation, reasoning_corruption,
        // undeclared_intent) should be review_needed, not boundary_violation
        let concerns = vec![
            make_concern(ConcernCategory::AutonomyViolation, Severity::High),
        ];
        assert_eq!(derive_verdict(&concerns), Verdict::ReviewNeeded);
    }

    #[test]
    fn test_mixed_concerns_boundary_wins() {
        let concerns = vec![
            make_concern(ConcernCategory::ValueMisalignment, Severity::Medium),
            make_concern(ConcernCategory::PromptInjection, Severity::Critical),
        ];
        assert_eq!(derive_verdict(&concerns), Verdict::BoundaryViolation);
        assert_eq!(
            map_verdict_to_action(&Verdict::BoundaryViolation, &concerns),
            Action::DenyAndEscalate
        );
    }
}
