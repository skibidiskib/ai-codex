import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sveltekitAdapter } from '../src/adapters/sveltekit';
import { nextjsAdapter } from '../src/adapters/nextjs';
import { generateLib } from '../src/generators/lib';
import { generateSchema } from '../src/generators/schema';
import type { FrameworkInfo, Config } from '../src/types';

// Fixture root
const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures/sveltekit-app');

function detectFixture(): FrameworkInfo | null {
  return sveltekitAdapter.detect(FIXTURE_ROOT);
}

// ---------------------------------------------------------------------------
// V6: Detection ⊥ false positive when svelte.config.js absent
// ---------------------------------------------------------------------------

describe('SvelteKit adapter: detect (V6, V15, V16)', () => {
  it('detects SvelteKit via svelte.config.js', () => {
    const info = detectFixture();
    expect(info).not.toBeNull();
    expect(info!.name).toBe('sveltekit');
  });

  it('returns null when svelte.config.js absent (V6)', () => {
    const tmpDir = fs.mkdtempSync(os.tmpdir() + '/codex-no-svelte-');
    const result = sveltekitAdapter.detect(tmpDir);
    expect(result).toBeNull();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('sets routerType to sveltekit (V15)', () => {
    const info = detectFixture();
    expect(info!.routerType).toBe('sveltekit');
  });

  it('detects src/routes as appDir', () => {
    const info = detectFixture();
    expect(info!.appDir).toContain('src/routes');
  });

  it('sets runtime to cloudflare-workers when adapter-cloudflare present (V16, C14)', () => {
    const info = detectFixture();
    expect(info!.runtime).toBe('cloudflare-workers');
  });

  it('sets runtime to cloudflare-workers when wrangler.jsonc present (V16)', () => {
    const info = detectFixture();
    expect(info!.runtime).toBe('cloudflare-workers');
  });

  it('parses wrangler bindings (V11)', () => {
    const info = detectFixture();
    expect(info!.bindings).toBeDefined();
    expect(info!.bindings!.DB).toBe('d1');
    expect(info!.bindings!.ASSETS).toBe('r2');
  });

  it('detects src/lib as lib dir', () => {
    const info = detectFixture();
    expect(info!.libDirs.some((d) => d.includes('src/lib'))).toBe(true);
  });

  it('detects src/lib/components as component dir', () => {
    const info = detectFixture();
    expect(info!.componentDirs.some((d) => d.includes('src/lib/components'))).toBe(true);
  });

  it('defaults runtime to node when no cloudflare adapter or wrangler', () => {
    const tmpDir = fs.mkdtempSync(os.tmpdir() + '/codex-svelte-node-');
    fs.writeFileSync(path.join(tmpDir, 'svelte.config.js'), "import adapter from '@sveltejs/adapter-auto';");
    fs.mkdirSync(path.join(tmpDir, 'src/routes'), { recursive: true });
    const info = sveltekitAdapter.detect(tmpDir);
    expect(info).not.toBeNull();
    expect(info!.runtime).toBe('node');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// V7, V8: generateRoutes
// ---------------------------------------------------------------------------

describe('SvelteKit adapter: generateRoutes (V7, V8, C10)', () => {
  it('produces routes from +server.ts files (V7)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generateRoutes(info!);
    expect(output).not.toBeNull();
    expect(output!).toContain('GET,PUT');
    expect(output!).toContain('GET,POST');
  });

  it('converts [param] to :param (V8)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generateRoutes(info!);
    expect(output).not.toBeNull();
    expect(output!).toMatch(/\/api\/users\/:id/);
  });

  it('does not include +page.svelte as routes (V7)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generateRoutes(info!);
    // Should not have any mention of page files
    if (output) {
      expect(output).not.toContain('+page');
      expect(output).not.toContain('+layout');
    }
  });

  it('does not include +layout.svelte as route (V7)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generateRoutes(info!);
    if (output) {
      expect(output).not.toContain('+layout');
    }
  });

  it('detects const-export server routes (export const GET: RequestHandler = async ...) (C10)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generateRoutes(info!);
    expect(output).not.toBeNull();
    // api/items uses const-export style
    expect(output!).toMatch(/GET,POST,DELETE.*\/api\/items/);
  });
});
// ---------------------------------------------------------------------------
// V7, V12, V13: generatePages
// ---------------------------------------------------------------------------

describe('SvelteKit adapter: generatePages (V7, V12, V13, C15)', () => {
  it('includes +page.svelte files (V7)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generatePages(info!);
    expect(output).not.toBeNull();
    // Should have 3 pages: /, /about, /dashboard
    const pageLines = output!.split('\n').filter((l) => /^\[(ssr|csr)\]/.test(l.trim()));
    expect(pageLines.length).toBe(3);
  });

  it('excludes +layout.svelte from pages (V7)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generatePages(info!);
    expect(output).not.toBeNull();
    // Should not have 4 pages (layout should be excluded)
    const pageLines = output!.split('\n').filter((l) => /^\[(ssr|csr)\]/.test(l.trim()));
    expect(pageLines.length).toBe(3);
  });

  it('tags +page.svelte-only pages as [csr] (V12)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generatePages(info!);
    // Root page has no load → [csr]
    expect(output!).toMatch(/\[csr\].*\//);
  });

  it('tags pages with +page.ts load as [ssr] (V12)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generatePages(info!);
    // Dashboard has +page.ts with load → [ssr]
    expect(output!).toMatch(/\[ssr\].*dashboard/);
  });

  it('tags pages with +page.server.ts load as [ssr] (V12)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generatePages(info!);
    // About has +page.server.ts with load → [ssr]
    expect(output!).toMatch(/\[ssr\].*about/);
  });

  it('strips (group) from route path (V8)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generatePages(info!);
    expect(output).not.toBeNull();
    expect(output!).toMatch(/\/about/);
    expect(output!).not.toContain('(marketing)');
  });

  it('detects actions in +page.server.ts (V13, C16)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generatePages(info!);
    // About page has actions: default, contact
    const aboutLine = output!.split('\n').find((l) => l.includes('about'));
    expect(aboutLine).toBeDefined();
    expect(aboutLine!).toContain('actions:default,contact');
  });
});

// ---------------------------------------------------------------------------
// V9: generateComponents
// ---------------------------------------------------------------------------

describe('SvelteKit adapter: generateComponents (V9, C11)', () => {
  it('finds .svelte components', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generateComponents(info!);
    expect(output).not.toBeNull();
    expect(output!).toContain('Card');
    expect(output!).toContain('UserProfile');
  });

  it('extracts Svelte 5 $props() destructured names (V9)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generateComponents(info!);
    // Card uses $props: title, subtitle, count
    expect(output!).toContain('title');
    expect(output!).toContain('subtitle');
  });

  it('extracts Svelte 4 export let names (V9)', () => {
    const info = detectFixture();
    const output = sveltekitAdapter.generateComponents(info!);
    // UserProfile uses export let: name, email, role
    expect(output!).toContain('name');
    expect(output!).toContain('email');
  });
});

// ---------------------------------------------------------------------------
// Integration: generateLib + generateSchema with SvelteKit fixture
// ---------------------------------------------------------------------------

describe('SvelteKit integration: lib + schema generators', () => {
  it('generateLib finds lib exports in src/lib', () => {
    const info = detectFixture()!;
    const config: Config = {
      output: '.ai-codex',
      include: [],
      exclude: [],
      schema: null,
    };
    const output = generateLib(info, config);
    expect(output).not.toBeNull();
    expect(output!).toContain('formatDate');
    expect(output!).toContain('parseInput');
  });

  it('generateSchema finds drizzle schema when schemaSources populated (V10)', () => {
    const info = detectFixture()!;
    // Adapter doesn't populate schemaSources — core does via enrichSchemaSources.
    // Manually add the fixture's drizzle schema to test generateSchema directly.
    const schemaPath = path.join(FIXTURE_ROOT, 'src/lib/server/db/schema.ts');
    info.schemaSources = [{ kind: 'drizzle', path: schemaPath }];
    const output = generateSchema(info);
    expect(output).not.toBeNull();
    expect(output!).toContain('users');
    expect(output!).toContain('id');
    expect(output!).toContain('email');
  });

  it('generateSchema includes bindings from wrangler (V11)', () => {
    const info = detectFixture()!;
    const schemaPath = path.join(FIXTURE_ROOT, 'src/lib/server/db/schema.ts');
    info.schemaSources = [{ kind: 'drizzle', path: schemaPath }];
    const output = generateSchema(info);
    expect(output).not.toBeNull();
    expect(output!).toContain('Bindings:');
    expect(output!).toContain('DB:d1');
    expect(output!).toContain('ASSETS:r2');
  });
});

// ---------------------------------------------------------------------------
// V5: Next.js tests still pass (no regression)
// ---------------------------------------------------------------------------

describe('Next.js unchanged after SvelteKit addition (V5)', () => {
  it('Next.js adapter still detects Next.js projects', () => {
    const nextjsRoot = path.resolve(__dirname, 'fixtures/nextjs-app');
    const info = nextjsAdapter.detect(nextjsRoot);
    expect(info).not.toBeNull();
    expect(info!.name).toBe('nextjs');
  });
});