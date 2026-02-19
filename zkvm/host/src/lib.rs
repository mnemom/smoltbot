//! Host-side prover and verifier library for AIP verdict proofs.
//!
//! This crate wraps the RISC Zero proving and verification APIs,
//! providing a clean interface for generating and verifying STARK
//! proofs of verdict derivation.

pub mod prover;
pub mod server;
