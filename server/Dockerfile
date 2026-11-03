# Default non-root user
ARG USER=solpg

################# BASE RUST INSTALLATION TO USE IN OTHER STEPS #################
FROM ubuntu:24.04 AS rust

ARG USER=solpg
ARG DEBIAN_FRONTEND="noninteractive"

# Install build deps
RUN apt-get update -qq && apt-get upgrade -qq && apt-get install -qq \
    build-essential curl pkg-config libssl-dev libudev-dev

# Create a non-root user
RUN useradd -m -u 1001 -s /bin/bash ${USER}
USER ${USER}
ENV HOME="/home/${USER}"

# Install Rust
RUN sh -c "$(curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs)" -- -y
ENV PATH="${HOME}/.cargo/bin:${PATH}"

############################## BUILD SERVER BINARY #############################
FROM rust AS build

ARG USER=solpg
ARG FEATURES=""

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
RUN cargo build --release

# Actual build
COPY src src
# It doesn't rebuild without removing the crate fingerprint for some reason
RUN rm -rf target/release/.fingerprint/solpg-server-*
RUN cargo build --release --features "${FEATURES}"

################################# START SERVER #################################
FROM rust AS server

ARG USER=solpg
ARG SOLANA_VERSION="1.17.34"

# Install Solana
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v${SOLANA_VERSION}/install)"
ENV PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"

# Set the workdir
WORKDIR /home/${USER}

# Copy programs dir and build the default program
COPY --chown=${USER}:${USER} programs programs
# Cloud Build's legacy builder strips the owner write bit from context files; the server rewrites programs/<id>/Cargo.toml at runtime
RUN chmod -R u+w programs
RUN cargo-build-sbf --manifest-path programs/Cargo.toml

# Start server
COPY --from=build /build/target/release/solpg-server .
# Restrict the server binary to its owner so a future unprivileged builder
# user (e.g. for sandboxed cargo-build-sbf) cannot read it.
RUN chmod 700 solpg-server
EXPOSE 8080
CMD ["./solpg-server"]

############################ UNSTABLE SERVER (OPT-IN) ##########################
FROM server AS unstable

ARG USER=solpg
ARG DOCKER_VERSION="29.8.2"
ARG DOCKER_SHA256="995d1ef289677f74fd58d8d2c35727b6a4ee389c69db8638a3e42d0487aa5b0f"
ARG BUILDX_VERSION="0.37.2"
ARG BUILDX_SHA256="982ca20490b45ed1ec8d99795974d3d874a358f75938c9c237305010e6b7e548"

# The sandbox runs `docker exec` with a cleared env, whose default search path has /usr/bin
USER root
RUN curl -sSfL -o /tmp/docker.tgz "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" \
    && echo "${DOCKER_SHA256}  /tmp/docker.tgz" | sha256sum -c - \
    && tar -xzf /tmp/docker.tgz -C /usr/bin --strip-components=1 docker/docker \
    && rm /tmp/docker.tgz
RUN mkdir -p /usr/libexec/docker/cli-plugins \
    && curl -sSfL -o /usr/libexec/docker/cli-plugins/docker-buildx "https://github.com/docker/buildx/releases/download/v${BUILDX_VERSION}/buildx-v${BUILDX_VERSION}.linux-amd64" \
    && echo "${BUILDX_SHA256}  /usr/libexec/docker/cli-plugins/docker-buildx" | sha256sum -c - \
    && chmod 755 /usr/libexec/docker/cli-plugins/docker-buildx
USER ${USER}

# Start-up runs `docker build` on images/Dockerfile.* with this directory as the context
COPY --chown=${USER}:${USER} .dockerignore Cargo.* rust-toolchain.toml ./
COPY --chown=${USER}:${USER} images images
COPY --chown=${USER}:${USER} packages packages
COPY --chown=${USER}:${USER} src src
COPY --chown=${USER}:${USER} templates templates

################################ DEFAULT TARGET ################################
# Last so that a build without `--target` produces the `server` stage
FROM server
