#!/bin/bash
# SPDX-License-Identifier: PMPL-1.0-or-later
# Convenience wrapper for desktop integration.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "$SCRIPT_DIR/launcher.sh" --install
