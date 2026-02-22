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

for required_cmd in man col; do
  if ! command -v "$required_cmd" >/dev/null 2>&1; then
    echo "$required_cmd is required at runtime but is not installed."
    exit 1
  fi
done

if [[ "${EUID:-$(id -u)}" -eq 0 && "${ALLOW_SYSTEM_INSTALL:-0}" != "1" ]]; then
  echo "Refusing to run as root by default."
  echo "Set ALLOW_SYSTEM_INSTALL=1 to override intentionally."
  exit 1
fi

echo "Building release binary (no installers)..."
pnpm tauri build --no-bundle

BIN_NAME="$(
  awk -F' *= *' '
    /^\[package\]/ { in_package = 1; next }
    /^\[/ { in_package = 0 }
    in_package && $1 == "name" {
      gsub(/"/, "", $2)
      print $2
      exit
    }
  ' src-tauri/Cargo.toml
)"

if [[ -z "$BIN_NAME" ]]; then
  echo "Unable to resolve binary name from src-tauri/Cargo.toml [package]."
  exit 1
fi

TARGET_ROOT="${CARGO_TARGET_DIR:-$ROOT_DIR/src-tauri/target}"
if [[ "$TARGET_ROOT" != /* ]]; then
  TARGET_ROOT="$ROOT_DIR/$TARGET_ROOT"
fi

TARGET_TRIPLE="${CARGO_BUILD_TARGET:-}"
if [[ -n "$TARGET_TRIPLE" ]]; then
  BIN_PATH="$TARGET_ROOT/$TARGET_TRIPLE/release/$BIN_NAME"
else
  BIN_PATH="$TARGET_ROOT/release/$BIN_NAME"
fi

if [[ ! -f "$BIN_PATH" ]]; then
  shopt -s nullglob
  fallback_paths=("$TARGET_ROOT"/*/release/"$BIN_NAME")
  shopt -u nullglob
  if [[ "${#fallback_paths[@]}" -eq 1 ]]; then
    BIN_PATH="${fallback_paths[0]}"
  fi
fi

if [[ ! -f "$BIN_PATH" ]]; then
  echo "Expected binary not found at: $BIN_PATH"
  if [[ -n "$TARGET_TRIPLE" ]]; then
    echo "Hint: verify CARGO_BUILD_TARGET and CARGO_TARGET_DIR match your build output."
  fi
  exit 1
fi

if [[ -z "${INSTALL_DIR:-}" ]]; then
  if [[ -z "${HOME:-}" ]]; then
    echo "HOME is not set. Set INSTALL_DIR explicitly."
    exit 1
  fi
  INSTALL_DIR="$HOME/.local/bin"
fi

INSTALL_NAME="${INSTALL_NAME:-$BIN_NAME}"
if [[ ! "$INSTALL_NAME" =~ ^[A-Za-z0-9._][A-Za-z0-9._-]*$ ]]; then
  echo "INSTALL_NAME must match ^[A-Za-z0-9._][A-Za-z0-9._-]*\$."
  exit 1
fi
if [[ "$INSTALL_NAME" == "." || "$INSTALL_NAME" == ".." ]]; then
  echo "INSTALL_NAME cannot be '.' or '..'."
  exit 1
fi

mkdir -p "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
TARGET_PATH="$INSTALL_DIR/$INSTALL_NAME"

install -m 755 -- "$BIN_PATH" "$TARGET_PATH"

echo "Installed: $TARGET_PATH"

if command -v timeout >/dev/null 2>&1; then
  if ! timeout 5s "$TARGET_PATH" --help >/dev/null 2>&1; then
    echo "Warning: smoke check failed (command: $TARGET_PATH --help)."
  fi
fi

if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo "Warning: $INSTALL_DIR is not in PATH."
  echo "Add this to your shell profile:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi
