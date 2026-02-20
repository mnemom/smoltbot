# Multi-stage build for the AIP ZK prover service
# Stage 1: Build the guest ELF (RISC-V target)
# Stage 2: Build the host binary
# Stage 3: Minimal runtime image

FROM rust:1.82-bookworm AS builder

# Limit parallel codegen units and link jobs to prevent OOM on constrained builders
ENV CARGO_BUILD_JOBS=2
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=4

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

# Stage 3: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/zkvm/target/release/aip-prover /usr/local/bin/aip-prover

ENV PORT=8080
EXPOSE 8080

CMD ["aip-prover", "serve", "--port", "8080"]
