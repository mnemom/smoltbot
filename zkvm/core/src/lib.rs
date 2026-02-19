//! Core types and verdict logic for AIP zero-knowledge proofs.
//!
//! This crate is `no_std` compatible (with `alloc`) so it can run inside
//! a RISC Zero guest program. Enable the `std` feature for host-side use.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod types;
pub mod verdict;
pub mod hash;

pub use types::*;
pub use verdict::*;
pub use hash::*;
