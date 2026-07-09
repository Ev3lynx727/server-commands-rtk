#!/bin/bash
set -euo pipefail
# apply-rtk-patch.sh — Patch rtk binary if PR #2903 fix is missing
# Detects whether the fix is present; applies if not.

RTK_SRC="${RTK_SRC:-$HOME/dev-upstream/rtk}"
PATCH_FILE="$(dirname "$0")/rtk+0001-fix-add-is_unsupported_shape-guard.patch"

if ! rtk --version &>/dev/null; then
    echo "rtk not installed — nothing to patch"
    exit 0
fi

# Check if fix is already present
if rtk rewrite 'find .' 2>/dev/null; then
    # exit 0 = rewrote it → old buggy behavior
    :
else
    # exit 1 = passthrough → fix already applied (or find not rewritable)
    EXIT=$?
    if [ $EXIT -eq 1 ]; then
        echo "rtk fix appears to be already applied (exit 1 on find rewrite)"
        exit 0
    fi
fi

if [ -d "$RTK_SRC" ] && [ -f "$RTK_SRC/Cargo.toml" ]; then
    echo "Applying patch to rtk source at $RTK_SRC..."
    cd "$RTK_SRC"
    git am "$PATCH_FILE" 2>/dev/null || git apply "$PATCH_FILE"
    cargo build --release
    cp target/release/rtk "$(which rtk)"
    echo "rtk patched successfully"
else
    echo "rtk source not found at $RTK_SRC — patch manually from $PATCH_FILE"
fi
