import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import {
  parsePrismaSchema,
  parseDrizzleSchema,
  parseWranglerBindings,
  generateSchema,
} from './schema';
import type { FrameworkInfo } from '../types';

// ---------------------------------------------------------------------------
// parsePrismaSchema
// ---------------------------------------------------------------------------

describe('parsePrismaSchema', () => {
  it('parses a simple model with PK and UQ fields', () => {
    const content = `
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  posts     Post[]
}
`;
    const models = parsePrismaSchema(content);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('User');
    // id (PK), email (UQ) — createdAt skipped (audit field, not PK/UQ)
    const names = models[0].fields.map((f) => f.name);
    expect(names).toContain('id');
    expect(names).toContain('email');
    expect(names).not.toContain('createdAt');
    expect(models[0].relations).toHaveLength(1);
    expect(models[0].relations[0].target).toBe('Post');
  });

  it('parses FK-like fields (ends in Id)', () => {
    const content = `
model Post {
  id       Int    @id
  userId   Int
  authorId Int
}
`;
    const models = parsePrismaSchema(content);
    const names = models[0].fields.map((f) => f.name);
    expect(names).toContain('id');
    expect(names).toContain('userId');
    expect(names).toContain('authorId');
  });

  it('skips audit fields that are not PK/UQ', () => {
    const content = `
model Foo {
  id        Int      @id
  updatedAt DateTime @updatedAt
}
`;
    const models = parsePrismaSchema(content);
    const names = models[0].fields.map((f) => f.name);
    expect(names).toEqual(['id']);
  });
});

// ---------------------------------------------------------------------------
// parseDrizzleSchema
// ---------------------------------------------------------------------------

describe('parseDrizzleSchema', () => {
  it('parses a pgTable with PK and FK fields', () => {
    const content = `
import { pgTable, serial, integer, text } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name'),
  email: text('email').unique(),
});

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
});
`;
    const models = parseDrizzleSchema(content);
    expect(models.length).toBeGreaterThanOrEqual(1);

    const userModel = models.find((m) => m.name === 'users');
    expect(userModel).toBeDefined();
    const userFields = userModel!.fields.map((f) => f.name);
    expect(userFields).toContain('id');
    expect(userFields).toContain('email');

    const postModel = models.find((m) => m.name === 'posts');
    expect(postModel).toBeDefined();
    const postFields = postModel!.fields.map((f) => f.name);
    expect(postFields).toContain('id');
    expect(postFields).toContain('userId');
  });

  it('skips tables with no key/FK fields', () => {
    const content = `
import { pgTable, text } from 'drizzle-orm/pg-core';

export const logs = pgTable('logs', {
  message: text('message'),
  level: text('level'),
});
`;
    const models = parseDrizzleSchema(content);
    expect(models.find((m) => m.name === 'logs')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseWranglerBindings (V11)
// ---------------------------------------------------------------------------

describe('parseWranglerBindings', () => {
  it('parses wrangler.jsonc with D1 + R2 + KV bindings', () => {
    const content = `{
  // Main config
  "name": "my-app",
  "d1_databases": [
    { "binding": "DB", "database_name": "prod-db", "database_id": "abc" }
  ],
  "r2_buckets": [
    { "binding": "ASSETS_BUCKET", "bucket_name": "assets" }
  ],
  "kv_namespaces": [
    { "binding": "SESSIONS", "id": "xyz" }
  ]
}`;
    const bindings = parseWranglerBindings(content);
    expect(bindings.DB).toBe('d1');
    expect(bindings.ASSETS_BUCKET).toBe('r2');
    expect(bindings.SESSIONS).toBe('kv');
  });

  it('parses wrangler.toml with D1 binding', () => {
    const content = `
name = "my-app"

[[d1_databases]]
binding = "DB"
database_name = "prod-db"
database_id = "abc"
`;
    const bindings = parseWranglerBindings(content);
    expect(bindings.DB).toBe('d1');
  });

  it('returns empty object for empty content', () => {
    const bindings = parseWranglerBindings('');
    expect(Object.keys(bindings)).toHaveLength(0);
  });

  it('handles AI binding', () => {
    const content = `{
      "ai": { "binding": "AI" }
    }`;
    const bindings = parseWranglerBindings(content);
    expect(bindings.AI).toBe('ai');
  });
});

// ---------------------------------------------------------------------------
// generateSchema (V4, V11)
// ---------------------------------------------------------------------------

describe('generateSchema', () => {
  it('returns null when no schema sources', () => {
    const info: FrameworkInfo = {
      name: 'generic',
      appDir: null,
      routerType: null,
      runtime: 'node',
      libDirs: [],
      componentDirs: [],
      schemaSources: [],
      skipDirs: new Set(),
    };
    expect(generateSchema(info)).toBeNull();
  });

  it('includes bindings comment when framework has bindings (V11)', () => {
    const tmpDir = fs.mkdtempSync(os.tmpdir() + '/codex-test-');
    const schemaPath = tmpDir + '/schema.prisma';
    fs.writeFileSync(schemaPath, `
model User {
  id    Int    @id
  email String @unique
}
`);

    const info: FrameworkInfo = {
      name: 'sveltekit',
      appDir: null,
      routerType: null,
      runtime: 'cloudflare-workers',
      libDirs: [],
      componentDirs: [],
      schemaSources: [{ kind: 'prisma', path: schemaPath }],
      skipDirs: new Set(),
      bindings: { DB: 'd1', ASSETS: 'r2' },
    };

    const result = generateSchema(info);
    expect(result).not.toBeNull();
    expect(result!).toContain('Bindings: DB:d1, ASSETS:r2');
    expect(result!).toContain('**User**');

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('produces output without bindings when none present', () => {
    const tmpDir = fs.mkdtempSync(os.tmpdir() + '/codex-test-');
    const schemaPath = tmpDir + '/schema.prisma';
    fs.writeFileSync(schemaPath, `
model Item {
  id    Int    @id
  name  String @unique
}
`);

    const info: FrameworkInfo = {
      name: 'generic',
      appDir: null,
      routerType: null,
      runtime: 'node',
      libDirs: [],
      componentDirs: [],
      schemaSources: [{ kind: 'prisma', path: schemaPath }],
      skipDirs: new Set(),
    };

    const result = generateSchema(info);
    expect(result).not.toBeNull();
    expect(result!).not.toContain('Bindings:');
    expect(result!).toContain('**Item**');

    fs.rmSync(tmpDir, { recursive: true });
  });
});
