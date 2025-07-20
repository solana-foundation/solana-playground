FROM ubuntu:24.04 AS base
RUN apt-get update -qq && apt-get install -qq build-essential curl pkg-config libssl-dev libudev-dev
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN curl -sSfL https://release.anza.xyz/v1.17.25/install | sh
ENV PATH="/root/.local/share/solana/install/active_release/bin:${PATH}"

FROM base AS build
WORKDIR /build
COPY Cargo.* ./
COPY src src
COPY migrations migrations
RUN cargo build --release

FROM base
WORKDIR /home/pg
COPY programs programs
RUN cargo-build-sbf --manifest-path programs/Cargo.toml
COPY --from=build /build/target/release/solpg-server .
EXPOSE 8080
CMD ["./solpg-server"]