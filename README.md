# ai-codex

[![Built by Claude Code](https://img.shields.io/badge/Built%20by-Claude%20Code-blueviolet?logo=anthropic)](https://claude.ai/code)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue.svg)](https://www.typescriptlang.org/)

> **This project was entirely designed, written, and published by [Claude Code](https://claude.ai/code) (Anthropic's AI coding assistant).** The concept, implementation, documentation, and examples were all generated in a single conversation session.

Generate a compact codebase index that gives AI coding assistants instant context about your project structure. Instead of wasting 50K+ tokens on file exploration at the start of every conversation, your AI assistant reads a pre-built index and gets to work immediately.

## Why

Every time you start a conversation with an AI coding assistant (Claude Code, Cursor, GitHub Copilot, etc.), it spends thousands of tokens exploring your codebase -- reading files, scanning directories, building a mental model. This happens **every single conversation**.

`ai-codex` solves this by generating compact, structured reference files that capture:
- Every API route with its HTTP methods
- Every page with its rendering strategy (client vs. server)
- Every library function signature
- Your database schema (key fields, relationships)
- Your component tree with props

The result: **5 small files** that replace 50K+ tokens of exploration, every time.

## Quick Start

Run it in your project root:

```bash
npx ai-codex
```

That's it. It auto-detects your framework and generates the index.

## Output

By default, files are written to `.ai-codex/` in your project root:

| File | What it contains |
|------|-----------------|
| `routes.md` | API routes grouped by resource, with HTTP methods |
| `pages.md` | Page tree with client/server rendering tags |
| `lib.md` | Library exports -- function signatures, classes |
| `schema.md` | Database schema -- key fields, FKs, relationships |
| `components.md` | Component index with props, grouped by feature |

Files that don't apply are skipped (e.g., no `schema.md` if you don't use Prisma).

## Configuration

### CLI Flags

```bash
npx ai-codex --output .claude/codex     # custom output directory
npx ai-codex --include src lib           # only scan these directories
npx ai-codex --exclude tests __mocks__   # skip these directories
npx ai-codex --schema prisma/schema.prisma  # explicit schema path
```

### Config File

Create a `codex.config.json` in your project root:

```json
{
  "output": ".ai-codex",
  "include": ["src", "lib", "app"],
  "exclude": ["tests", "__mocks__"],
  "schema": "prisma/schema.prisma"
}
```

CLI flags override config file values.

## Output Format Examples

### routes.md
```
## products
GET,POST     /api/products [auth,db]
GET,PUT,DELETE /api/products/:id [auth,db]
POST         /api/products/:id/images [auth]

## orders
GET,POST     /api/orders [auth,db]
GET          /api/orders/:id [auth,db]
POST         /api/orders/:id/refund [auth,db]
```

### pages.md
```
[client]   /                                                  HomePage
[server]   /products                                          ProductsPage
[client]   /products/:id                                      ProductDetailPage
[server]   /cart                                               CartPage
[client]   /checkout                                           CheckoutPage
```

### lib.md
```
## lib
cart-utils.ts
  fn calculateTotal
  fn applyDiscount
  fn formatPrice
auth.ts  fn validateSession
stripe.ts  fn createPaymentIntent
```

### schema.md
```
## Product
  id                     String    PK
  categoryId             String
  -> Category, OrderItem[], Review[]

**Order** id(PK) | userId | status -> User, OrderItem[]
**User** id(PK) | email(UQ) -> Order[], Review[]
```

### components.md
```
## components
(c) CartDrawer  items, onRemove, onCheckout
(c) ProductCard  product, onAddToCart
    PriceDisplay  amount, currency
(c) SearchBar  onSearch, placeholder
```

## Monorepo Support (pnpm)

If you run `ai-codex` from a pnpm monorepo root (where `pnpm-workspace.yaml` exists), it automatically:

1. Discovers all workspace packages
2. Indexes each package independently
3. Outputs per-package subdirectories
4. Generates a `workspace.md` overview with the internal dependency graph

```bash
# From your monorepo root
npx ai-codex
```

Output structure:

```
.ai-codex/
  workspace.md              # package list + internal dependency graph
  apps/web/
    routes.md
    pages.md
    lib.md
    components.md
  packages/shared/
    lib.md
    schema.md
```

### workspace.md example

```
# Workspace (generated 2026-04-02)
# 3 packages in monorepo.

## Packages
apps/web                       @acme/web                      nextjs     routes,pages,lib,components
packages/ui                    @acme/ui                       generic    components,lib
packages/shared                @acme/shared                   generic    lib,schema

## Internal Dependencies
@acme/web -> @acme/ui, @acme/shared
@acme/ui -> @acme/shared
```

To index a single package instead, just `cd` into it and run `npx ai-codex` from there.

## Integration with AI Assistants

### Claude Code

Add this to your `CLAUDE.md`:

```markdown
## Codebase Index
Pre-built index files are in `.ai-codex/`. Read these FIRST before exploring the codebase:
- `.ai-codex/routes.md` -- all API routes
- `.ai-codex/pages.md` -- page tree
- `.ai-codex/lib.md` -- library exports
- `.ai-codex/schema.md` -- database schema
- `.ai-codex/components.md` -- component tree
```

### Cursor / Other AI IDEs

Add the `.ai-codex/` directory to your AI assistant's context or rules file. Most AI coding tools support a way to include reference files.

## Auto-Refresh

### Git Pre-Commit Hook

```bash
# .git/hooks/pre-commit
npx ai-codex
git add .ai-codex/
```

### npm Script

```json
{
  "scripts": {
    "codex": "npx ai-codex",
    "precommit": "npx ai-codex && git add .ai-codex/"
  }
}
```

### CI/CD

```yaml
# GitHub Actions example
- name: Update codebase index
  run: npx ai-codex
- name: Commit index
  run: |
    git add .ai-codex/
    git diff --cached --quiet || git commit -m "chore: update codebase index"
```

## Supported Frameworks

| Framework | Auto-detected | What it scans |
|-----------|:------------:|---------------|
| **Next.js (App Router)** | Yes | `app/api/**/route.ts`, `app/**/page.tsx`, `lib/`, `components/` |
| **Next.js (Pages Router)** | Yes | `pages/api/**`, `pages/**`, `lib/`, `components/` |
| **Generic TypeScript** | Yes | `src/`, `lib/`, `utils/`, `components/` |

Prisma schema is auto-detected at `prisma/schema.prisma`.

## What Gets Skipped

- `node_modules/`, `.next/`, `dist/`, `build/`, `.git/`
- `.d.ts` declaration files, `.map` source maps, `.min.js` minified files
- Backup files (`*.backup.*`, `*-backup-*`)
- shadcn/radix UI primitives (button, dialog, etc.) in `components/ui/`

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes
4. Test on a real project: `cd /path/to/your/project && npx tsx /path/to/ai-codex/src/generate-codex.ts`
5. Submit a pull request

### Ideas for Contributions

- Support for more frameworks (SvelteKit, Remix, Astro)
- Support for more ORMs (Drizzle, TypeORM, Knex)
- Support for yarn/npm workspaces
- Watch mode (`--watch`) for continuous regeneration
- Token count estimation in output
- Support for Python projects (FastAPI, Django)

## License

MIT
