# Build context: ./server. `server-image` is the stock server/Dockerfile image, given by compose `additional_contexts`
FROM server-image

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

# The stock image keeps no build target, so the cache mounts spare a cold rebuild of the dependencies
# The shared target outlives the checkout and cargo judges freshness by mtime, so the crate fingerprint goes first
RUN --mount=type=cache,target=/home/${USER}/target,uid=1001,gid=1001,sharing=locked \
    --mount=type=cache,target=/home/${USER}/.cargo/registry,uid=1001,gid=1001 \
    rm -rf target/release/.fingerprint/solpg-server-* \
    && cargo build --release --features unstable \
    && install -m 700 target/release/solpg-server solpg-server
