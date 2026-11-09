#!/usr/bin/env bash
# Copies the page under review into the empty eval workspace (the repo is not there).
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../../../.." && pwd)"
mkdir -p docs
cp "$repo/docs/how-deflate-works.html" docs/
