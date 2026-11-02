#!/usr/bin/env bash
# Install the Cloud SQL Auth Proxy on a Linux x86-64 runner, at a pinned
# version checked against the SHA-256 Google publishes in the release notes.
# A version bump changes both lines below.
set -euo pipefail

VERSION=v2.27.0
SHA256=39ed2abcaa073c3b4714585e36a904e2b1d92218c5e07c18224fb73ef4bedde5

bin=/usr/local/bin/cloud-sql-proxy
curl -fsSL -o "$bin" \
  "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/$VERSION/cloud-sql-proxy.linux.amd64"
echo "$SHA256  $bin" | sha256sum -c --quiet
chmod +x "$bin"
command -v psql >/dev/null || { echo "::error::psql is not on the runner"; exit 1; }
