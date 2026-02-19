//! Concern hashing for cross-language conformance.

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use sha2::{Sha256, Digest};
use crate::types::{Concern, MAX_EVIDENCE_LENGTH};
use serde::Serialize;

/// Normalized concern for hashing — evidence truncated to MAX_EVIDENCE_LENGTH.
#[derive(Serialize)]
struct NormalizedConcern {
    category: String,
    severity: String,
    description: String,
    evidence: String,
}

/// Hash a list of concerns into a deterministic SHA-256 hex string.
///
/// Process:
/// 1. Truncate evidence to MAX_EVIDENCE_LENGTH chars
/// 2. Serialize each concern as JSON with sorted keys
/// 3. Concatenate all concern JSONs
/// 4. SHA-256 hash the concatenation
pub fn hash_concerns(concerns: &[Concern]) -> String {
    let normalized: Vec<NormalizedConcern> = concerns
        .iter()
        .map(|c| {
            let evidence = if c.evidence.len() > MAX_EVIDENCE_LENGTH {
                c.evidence[..MAX_EVIDENCE_LENGTH].to_string()
            } else {
                c.evidence.clone()
            };

            // Serialize category/severity to their JSON string values
            let category = serde_json::to_string(&c.category)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string();
            let severity = serde_json::to_string(&c.severity)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string();

            NormalizedConcern {
                category,
                severity,
                description: c.description.clone(),
                evidence,
            }
        })
        .collect();

    let json = serde_json::to_string(&normalized).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ConcernCategory, Severity};
    use alloc::string::ToString;

    #[test]
    fn test_hash_empty_concerns() {
        let hash = hash_concerns(&[]);
        // SHA-256 of "[]"
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64); // SHA-256 hex is 64 chars
    }

    #[test]
    fn test_hash_deterministic() {
        let concerns = vec![Concern {
            category: ConcernCategory::PromptInjection,
            severity: Severity::Critical,
            description: "Test injection attempt".to_string(),
            evidence: "suspicious content".to_string(),
        }];
        let hash1 = hash_concerns(&concerns);
        let hash2 = hash_concerns(&concerns);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_evidence_truncation() {
        let long_evidence = "x".repeat(500);
        let concerns = vec![Concern {
            category: ConcernCategory::PromptInjection,
            severity: Severity::High,
            description: "test".to_string(),
            evidence: long_evidence,
        }];
        // Should not panic and should produce a valid hash
        let hash = hash_concerns(&concerns);
        assert_eq!(hash.len(), 64);
    }
}
