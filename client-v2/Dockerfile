# Conditionally copy based on whether the server image has been built before
ARG HAS_SERVER
# Default non-root user
ARG USER
# Base image; the tag matches .nvmrc
ARG IMAGE="node:22.23.4"

################################## Has server ##################################
FROM ${IMAGE} AS server-true

################################### No server ##################################
FROM ${IMAGE} AS server-false

# Set build server URL to the fork's production API
ONBUILD ENV REACT_APP_SERVER_URL="https://playground-server-dot-analytics-324114.de.r.appspot.com"

###################### Build and start development client ######################
FROM server-${HAS_SERVER}

ARG USER

WORKDIR /home/${USER}
COPY . .

# The WASM image has to be built before, which is handled by the compose file
COPY --from=solana-playground-wasm /wasm wasm

# A linked worktree's `.git` names a host path, and every git call below it fails, yarn's included
RUN rm -rf .git

# A full clone at the pinned commit: `update-static.mjs` dates tutorials from its history, at build and at runtime
ENV ASSETS_DIR=/opt/assets
RUN git clone --quiet --no-checkout "$(git config -f .gitmodules submodule.client/public.url)" "$ASSETS_DIR" \
    && git -C "$ASSETS_DIR" checkout --quiet --detach "$(cat client-v2/scripts/assets-commit.txt)"

# Install dependencies
WORKDIR /home/${USER}/client-v2
RUN yarn install --frozen-lockfile

# Bake the assets in, so the container does not need the network to start.
# `yarn start`/`yarn build` re-run this and it is idempotent.
RUN node scripts/update-static.mjs

# pipefail: a failed rustup download must fail here, not later as a missing `rustup`
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Rust is deleted in the same layer: the image stays small, and `yarn start` finds both crate keys current.
RUN export CARGO_HOME=/opt/crates/cargo RUSTUP_HOME=/opt/crates/rustup \
    && toolchain=$(awk '/channel/{gsub(/"/, ""); print $3 }' ../wasm/rust-toolchain.toml) \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --no-modify-path --default-toolchain "$toolchain" --profile minimal \
    && export PATH="$CARGO_HOME/bin:$PATH" \
    && node scripts/generate-default-crates.mjs \
    && node scripts/generate-crates.mjs \
    && rm -rf /opt/crates

# Start client
EXPOSE 3000
CMD ["yarn", "start"]
