//! AIP ZK Prover — CLI and HTTP server
//!
//! Usage:
//!   aip-prover prove --input <json-file> [options]
//!   aip-prover verify --receipt <receipt-file>
//!   aip-prover serve [--port <port>]

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::fs;

#[derive(Parser)]
#[command(name = "aip-prover", about = "AIP Zero-Knowledge Verdict Prover")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate a proof for an analysis response
    Prove {
        /// Path to the analysis JSON file
        #[arg(short, long)]
        input: String,
        /// SHA-256 hash of the thinking block
        #[arg(long, default_value = "")]
        thinking_hash: String,
        /// SHA-256 hash of the alignment card
        #[arg(long, default_value = "")]
        card_hash: String,
        /// SHA-256 hash of the conscience values
        #[arg(long, default_value = "")]
        values_hash: String,
        /// Model identifier
        #[arg(long, default_value = "unknown")]
        model: String,
        /// Output file for the receipt
        #[arg(short, long, default_value = "receipt.bin")]
        output: String,
    },
    /// Verify a STARK receipt
    Verify {
        /// Path to the receipt binary file
        #[arg(short, long)]
        receipt: String,
    },
    /// Start the HTTP proving service
    Serve {
        /// Port to listen on
        #[arg(short, long, default_value = "8080")]
        port: u16,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Prove {
            input,
            thinking_hash,
            card_hash,
            values_hash,
            model,
            output,
        } => {
            let analysis_json = fs::read_to_string(&input)?;
            println!("Proving verdict derivation for: {}", input);

            let (receipt, guest_output) = aip_zkvm_host::prover::prove_verdict_derivation(
                &analysis_json,
                &thinking_hash,
                &card_hash,
                &values_hash,
                &model,
            )?;

            println!("Verdict: {:?}", guest_output.verdict);
            println!("Action: {:?}", guest_output.action);
            println!("Concerns hash: {}", guest_output.concerns_hash);

            let bytes = aip_zkvm_host::prover::receipt_to_bytes(&receipt)?;
            fs::write(&output, &bytes)?;
            println!("Receipt written to: {} ({} bytes)", output, bytes.len());

            // Self-verify
            let verified = aip_zkvm_host::prover::verify_verdict_proof(&receipt)?;
            println!("Self-verification: verdict={:?}, action={:?}", verified.verdict, verified.action);
        }
        Commands::Verify { receipt: receipt_path } => {
            let bytes = fs::read(&receipt_path)?;
            println!("Verifying receipt: {} ({} bytes)", receipt_path, bytes.len());

            let receipt = aip_zkvm_host::prover::receipt_from_bytes(&bytes)?;
            let output = aip_zkvm_host::prover::verify_verdict_proof(&receipt)?;

            println!("Verification: PASSED");
            println!("Verdict: {:?}", output.verdict);
            println!("Action: {:?}", output.action);
            println!("Concerns hash: {}", output.concerns_hash);
            println!("Thinking hash: {}", output.thinking_hash);
            println!("Card hash: {}", output.card_hash);
            println!("Values hash: {}", output.values_hash);
            println!("Model: {}", output.model);
        }
        Commands::Serve { port } => {
            let database_url = std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set");
            let prover_key = std::env::var("PROVER_API_KEY").ok();

            let db = sqlx::PgPool::connect(&database_url).await?;
            tracing::info!("Connected to database");

            let state = aip_zkvm_host::server::AppState {
                db: db.clone(),
                prover_key,
            };

            let app = aip_zkvm_host::server::build_router(state);

            // Spawn retry loop
            tokio::spawn(aip_zkvm_host::server::retry_loop(db));

            let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
            tracing::info!("Prover service listening on port {}", port);
            axum::serve(listener, app).await?;
        }
    }

    Ok(())
}
