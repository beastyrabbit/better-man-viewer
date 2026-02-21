# Better Man Viewer

Desktop-first manpage viewer built with Tauri + React + TypeScript.

## Features

- System manpage loading (`man` + `col -bx`) via Rust Tauri commands.
- Structured left navigation based on section heading detection.
- Two search modes:
  - `Find`: highlight all matches and jump with next/prev.
  - `Filter`: show only matching lines, pick a line, then clear filter and stay anchored there.
- Zoom controls (`Ctrl/Cmd +`, `Ctrl/Cmd -`, `Ctrl/Cmd 0`).
- Right-side minimap visual scrollbar for long pages.
- Native scrollbar fallback for short pages.
- Persisted settings (theme, zoom, minimap, last mode, window size).
- Optional alias helper for replacing `man` after validation.

## Development

```bash
pnpm install
pnpm dev
```

Run as desktop app:

```bash
pnpm tauri dev
```

## Quality Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Hook Setup

This repo uses `lefthook` with required `gitleaks` + lint checks.

```bash
lefthook install
```

## Alias Override (Opt-in)

Use the Alias button in the app or apply manually in shell config:

```bash
man() {
  better-man-viewer "$@"
}
```

Bypass wrapper anytime with:

```bash
command man ls
```

