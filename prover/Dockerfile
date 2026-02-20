# Multi-stage build for the AIP ZK prover service
# Uses cargo-chef for dependency caching across builds.
# First build: ~20min.  Code-only changes: ~2min.

FROM rust:1.82-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

# --- Planner: extract dependency recipe from source ---
FROM chef AS planner
COPY zkvm/ ./zkvm/
WORKDIR /app/zkvm
RUN cargo chef prepare --recipe-path recipe.json

# --- Builder ---
FROM chef AS builder

# Prevent OOM on Fly remote builder:
#   thin LTO — fraction of memory vs full LTO (the OOM root cause)
#   2 parallel jobs + 4 codegen units — cap peak memory
ENV CARGO_BUILD_JOBS=2
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=4
ENV CARGO_PROFILE_RELEASE_LTO=thin

# Install RISC Zero toolchain
RUN curl -L https://risczero.com/install | bash && \
    /root/.risc0/bin/rzup install

# Cache compiled dependencies (rebuilds ONLY when Cargo.toml/Cargo.lock change)
COPY --from=planner /app/zkvm/recipe.json /app/zkvm/recipe.json
WORKDIR /app/zkvm
RUN cargo chef cook --release --recipe-path recipe.json

# Copy real source and build (only our ~1100 lines recompile on code changes)
COPY zkvm/ /app/zkvm/
WORKDIR /app/zkvm
RUN cargo build --release -p aip-zkvm-methods
RUN cargo build --release -p aip-zkvm-host

# --- Runtime ---
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/zkvm/target/release/aip-prover /usr/local/bin/aip-prover

ENV PORT=8080
EXPOSE 8080

CMD ["aip-prover", "serve", "--port", "8080"]
