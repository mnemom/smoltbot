# Multi-stage build for the AIP ZK prover service
# Stage 1: Build guest ELF + host binary
# Stage 2: Minimal runtime image

FROM rust:1.85-bookworm AS builder

# Prevent OOM on Fly remote builder:
#   thin LTO — fraction of memory vs full LTO (the root cause)
#   2 parallel jobs + 4 codegen units — cap peak memory
ENV CARGO_BUILD_JOBS=2
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=4
ENV CARGO_PROFILE_RELEASE_LTO=thin

# Install RISC Zero toolchain
RUN curl -L https://risczero.com/install | bash && \
    /root/.risc0/bin/rzup install

# Copy workspace
WORKDIR /app
COPY zkvm/ ./zkvm/

# Build guest ELF first (RISC-V cross-compilation)
WORKDIR /app/zkvm
RUN cargo build --release -p aip-zkvm-methods

# Build host binary
RUN cargo build --release -p aip-zkvm-host

# Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/zkvm/target/release/aip-prover /usr/local/bin/aip-prover

ENV PORT=8080
EXPOSE 8080

CMD ["aip-prover", "serve", "--port", "8080"]
