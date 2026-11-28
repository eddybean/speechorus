# D-45 Oxlint and Oxfmt instead of ESLint and Prettier, for TypeScript 7

- **Status**: Accepted (2026-11-27); replaces D-08 and D-44
- **Code**: `.oxlintrc.json`, `.oxfmtrc.json`, `tsconfig*.json`, `package.json`

## Context

typescript-eslint supports only TypeScript `<6.1.0`, and it was the only package that needed the `typescript` package.
Moving to TypeScript 7 (the native compiler) meant replacing ESLint. Earlier, ESLint 9 and the React Hooks plugin had
also had peer conflicts (D-08).

## Decision

- **Oxlint** with the old rule set: the `correctness` category (most of `eslint:recommended`), the typescript-eslint
  `recommended` rules listed by name, `react-hooks/rules-of-hooks` (error) and `exhaustive-deps` (warn), `no-unused-vars`
  with the `^_` patterns, Node globals and `no-undef` for `vite.config.ts` and `scripts/`. The React Compiler rules that
  Oxlint puts in `correctness` (`immutability`, `set-state-in-effect`, `refs`, …) are off. Existing
  `eslint-disable-next-line` comments are honored.
- **Oxfmt** migrated from the Prettier config (`printWidth` 120, `trailingComma: all`, `sortPackageJson: false`,
  Markdown ignored); it formatted the repo exactly as Prettier did. lint-staged passes
  `--no-error-on-unmatched-pattern`, because Oxfmt fails when every file it is given is ignored.
- TypeScript 7 needed `vite/client` in `types` (the side-effect import check reports `import "./styles.css"`
  otherwise).
- Alongside: Vite 8 and `@vitejs/plugin-react` 6 (no esbuild install script any more), Vitest 5, and on the Rust side
  `zip` 9 (2.x had advisories fixed only in 9.x), `sha2` 0.11, `base64` 0.23.

## Alternatives not taken

- Staying on TypeScript 5.9 to keep ESLint: gives up the faster compiler for a linter only.
- Biome: not tried; Oxlint covered the existing rule set including react-hooks.

## Consequences

- typecheck, lint and format checks each take about 1 s.
- Oxfmt is 0.x: a minor update can change the output, so it comes in its own PR and reformats in one commit
  (`dependabot.yml` keeps it separate).
