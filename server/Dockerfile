# Default non-root user
ARG USER=solpg

################# BASE RUST INSTALLATION TO USE IN OTHER STEPS #################
FROM ubuntu:24.04 AS rust

ARG USER=solpg
ARG DEBIAN_FRONTEND="noninteractive"

# Install build deps
RUN apt-get update -qq && apt-get upgrade -qq && apt-get install -qq \
    build-essential bzip2 curl pkg-config libssl-dev libudev-dev

# Create a non-root user
RUN useradd -m -u 1001 -s /bin/bash ${USER}
USER ${USER}
ENV HOME="/home/${USER}"

# The three tools this image fetches by URL (rustup-init, the Agave release,
# the platform tools) are pinned to a version and checked against a SHA-256
# before use; a mismatch fails the build. To bump one, change its version and
# take the new checksum from the publisher (rustup publishes rustup-init.sha256
# next to the binary; GitHub lists each release asset's sha256 digest). Not
# covered here: the apt packages and the toolchains rustup installs, which
# their own tools verify against their indexes. The image is x86_64 only:
# Agave publishes no other Linux build.
ARG RUSTUP_VERSION="1.29.3"
ARG RUSTUP_SHA256="b1c8cb14e30889e7e2999e6b69e62d9e9b9ffc0f4df8180564d306d9680e6c55"

# Install Rust
RUN test "$(uname -m)" = x86_64 || { echo "server image is x86_64 only, got $(uname -m)" >&2; exit 1; }
RUN curl --proto '=https' --tlsv1.2 -sSfLo /tmp/rustup-init \
      "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
    && echo "${RUSTUP_SHA256}  /tmp/rustup-init" | sha256sum -c - \
    && chmod +x /tmp/rustup-init \
    && /tmp/rustup-init -y \
    && rm /tmp/rustup-init
ENV PATH="${HOME}/.cargo/bin:${PATH}"

############################## BUILD SERVER BINARY #############################
FROM rust AS build

ARG USER=solpg

# Cloud Build's legacy builder creates WORKDIR as root even under USER
USER root
RUN mkdir /build && chown ${USER}:${USER} /build
USER ${USER}
WORKDIR /build

# Cache toolchain
COPY rust-toolchain.toml .
RUN cargo --version

# Cache deps
# Trailing slash required: Cloud Build's legacy builder rejects multi-source COPY into "."
COPY Cargo.* ./
RUN mkdir src
RUN echo "fn main() {}" > src/main.rs
RUN cargo build --release --locked

# Actual build
COPY src src
# It doesn't rebuild without removing the crate fingerprint for some reason
RUN rm -rf target/release/.fingerprint/solpg-server-*
RUN cargo build --release --locked

########################## SOLANA AND PLATFORM TOOLS ##########################
FROM rust AS tools

ARG USER=solpg
ARG SOLANA_VERSION="3.1.10"
ARG SOLANA_SHA256="a7205ff29bcf0f7199740225ecae2b85a28ea9668892d5ec21bd9749882984a1"
# The platform tools cargo-build-sbf would otherwise download unchecked on its
# first run. The version must be the default of that Solana version's
# cargo-build-sbf: bump the two together. The final stage fails the build if
# cargo-build-sbf fetched any other version.
ARG PLATFORM_TOOLS_VERSION="v1.52"
ARG PLATFORM_TOOLS_SHA256="8b3861e93daf085ec12b65c4fac374d9bec4587a3de16871da6b08ab0c1d907e"

# Install Solana, in the layout of Agave's installer
RUN curl --proto '=https' --tlsv1.2 -sSfLo /tmp/solana-release.tar.bz2 \
      "https://github.com/anza-xyz/agave/releases/download/v${SOLANA_VERSION}/solana-release-x86_64-unknown-linux-gnu.tar.bz2" \
    && echo "${SOLANA_SHA256}  /tmp/solana-release.tar.bz2" | sha256sum -c - \
    && mkdir -p "${HOME}/.local/share/solana/install/releases/${SOLANA_VERSION}" \
    && tar -xjf /tmp/solana-release.tar.bz2 -C "${HOME}/.local/share/solana/install/releases/${SOLANA_VERSION}" \
    && ln -s "${HOME}/.local/share/solana/install/releases/${SOLANA_VERSION}/solana-release" \
      "${HOME}/.local/share/solana/install/active_release" \
    && rm /tmp/solana-release.tar.bz2
ENV PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

# Install the platform tools where cargo-build-sbf looks before downloading
RUN curl --proto '=https' --tlsv1.2 -sSfLo /tmp/platform-tools.tar.bz2 \
      "https://github.com/anza-xyz/platform-tools/releases/download/${PLATFORM_TOOLS_VERSION}/platform-tools-linux-x86_64.tar.bz2" \
    && echo "${PLATFORM_TOOLS_SHA256}  /tmp/platform-tools.tar.bz2" | sha256sum -c - \
    && mkdir -p "${HOME}/.cache/solana/${PLATFORM_TOOLS_VERSION}/platform-tools" \
    && tar -xjf /tmp/platform-tools.tar.bz2 -C "${HOME}/.cache/solana/${PLATFORM_TOOLS_VERSION}/platform-tools" \
    && rm /tmp/platform-tools.tar.bz2
ENV PLATFORM_TOOLS_VERSION="${PLATFORM_TOOLS_VERSION}"

################################# START SERVER #################################
FROM tools

ARG USER=solpg

# Set the workdir
WORKDIR /home/${USER}

# Copy programs dir and build the default program
COPY --chown=${USER}:${USER} programs programs
# Cloud Build's legacy builder strips the owner write bit from context files; the server rewrites programs/<id>/Cargo.toml at runtime
RUN chmod -R u+w programs
RUN cargo-build-sbf --manifest-path programs/Cargo.toml -- --locked
RUN test "$(ls "${HOME}/.cache/solana")" = "${PLATFORM_TOOLS_VERSION}" \
    || { echo "cargo-build-sbf fetched platform tools other than the pinned ${PLATFORM_TOOLS_VERSION}" >&2; exit 1; }

# Start server
COPY --from=build /build/target/release/solpg-server .
# Restrict the server binary to its owner so a future unprivileged builder
# user (e.g. for sandboxed cargo-build-sbf) cannot read it.
RUN chmod 700 solpg-server
EXPOSE 8080
CMD ["./solpg-server"]
