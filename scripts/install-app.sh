#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but not installed."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust toolchain is required but not installed."
  exit 1
fi

echo "Building release binary (no installers)..."
pnpm tauri build --no-bundle

BIN_NAME="$(awk -F '"' '/^name = "/ {print $2; exit}' src-tauri/Cargo.toml)"
BIN_PATH="$ROOT_DIR/src-tauri/target/release/$BIN_NAME"

if [[ ! -f "$BIN_PATH" ]]; then
  echo "Expected binary not found at: $BIN_PATH"
  exit 1
fi

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
INSTALL_NAME="${INSTALL_NAME:-$BIN_NAME}"
TARGET_PATH="$INSTALL_DIR/$INSTALL_NAME"

mkdir -p "$INSTALL_DIR"
install -m 755 "$BIN_PATH" "$TARGET_PATH"

echo "Installed: $TARGET_PATH"
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo "Warning: $INSTALL_DIR is not in PATH."
  echo "Add this to your shell profile:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi
