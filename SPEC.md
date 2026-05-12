# SPEC.md — ai-codex SvelteKit + CF Workers support

## §G — Goal

Refactor ai-codex into framework-adapter architecture. Extract Next.js logic into adapter. Add SvelteKit adapter + CF Workers runtime awareness. Future frameworks (Astro, Remix) drop in as new adapter files, zero changes to core.

## §C — Constraints

- C1: Zero runtime deps. `tsx` only. No framework-specific packages.
- C2: Node.js fs-based static analysis. No AST parser. Regex + heuristics.
- C3: Existing Next.js + generic behavior ⊥ break. Output identical for existing projects.
- C4: Output format unchanged. Same `.ai-codex/` files, same structure.
- C5: Framework adapter = single file. `src/adapters/<name>.ts`. Implements `FrameworkAdapter` interface.
- C6: Core orchestrator (`src/core.ts`) knows `FrameworkAdapter` interface only. Zero framework-specific imports.
- C7: Shared helpers (`src/helpers.ts`): `walk`, `readFileSafe`, `pad`, `shouldSkipFile`, `pathToRoute`, `findDirsNamed`. Extracted from current monolith.
- C8: `FrameworkInfo` interface extended, not replaced. New field `runtime?: 'node' | 'cloudflare-workers'`.
- C9: SvelteKit file-based routing conventions: `+page.svelte`, `+page.ts`, `+page.server.ts`, `+layout.svelte`, `+layout.ts`, `+layout.server.ts`, `+server.ts`.
- C10: SvelteKit API routes = `+server.ts` with named exports: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, `HEAD`.
- C11: Svelte components use `.svelte` extension. Props via `let` (Svelte 4) or `$props()` (Svelte 5 runes).
- C12: CF Workers: `wrangler.jsonc`/`wrangler.toml` → binding metadata. `cloudflare:workers` imports.
- C13: Drizzle schema detection adds SvelteKit-typical paths: `src/lib/server/db/schema.ts`, `src/lib/server/db/schema/`.
- C14: `svelte.config.js` with `adapter-cloudflare` → `runtime: 'cloudflare-workers'`.
- C15: SvelteKit `+page.ts` exports `load` (universal). `+page.server.ts` exports `load` (server) + `actions`.
- C16: SvelteKit `actions` = named form handlers. `export const actions = { default, name }`.
- C17: CLI entrypoint (`src/generate-codex.ts`) unchanged. `npx ai-codex` still works.
- C18: Each adapter owns its `detect()` + route/page/component extraction. Core owns `lib.md` + `schema.md` generation (framework-agnostic).
- C19: `package.json` `files` array updated to include new src structure.

## §I — Interfaces

### I.cli — CLI (unchanged)

```
npx ai-codex                       → detect framework, generate .ai-codex/
npx ai-codex --output .claude/codex
npx ai-codex --include src/lib
npx ai-codex --exclude tests
npx ai-codex --schema src/lib/server/db/schema.ts
npx ai-codex --quiet                   → silent, for hooks/CI
```

### I.adapter — FrameworkAdapter contract

```ts
// src/types.ts
interface FrameworkAdapter {
  name: string;
  detect(root: string): FrameworkInfo | null;
  generateRoutes(info: FrameworkInfo): string | null;
  generatePages(info: FrameworkInfo): string | null;
  generateComponents(info: FrameworkInfo): string | null;
}
```

### I.info — FrameworkInfo (extended)

```ts
interface FrameworkInfo {
  name: string;
  appDir: string | null;
  routerType: string | null;       // 'app' | 'pages' | 'sveltekit' | future values
  runtime: 'node' | 'cloudflare-workers';
  libDirs: string[];
  componentDirs: string[];
  schemaSources: SchemaSource[];
  skipDirs: Set<string>;
  bindings?: Record<string, string>; // CF: { DB: 'd1', ASSETS_BUCKET: 'r2', ... }
}
```

### I.output — Generated files (unchanged structure, enhanced content)

```
.ai-codex/routes.md    → framework-specific route extraction
.ai-codex/pages.md     → framework-specific page tree
.ai-codex/lib.md       → framework-agnostic (core)
.ai-codex/schema.md    → framework-agnostic (core) + binding metadata comment
.ai-codex/components.md → framework-specific component extraction
```

### I.filetree — New file structure

```
src/
  generate-codex.ts    ← CLI entry (slimmed)
  core.ts              ← orchestrator: detectFramework, main loop, lib/schema generators
  helpers.ts           ← shared: walk, readFileSafe, pad, shouldSkipFile, findDirsNamed
  types.ts             ← FrameworkAdapter, FrameworkInfo, SchemaSource, Config
  adapters/
    nextjs.ts          ← Next.js adapter (extracted from current code)
    sveltekit.ts       ← SvelteKit adapter (new)
  generators/
    lib.ts             ← generateLib (framework-agnostic)
    schema.ts          ← generateSchema + parsePrisma + parseDrizzle (framework-agnostic)
```

## §V — Invariants

- V1: `FrameworkAdapter.detect()` returns `FrameworkInfo | null`. Null = "this project is not mine". First non-null wins. Detection order = adapter registration order.
- V2: Core imports adapters by name. Adding new framework = new file in `adapters/` + one import line in `core.ts`.
- V3: Each adapter fully owns its framework's route path resolution. Core never sees `[param]` vs `:param` conversion — adapter outputs final route strings.
- V4: `generateLib` + `generateSchema` are framework-agnostic. Live in `generators/`. No adapter-specific branching.
- V5: Existing Next.js output byte-identical after refactor (excluding file comment timestamps).
- V6: SvelteKit detection ⊥ false positive when `svelte.config.js` absent. Must check file exists.
- V7: `+server.ts` → API route. `+page.svelte` → page. `+layout.svelte` → layout (excluded from page list). Never conflate.
- V8: SvelteKit route path: `[param]` → `:param`. `[...rest]` → `:*`. `(group)` → stripped.
- V9: Component props: Svelte 5 `$props({ destructured })` → extract names. Svelte 4 `export let` → extract names.
- V10: Drizzle schema detection checks `src/lib/server/db/schema.ts` + `src/lib/server/db/schema/` in addition to existing paths.
- V11: `wrangler.jsonc` parse → extract binding names + types → stored in `FrameworkInfo.bindings`. Emitted as comment in `schema.md` header.
- V12: Page rendering tag: `+page.server.ts` with `load` → `[ssr]`. `+page.ts` with `load` → `[ssr]`. `+page.svelte` only → `[csr]`.
- V13: SvelteKit `actions` detected in `+page.server.ts`. Action names appended to page entry in `pages.md`.
- V14: `generate-codex.ts` remains the CLI entrypoint. Imports `core.ts`. `bin` field in `package.json` unchanged.
- V15: `routerType` field widened from `'app' | 'pages' | null` to `string | null`. Adapters define their own values.
- V16: `runtime` field defaults to `'node'`. SvelteKit adapter sets `'cloudflare-workers'` when `adapter-cloudflare` detected.
- V17: Adapters do NOT import each other. All cross-cutting logic lives in `helpers.ts` or `core.ts`.
- V18: SvelteKit `+server.ts` method detection matches both `export async function <METHOD>` and `export const <METHOD>: RequestHandler = async`. Regex must cover both function-declaration and const-arrow export forms (C10).
- V19: `--quiet` / `-q` flag suppresses all console.log output. console.error + console.warn always visible. Errors still exit non-zero. For hooks/CI use.

## §T — Tasks

| id | status | task | cites |
|----|--------|------|-------|
| T1 | x | create `src/types.ts`: extract + extend `FrameworkAdapter`, `FrameworkInfo`, `SchemaSource`, `Config` interfaces | I.adapter,I.info,C18 |
| T2 | x | create `src/helpers.ts`: extract `walk`, `readFileSafe`, `pad`, `shouldSkipFile`, `findDirsNamed`, `DEFAULT_SKIP_DIRS`, `ROOT`, `TODAY` | C7 |
| T3 | x | create `src/generators/schema.ts`: extract `parsePrismaSchema`, `parseDrizzleSchema`, `generateSchema` + add `src/lib/server/db/` paths + `wrangler.jsonc` binding comment | V4,V10,V11,I.output |
| T4 | x | create `src/generators/lib.ts`: extract `generateLib` | V4 |
| T5 | x | create `src/adapters/nextjs.ts`: extract Next.js detection + `generateRoutes` + `generatePages` + `generateComponents` for Next.js | V5,I.filetree |
| T6 | x | create `src/core.ts`: orchestrator — `detectFramework` loops adapters, main generation loop, CLI output formatting | V1,V2,I.adapter |
| T7 | x | slim `src/generate-codex.ts`: CLI entry only — parse args, import core, call main | V14,C17 |
| T8 | x | verify Next.js output byte-identical (excluding timestamps) after refactor | V5 |
| T9 | x | create `src/adapters/sveltekit.ts`: `detect` via `svelte.config.js`, route resolution (`+server.ts`, `[param]`, `(group)`), page tree (`+page.svelte`, SSR/CSR, actions), component props (`$props()`, `export let`), runtime detection | V6-V9,V12,V13,V15,V16,C9-C16 |
| T10 | x | add `wrangler.jsonc`/`wrangler.toml` parser to sveltekit adapter: extract bindings, set `runtime: 'cloudflare-workers'` | V11,V16,C12,C14 |
| T11 | x | add tests: SvelteKit fixture project, verify routes/pages/lib/components/schema output, verify Next.js unchanged | V5 |
| T12 | x | update `package.json` `files` array + keywords for new structure (README deferred to main dev) | C19,I.cli |

## §B — Bugs

| id | date | cause | fix |
|----|------|-------|-----|

| B1 | 2026-04-27 | METHOD_REGEX only matched `export function GET`. Missed `export const GET: RequestHandler = async` (const-arrow form). All r3stro server routes use const exports → routes.md skipped entirely. | V18 |