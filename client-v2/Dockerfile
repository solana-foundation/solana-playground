# Conditionally copy based on whether the server image has been built before
ARG HAS_SERVER
# Default non-root user
ARG USER
# Base image: the newest Node 22 patch; .nvmrc pins the exact version for local and CI runs
ARG IMAGE="node:22"

################################## Has server ##################################
FROM ${IMAGE} AS server-true

################################### No server ##################################
FROM ${IMAGE} AS server-false

###################### Build and start development client ######################
FROM server-${HAS_SERVER}

ARG USER
# The build server's URL comes from the build, never from this file; empty means a local server
ARG REACT_APP_SERVER_URL=""
ENV REACT_APP_SERVER_URL=${REACT_APP_SERVER_URL}

WORKDIR /home/${USER}
COPY . .

# The WASM image has to be built before, which is handled by the compose file
COPY --from=solana-playground-wasm /wasm wasm

# A linked worktree's `.git` names a host path, and every git call below it fails, yarn's included
RUN rm -rf .git

# Install dependencies
WORKDIR /home/${USER}/client-v2
RUN yarn install --frozen-lockfile

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
