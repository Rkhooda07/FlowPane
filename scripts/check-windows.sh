#!/usr/bin/env bash
set -e

if ! rustup target list --installed | grep -q "x86_64-pc-windows-msvc"; then
  echo "Adding x86_64-pc-windows-msvc target..."
  rustup target add x86_64-pc-windows-msvc
fi

if ! cargo xwin --version &>/dev/null; then
  echo "cargo-xwin not found. Install it with:"
  echo "  cargo install cargo-xwin"
  exit 1
fi

echo "Checking Windows target (x86_64-pc-windows-msvc)..."
cargo xwin check --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
echo "Done — no errors."
