# Multi-stage build for the AIP ZK prover service
# Uses cargo-chef for dependency caching across CI runs.
# First build: ~20min.  Code-only changes: ~2min.

FROM rust:1.85-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

FROM chef AS planner
COPY zkvm/ ./zkvm/
WORKDIR /app/zkvm
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
ENV CARGO_PROFILE_RELEASE_LTO=off

RUN curl -L https://risczero.com/install | bash && \
    /root/.risc0/bin/rzup install

# Cached layer: only rebuilds when Cargo.toml/Cargo.lock change
COPY --from=planner /app/zkvm/recipe.json /app/zkvm/recipe.json
WORKDIR /app/zkvm
RUN cargo chef cook --release --recipe-path recipe.json

# Our code (~1100 lines)
COPY zkvm/ /app/zkvm/
WORKDIR /app/zkvm
RUN cargo build --release -p aip-zkvm-methods
RUN cargo build --release -p aip-zkvm-host

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/zkvm/target/release/aip-prover /usr/local/bin/aip-prover
ENV PORT=8080
EXPOSE 8080
CMD ["aip-prover", "serve", "--port", "8080"]
