//! Criterion benchmarks for AIP verdict proving and verification.
//!
//! These benchmarks require the RISC Zero toolchain (`cargo risczero install`)
//! and are gated behind the `bench-proving` cargo feature. Run them with:
//!
//!   cargo bench --bench proving --features bench-proving
//!
//! Expected performance targets:
//!   - prove_verdict_derivation: 3-15s per proof
//!   - verify_verdict_proof:     <100ms
//!   - receipt_serialization:    <10ms, receipt size 200KB-2MB
//!   - peak_memory_proving:      <3GB RSS

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use std::time::Duration;

// ---------------------------------------------------------------------------
// Test fixture JSON — same files used by the prover unit tests.
// Paths are relative to the host crate root (Cargo resolves them from there).
// ---------------------------------------------------------------------------

const CLEAR_JSON: &str = include_str!("../../tests/fixtures/clear.json");
const REVIEW_NEEDED_JSON: &str = include_str!("../../tests/fixtures/review_needed.json");
const BOUNDARY_INJECTION_JSON: &str = include_str!("../../tests/fixtures/boundary_injection.json");
const BOUNDARY_DECEPTION_JSON: &str = include_str!("../../tests/fixtures/boundary_deception.json");

/// Dummy commitment hashes used across all fixtures.
const THINKING_HASH: &str = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
const CARD_HASH: &str = "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3";
const VALUES_HASH: &str = "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
const MODEL: &str = "bench-model";

/// Helper: list of (label, json) fixture pairs for parameterized benchmarks.
fn fixtures() -> Vec<(&'static str, &'static str)> {
    vec![
        ("clear", CLEAR_JSON),
        ("review_needed", REVIEW_NEEDED_JSON),
        ("boundary_violation", BOUNDARY_INJECTION_JSON),
        ("multi_concern", BOUNDARY_DECEPTION_JSON),
    ]
}

// ---------------------------------------------------------------------------
// 1. prove_verdict_derivation
//    Full end-to-end proof generation for each fixture input.
//    Expected: 3-15 s per invocation.
// ---------------------------------------------------------------------------

fn prove_verdict_derivation(c: &mut Criterion) {
    let mut group = c.benchmark_group("prove_verdict_derivation");
    // Proving is slow — limit iterations so CI does not hang.
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(60));

    for (label, json) in fixtures() {
        group.bench_with_input(
            BenchmarkId::from_parameter(label),
            &json,
            |b, &json| {
                b.iter(|| {
                    let (receipt, output) = aip_zkvm_host::prover::prove_verdict_derivation(
                        black_box(json),
                        black_box(THINKING_HASH),
                        black_box(CARD_HASH),
                        black_box(VALUES_HASH),
                        black_box(MODEL),
                    )
                    .expect("proving must succeed");
                    black_box((&receipt, &output));
                });
            },
        );
    }
    group.finish();
}

// ---------------------------------------------------------------------------
// 2. verify_verdict_proof
//    Verify a pre-generated receipt. We generate the receipt once in setup,
//    then benchmark only the verification path.
//    Expected: <100 ms.
// ---------------------------------------------------------------------------

fn verify_verdict_proof(c: &mut Criterion) {
    // Generate a receipt once (expensive) to benchmark verification (cheap).
    let (receipt, _) = aip_zkvm_host::prover::prove_verdict_derivation(
        CLEAR_JSON,
        THINKING_HASH,
        CARD_HASH,
        VALUES_HASH,
        MODEL,
    )
    .expect("setup: proving must succeed for verify benchmark");

    let mut group = c.benchmark_group("verify_verdict_proof");
    group.sample_size(50);
    group.measurement_time(Duration::from_secs(10));

    group.bench_function("clear_receipt", |b| {
        b.iter(|| {
            let output = aip_zkvm_host::prover::verify_verdict_proof(black_box(&receipt))
                .expect("verification must succeed");
            black_box(&output);
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// 3. receipt_serialization_roundtrip
//    Serialize a receipt to bytes (bincode), then deserialize it back.
//    Expected: <10 ms round-trip, receipt size 200 KB - 2 MB.
// ---------------------------------------------------------------------------

fn receipt_serialization_roundtrip(c: &mut Criterion) {
    // Generate a receipt once.
    let (receipt, _) = aip_zkvm_host::prover::prove_verdict_derivation(
        CLEAR_JSON,
        THINKING_HASH,
        CARD_HASH,
        VALUES_HASH,
        MODEL,
    )
    .expect("setup: proving must succeed for serialization benchmark");

    let serialized = aip_zkvm_host::prover::receipt_to_bytes(&receipt)
        .expect("setup: serialization must succeed");

    // Print size once so the operator can eyeball the 200KB-2MB expectation.
    eprintln!(
        "[bench] receipt byte size: {} bytes ({:.2} KB)",
        serialized.len(),
        serialized.len() as f64 / 1024.0
    );

    let mut group = c.benchmark_group("receipt_serialization_roundtrip");
    group.sample_size(100);
    group.measurement_time(Duration::from_secs(10));

    group.bench_function("serialize", |b| {
        b.iter(|| {
            let bytes = aip_zkvm_host::prover::receipt_to_bytes(black_box(&receipt))
                .expect("serialization must succeed");
            black_box(&bytes);
        });
    });

    group.bench_function("deserialize", |b| {
        b.iter(|| {
            let restored = aip_zkvm_host::prover::receipt_from_bytes(black_box(&serialized))
                .expect("deserialization must succeed");
            black_box(&restored);
        });
    });

    group.bench_function("roundtrip", |b| {
        b.iter(|| {
            let bytes = aip_zkvm_host::prover::receipt_to_bytes(black_box(&receipt))
                .expect("serialization must succeed");
            let restored = aip_zkvm_host::prover::receipt_from_bytes(black_box(&bytes))
                .expect("deserialization must succeed");
            black_box(&restored);
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// 4. peak_memory_proving
//    Measure peak resident set size (RSS) during a proving run.
//    This is not a traditional throughput benchmark — we use criterion only to
//    record the measurement as a custom metric.  Expected: <3 GB.
//
//    On macOS we read `rusage.ru_maxrss` (bytes); on Linux it is in KB.
// ---------------------------------------------------------------------------

fn peak_memory_proving(c: &mut Criterion) {
    let mut group = c.benchmark_group("peak_memory_proving");
    group.sample_size(10);
    group.measurement_time(Duration::from_secs(120));

    group.bench_function("clear_fixture", |b| {
        b.iter(|| {
            let rss_before = get_peak_rss_bytes();

            let (receipt, output) = aip_zkvm_host::prover::prove_verdict_derivation(
                black_box(CLEAR_JSON),
                black_box(THINKING_HASH),
                black_box(CARD_HASH),
                black_box(VALUES_HASH),
                black_box(MODEL),
            )
            .expect("proving must succeed");

            let rss_after = get_peak_rss_bytes();
            let delta_mb = (rss_after.saturating_sub(rss_before)) as f64 / (1024.0 * 1024.0);
            eprintln!(
                "[bench] peak RSS delta: {:.1} MB  (before={:.1} MB, after={:.1} MB)",
                delta_mb,
                rss_before as f64 / (1024.0 * 1024.0),
                rss_after as f64 / (1024.0 * 1024.0),
            );

            // Assert under 3 GB
            assert!(
                rss_after < 3 * 1024 * 1024 * 1024,
                "peak RSS {:.1} MB exceeds 3 GB limit",
                rss_after as f64 / (1024.0 * 1024.0),
            );

            black_box((&receipt, &output));
        });
    });

    group.finish();
}

/// Read the current process peak RSS in bytes.
///
/// - macOS: `ru_maxrss` is already in bytes.
/// - Linux: `ru_maxrss` is in kilobytes.
fn get_peak_rss_bytes() -> u64 {
    #[cfg(unix)]
    {
        let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
        let ret = unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) };
        if ret != 0 {
            return 0;
        }
        let rss = usage.ru_maxrss as u64;

        #[cfg(target_os = "macos")]
        {
            rss // already bytes on macOS
        }
        #[cfg(not(target_os = "macos"))]
        {
            rss * 1024 // KB to bytes on Linux
        }
    }

    #[cfg(not(unix))]
    {
        0 // Unsupported platform — just return 0
    }
}

// ---------------------------------------------------------------------------
// Criterion wiring
// ---------------------------------------------------------------------------

criterion_group! {
    name = proving_benches;
    config = Criterion::default()
        .with_output_color(true)
        .noise_threshold(0.05);
    targets =
        prove_verdict_derivation,
        verify_verdict_proof,
        receipt_serialization_roundtrip,
        peak_memory_proving
}

criterion_main!(proving_benches);
