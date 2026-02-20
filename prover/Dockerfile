# Multi-stage build for the AIP ZK prover service
# Stage 1: Build guest ELF + host binary
# Stage 2: Minimal runtime image

FROM rust:1.85-bookworm AS builder

# Fly remote builder has limited RAM:
#   - LTO off: skip whole-program optimization during linking
#   - mold linker: memory-mapped linking, uses fraction of RAM vs ld
#   - 2 parallel jobs + 4 codegen units: cap peak memory
ENV CARGO_BUILD_JOBS=2
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=4
ENV CARGO_PROFILE_RELEASE_LTO=off

# Install mold (fast, memory-efficient linker) and RISC Zero toolchain
RUN apt-get update && apt-get install -y mold && rm -rf /var/lib/apt/lists/* && \
    curl -L https://risczero.com/install | bash && \
    /root/.risc0/bin/rzup install

# Copy workspace
WORKDIR /app
COPY zkvm/ ./zkvm/

# Build guest ELF first (RISC-V cross-compilation — uses risc0's own linker, not mold)
WORKDIR /app/zkvm
RUN cargo build --release -p aip-zkvm-methods

# Build host binary with mold linker (x86_64 target only)
RUN RUSTFLAGS="-C link-arg=-fuse-ld=mold" cargo build --release -p aip-zkvm-host

# Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/zkvm/target/release/aip-prover /usr/local/bin/aip-prover

ENV PORT=8080
EXPOSE 8080

CMD ["aip-prover", "serve", "--port", "8080"]
