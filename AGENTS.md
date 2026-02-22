# Repository Guidelines

## Project Structure & Module Organization
- `src/`: React + TypeScript frontend.
- `src/App.tsx`: main viewer UI and interaction logic.
- `src/backend.ts`: runtime bridge for Tauri commands and browser fallback behavior.
- `src/manParser.ts` and `src/types.ts`: parsing, search, tokenization, and shared types.
- `src/*.test.ts`: Vitest unit tests colocated with source (for example `src/manParser.test.ts`).
- `src-tauri/`: Rust/Tauri desktop runtime (`src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`).
- `public/`: static assets, and `dist/`: generated web build output.

## Build, Test, and Development Commands
- `pnpm install`: install Node dependencies.
- `pnpm dev`: run Vite dev server (web mode).
- `pnpm tauri dev`: run the desktop app with the Rust backend.
- `pnpm test`: run unit tests once via Vitest.
- `pnpm lint`: run Biome lint/format checks on `src`.
- `pnpm typecheck`: run TypeScript checks with `tsc --noEmit`.
- `pnpm verify`: run lint + typecheck + tests as a single quality gate.
- `pnpm build`: run typecheck, then build the production web bundle.
- `pnpm install-app`: run `verify`, build a no-bundle Tauri release binary, and install it locally.
- `lefthook install`: enable pre-commit hooks (`gitleaks` and lint).

## Reusable Learnings
- `scripts/install-app.sh` supports `INSTALL_DIR`, `INSTALL_NAME`, `CARGO_TARGET_DIR`, and `CARGO_BUILD_TARGET` for local install customization.
- The installer intentionally blocks root installs unless `ALLOW_SYSTEM_INSTALL=1` is set.
- `prepare` uses `git rev-parse --is-inside-work-tree` so hook installation works in both normal clones and git worktrees.

## Coding Style & Naming Conventions
- Use TypeScript for frontend code and Rust for Tauri backend code.
- Follow Biome defaults used in this repo: 2-space indentation, double quotes, and trailing commas.
- Naming: `PascalCase` for components/types, `camelCase` for functions/variables, `UPPER_SNAKE_CASE` for constants.
- Keep pure parsing logic in `manParser.ts`; isolate runtime or I/O concerns in `backend.ts` and Tauri commands.

## Testing Guidelines
- Framework: Vitest.
- Test files should be named `*.test.ts` and live next to the related source.
- Add or update tests whenever parsing/search behavior changes.
- Before pushing: `pnpm lint && pnpm typecheck && pnpm test`.
- For UI/runtime changes, manually smoke test both `pnpm dev` and `pnpm tauri dev`.

## Commit & Pull Request Guidelines
- Follow Conventional Commits. Existing history uses prefixes like `feat:` and `chore:`.
- Keep commits focused and descriptive (example: `feat: improve filter jump behavior`).
- PRs should include:
1. A short behavior summary.
2. Verification steps/commands run.
3. Screenshots or short recordings for visible UI changes.
4. Linked issue/task when applicable.
