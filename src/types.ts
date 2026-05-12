// ---------------------------------------------------------------------------
// types.ts — Shared interfaces for ai-codex
// ---------------------------------------------------------------------------

export interface Config {
  output: string;
  include: string[];
  exclude: string[];
  schema: string | null;
  quiet: boolean;
}

export interface SchemaSource {
  kind: 'prisma' | 'drizzle';
  path: string;
}

export interface FrameworkInfo {
  name: string;
  appDir: string | null;
  routerType: string | null;        // 'app' | 'pages' | 'sveltekit' | future values
  runtime: 'node' | 'cloudflare-workers';
  libDirs: string[];
  componentDirs: string[];
  schemaSources: SchemaSource[];
  skipDirs: Set<string>;
  bindings?: Record<string, string>; // CF: { DB: 'd1', ASSETS_BUCKET: 'r2', ... }
}

export interface FrameworkAdapter {
  name: string;
  detect(root: string): FrameworkInfo | null;
  generateRoutes(info: FrameworkInfo): string | null;
  generatePages(info: FrameworkInfo): string | null;
  generateComponents(info: FrameworkInfo): string | null;
}

export interface SchemaModelField {
  name: string;
  type: string;
  flags: string[];
  comment: string;
}

export interface SchemaModelRelation {
  fieldName: string;
  target: string;
  isArray: boolean;
}

export interface SchemaModelInfo {
  name: string;
  fields: SchemaModelField[];
  relations: SchemaModelRelation[];
}
