import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { nextjsAdapter } from '../src/adapters/nextjs';
import { generateLib } from '../src/generators/lib';
import { generateSchema } from '../src/generators/schema';
import type { FrameworkInfo, Config } from '../src/types';

// Fixture root
const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures/nextjs-app');

// Helper: run adapter detection against fixture
function detectFixture(): FrameworkInfo | null {
  return nextjsAdapter.detect(FIXTURE_ROOT);
}

// ---------------------------------------------------------------------------
// V5: Next.js output regression tests
// ---------------------------------------------------------------------------

describe('Next.js adapter regression (V5)', () => {
  describe('detect', () => {
    it('detects Next.js project via next.config.ts', () => {
      const info = detectFixture();
      expect(info).not.toBeNull();
      expect(info!.name).toBe('nextjs');
      expect(info!.routerType).toBe('app');
    });

    it('sets appDir to src/app for App Router', () => {
      const info = detectFixture();
      expect(info!.appDir).toContain('src/app');
    });

    it('returns null for non-Next.js project', () => {
      const tmpDir = fs.mkdtempSync(os.tmpdir() + '/codex-no-next-');
      const result = nextjsAdapter.detect(tmpDir);
      expect(result).toBeNull();
      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('generateRoutes', () => {
    it('produces routes with correct methods', () => {
      const info = detectFixture()!;
      const output = nextjsAdapter.generateRoutes(info);
      expect(output).not.toBeNull();
      // Should contain GET,POST for posts
      expect(output!).toContain('GET,POST');
      expect(output!).toContain('GET,PUT');
      // Route paths (after group stripping)
      expect(output!).toMatch(/\/api\/users\/:id/);
      expect(output!).toContain('/api/posts');
    });

    it('excludes timestamps from route path (group stripped)', () => {
      const info = detectFixture()!;
      const output = nextjsAdapter.generateRoutes(info);
      expect(output).not.toBeNull();
      // (marketing) group should be stripped from pages, not routes
      expect(output!).not.toContain('(marketing)');
    });
  });

  describe('generatePages', () => {
    it('produces page tree with correct SSR/CSR tags', () => {
      const info = detectFixture()!;
      const output = nextjsAdapter.generatePages(info);
      expect(output).not.toBeNull();
      // Dashboard is 'use client' → [client]
      expect(output!).toContain('[client]');
      expect(output!).toMatch(/Dashboard/);
      // Home and About are server components → [server]
      expect(output!).toContain('[server]');
      expect(output!).toMatch(/Home/);
      expect(output!).toMatch(/About/);
    });

    it('strips (marketing) group from route path', () => {
      const info = detectFixture()!;
      const output = nextjsAdapter.generatePages(info);
      expect(output).not.toBeNull();
      // About page should be at /about, not /(marketing)/about
      expect(output!).toMatch(/\/about\b/);
      expect(output!).not.toContain('(marketing)');
    });

    it('sorts pages by route', () => {
      const info = detectFixture()!;
      const output = nextjsAdapter.generatePages(info);
      expect(output).not.toBeNull();
      const lines = output!.split('\n').filter((l) => l.includes('[server]') || l.includes('[client]'));
      // / should come before /about, /dashboard
      const routes = lines.map((l) => l.match(/\/\S*/)?.[0]).filter(Boolean);
      const sorted = [...routes].sort();
      expect(routes).toEqual(sorted);
    });
  });

  describe('generateComponents', () => {
    it('produces component index with props', () => {
      const info = detectFixture()!;
      const output = nextjsAdapter.generateComponents(info);
      expect(output).not.toBeNull();
      expect(output!).toContain('UserCard');
      expect(output!).toContain('(c)'); // client component
      expect(output!).toContain('name');
      expect(output!).toContain('email');
    });
  });

  describe('generateLib', () => {
    it('produces lib exports for fixture lib dir', () => {
      const info = detectFixture()!;
      // Override libDirs to point at fixture
      const config: Config = {
        output: '.ai-codex',
        include: [],
        exclude: [],
        schema: null,
      };
      info.libDirs = [path.join(FIXTURE_ROOT, 'lib')];
      const output = generateLib(info, config);
      expect(output).not.toBeNull();
      expect(output!).toContain('formatDate');
      expect(output!).toContain('parseInput');
    });
  });

  describe('generateSchema', () => {
    it('returns null when no schema sources', () => {
      const info = detectFixture()!;
      info.schemaSources = [];
      const output = generateSchema(info);
      expect(output).toBeNull();
    });
  });
});
