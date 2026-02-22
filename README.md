# Better Man Viewer

A desktop-first man page reader for Linux, built with **Tauri + React + TypeScript**.
It keeps the speed of `man` while making long docs easier to navigate with sections, search modes, and cleaner reading ergonomics.

## Demo (Real `fzf` Session)

![Better Man Viewer demo](./docs/media/demo-01.gif)

[MP4 demo (higher quality)](./docs/media/demo-01.mp4)

![Better Man Viewer overview](./docs/media/demo-01-overview.png)

## Highlights

- Loads real system man pages through the Rust backend (`man` + `col -bx`).
- Section tree with collapsible hierarchy for pages like `fzf(1)` (`OPTIONS -> SEARCH`, etc.).
- Two search workflows:
  - `Find`: inline highlighting with Enter / Shift+Enter navigation.
  - `Filter`: narrow to matching lines, click to jump, return to full context.
- Adjustable zoom (`Ctrl/Cmd +`, `Ctrl/Cmd -`, `Ctrl/Cmd 0`).
- Wrapped line rendering tuned for terminal-like indentation and option descriptions.
- Persistent settings (theme, zoom, last search mode, window size).

## Quick Start

### Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`
- pnpm
- Rust toolchain (for Tauri desktop runtime)
- Linux environment with `man` and `col`

### Install

```bash
pnpm install
```

### Run (Web Preview)

```bash
pnpm dev
```

Open `http://localhost:1420`.

### Run (Desktop App)

```bash
pnpm tauri dev
```

### Build + Install Binary (Local User)

```bash
pnpm install-app
```

This runs lint/typecheck/tests, builds a release binary, and installs it to
`~/.local/bin/better-man-viewer`.

Optional overrides:
- `INSTALL_DIR=/custom/bin pnpm install-app`
- `INSTALL_NAME=my-man-viewer pnpm install-app`
- `CARGO_TARGET_DIR=/tmp/tauri-target pnpm install-app`

## Developer Commands

```bash
pnpm lint       # Biome checks for src/
pnpm typecheck  # TypeScript validation
pnpm test       # Vitest unit tests
pnpm verify     # lint + typecheck + tests
pnpm build      # Production web build
```

## Hooks & Safety

This repo uses `lefthook` with `gitleaks` and lint checks.

```bash
lefthook install
```

## Optional Shell Alias

If you want to launch this app from `man`, add:

```bash
man() {
  command better-man-viewer "$@" || command man "$@"
}
```

Bypass anytime with:

```bash
command man ls
```
