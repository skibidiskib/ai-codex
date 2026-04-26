#!/usr/bin/env tsx
/**
 * ai-codex — Generate a compact codebase index for AI assistants.
 *
 * Scans your project and produces ultra-compact reference files that give
 * AI coding assistants instant context about your codebase structure,
 * saving 50K+ tokens per conversation.
 *
 * Usage:
 *   npx ai-codex                       # auto-detect framework, output to .ai-codex/
 *   npx ai-codex --output .claude/codex
 *   npx ai-codex --include src lib     # only scan these dirs
 *   npx ai-codex --exclude tests dist  # skip these dirs
 *   npx ai-codex --schema prisma/schema.prisma
 *
 * Config file (codex.config.json):
 *   {
 *     "output": ".ai-codex",
 *     "include": ["src", "lib", "app"],
 *     "exclude": ["tests", "__mocks__"],
 *     "schema": "prisma/schema.prisma"
 *   }
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

interface Config {
  output: string;
  include: string[];
  exclude: string[];
  schema: string | null;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    output: '.ai-codex',
    include: [],
    exclude: [],
    schema: null,
  };

  // Load config file if present
  const configPath = path.join(ROOT, 'codex.config.json');
  if (fs.existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (fileConfig.output) config.output = fileConfig.output;
      if (fileConfig.include) config.include = fileConfig.include;
      if (fileConfig.exclude) config.exclude = fileConfig.exclude;
      if (fileConfig.schema) config.schema = fileConfig.schema;
    } catch {
      console.warn('Warning: could not parse codex.config.json, using defaults');
    }
  }

  // CLI args override config file
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output':
      case '-o':
        if (i + 1 >= args.length) { console.error('Error: --output requires a value'); process.exit(1); }
        config.output = args[++i];
        break;
      case '--include':
        while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          config.include.push(args[++i]);
        }
        break;
      case '--exclude':
        while (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          config.exclude.push(args[++i]);
        }
        break;
      case '--schema':
        if (i + 1 >= args.length) { console.error('Error: --schema requires a value'); process.exit(1); }
        config.schema = args[++i];
        break;
      case '--version':
      case '-v':
        console.log('ai-codex v1.2.0');
        process.exit(0);
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
ai-codex — Generate a compact codebase index for AI assistants

Usage:
  npx ai-codex [options]

Options:
  --output, -o <dir>    Output directory (default: .ai-codex)
  --include <dirs...>   Directories to scan (default: auto-detect)
  --exclude <dirs...>   Directories to skip
  --schema <path>       Path to Prisma schema file (auto-detected)
  --version, -v         Show version
  --help, -h            Show this help

Config file:
  Place a codex.config.json in your project root to set defaults.
`);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10);

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', '.worktrees', '__pycache__', '.turbo',
  'dist', 'build', '.cache', 'coverage', '.nyc_output', '.parcel-cache',
  '.ai-codex', '.claude',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldSkipFile(name: string): boolean {
  return (
    name.includes('.backup.') ||
    name.includes('-backup-') ||
    name.endsWith('.d.ts') ||
    name.endsWith('.map') ||
    name.endsWith('.min.js') ||
    name.endsWith('.min.css')
  );
}

function walk(dir: string, extFilter?: string[], skipDirs?: Set<string>): string[] {
  const skip = skipDirs || DEFAULT_SKIP_DIRS;
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const f of walk(full, extFilter, skip)) results.push(f);
    } else if (entry.isFile()) {
      if (shouldSkipFile(entry.name)) continue;
      if (extFilter && !extFilter.some((ext) => entry.name.endsWith(ext))) continue;
      results.push(full);
    }
  }
  return results;
}

function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function pathToRoute(filePath: string, base: string, routerType: 'app' | 'pages' = 'app'): string {
  let rel = path.relative(base, filePath);
  if (routerType === 'pages') {
    // Pages Router: filename is the route segment; index/ collapses to parent
    rel = rel.replace(/\.(tsx?|jsx?)$/, '');
    rel = rel.replace(/(^|\/)index$/, '$1');
  } else {
    // App Router: route.ts/page.tsx — file is named, parent dir is the route
    rel = path.dirname(rel);
  }
  // Strip Next.js route groups: (name)
  rel = rel.replace(/\([\w-]+\)\/?/g, '');
  // Convert [[...param]] optional catch-all, then [param] to :param
  rel = rel.replace(/\[\[([^\]]+)\]\]/g, ':$1');
  rel = rel.replace(/\[([^\]]+)\]/g, ':$1');
  rel = '/' + rel.replace(/\\/g, '/');
  if (rel === '/.') rel = '/';
  if (rel.length > 1 && rel.endsWith('/')) rel = rel.slice(0, -1);
  return rel;
}

function pad(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// ---------------------------------------------------------------------------
// Framework Detection
// ---------------------------------------------------------------------------

interface SchemaSource {
  kind: 'prisma' | 'drizzle';
  path: string;
}

interface FrameworkInfo {
  name: string;
  appDir: string | null;
  routerType: 'app' | 'pages' | null;
  libDirs: string[];
  componentDirs: string[];
  schemaSources: SchemaSource[];
  skipDirs: Set<string>;
}

function detectFramework(config: Config): FrameworkInfo {
  const info: FrameworkInfo = {
    name: 'generic',
    appDir: null,
    routerType: null,
    libDirs: [],
    componentDirs: [],
    schemaSources: [],
    skipDirs: new Set(DEFAULT_SKIP_DIRS),
  };

  // Detect Next.js
  const nextConfig = ['next.config.js', 'next.config.mjs', 'next.config.ts']
    .find((f) => fs.existsSync(path.join(ROOT, f)));
  if (nextConfig) {
    info.name = 'nextjs';
    // Count router-shaped files in a candidate dir, capped at `cap`. Used to
    // pick the populated candidate when both src/<dir> and <dir> exist (a stray
    // leftover would otherwise mask the real one).
    const PAGES_SPECIAL_NAMES = new Set(['_app', '_document', '_error', 'middleware']);
    const countRouterFiles = (dir: string, kind: 'app' | 'pages', cap = 5): number => {
      let n = 0;
      const stack = [dir];
      while (stack.length > 0 && n < cap) {
        const d = stack.pop()!;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (n >= cap) break;
          if (e.isDirectory() && !info.skipDirs.has(e.name)) {
            stack.push(path.join(d, e.name));
          } else if (e.isFile()) {
            const name = e.name;
            if (kind === 'app') {
              if (/^(route|page)\.(tsx?|jsx?)$/.test(name)) n++;
            } else {
              if (name.endsWith('.d.ts')) continue;
              if (!/\.(tsx?|jsx?)$/.test(name)) continue;
              const baseName = name.replace(/\.(tsx?|jsx?)$/, '');
              if (PAGES_SPECIAL_NAMES.has(baseName)) continue;
              n++;
            }
          }
        }
      }
      return n;
    };
    const pickPopulated = (candidates: string[], kind: 'app' | 'pages'): string | null => {
      const present = candidates
        .map((c) => path.join(ROOT, c))
        .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
      if (present.length === 0) return null;
      const scored = present.map((p) => ({ p, c: countRouterFiles(p, kind) }));
      scored.sort((a, b) => b.c - a.c);
      return scored[0].p;
    };
    // App Router: prefer src/app over app, tie-break by population count.
    const appPick = pickPopulated(['src/app', 'app'], 'app');
    if (appPick) {
      info.appDir = appPick;
      info.routerType = 'app';
    }
    // Pages Router fallback (only if no App Router was picked).
    if (!info.appDir) {
      const pagesPick = pickPopulated(['src/pages', 'pages'], 'pages');
      if (pagesPick) {
        info.appDir = pagesPick;
        info.routerType = 'pages';
      }
    }
  }

  // Detect Prisma. If --schema points to a .prisma file, use only that.
  const prismaCandidates = config.schema && config.schema.endsWith('.prisma')
    ? [config.schema]
    : config.schema
    ? []
    : ['prisma/schema.prisma', 'schema.prisma', 'prisma/schema/schema.prisma'];
  for (const candidate of prismaCandidates) {
    const fullPath = path.resolve(ROOT, candidate);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      info.schemaSources.push({ kind: 'prisma', path: fullPath });
      break;
    }
  }

  // Detect Drizzle. Looks for `db/schema.ts` or `db/schema/*.ts` patterns under
  // common project roots. If --schema is a non-prisma file, treat it as drizzle.
  if (config.schema && !config.schema.endsWith('.prisma')) {
    const fullPath = path.resolve(ROOT, config.schema);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      info.schemaSources.push({ kind: 'drizzle', path: fullPath });
    }
  } else {
    const drizzleBases = [
      'db', 'src/db', 'lib/db', 'src/lib/db',
      'app/db', 'src/app/db', 'database', 'drizzle',
    ];
    for (const base of drizzleBases) {
      const baseAbs = path.join(ROOT, base);
      const schemaFile = path.join(baseAbs, 'schema.ts');
      const schemaDir = path.join(baseAbs, 'schema');
      if (fs.existsSync(schemaFile) && fs.statSync(schemaFile).isFile()) {
        info.schemaSources.push({ kind: 'drizzle', path: schemaFile });
      } else if (fs.existsSync(schemaDir) && fs.statSync(schemaDir).isDirectory()) {
        for (const f of walk(schemaDir, ['.ts'], info.skipDirs)) {
          info.schemaSources.push({ kind: 'drizzle', path: f });
        }
      }
    }
  }

  // Detect lib directories
  const libCandidates = ['lib', 'src/lib', 'utils', 'src/utils', 'src/helpers', 'helpers'];
  for (const dir of libCandidates) {
    const fullPath = path.join(ROOT, dir);
    if (fs.existsSync(fullPath)) {
      info.libDirs.push(fullPath);
    }
  }

  // Detect component directories
  const compCandidates = ['components', 'src/components', 'app/components'];
  for (const dir of compCandidates) {
    const fullPath = path.join(ROOT, dir);
    if (fs.existsSync(fullPath)) {
      info.componentDirs.push(fullPath);
    }
  }

  // Also find nested component dirs (app/**/components)
  if (info.appDir) {
    const nestedCompDirs = findDirsNamed(info.appDir, 'components');
    for (const d of nestedCompDirs) {
      if (!info.componentDirs.includes(d)) {
        info.componentDirs.push(d);
      }
    }
  }

  return info;
}

function findDirsNamed(base: string, targetName: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (DEFAULT_SKIP_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    if (!entry.isDirectory()) continue;
    const full = path.join(base, entry.name);
    if (entry.name === targetName) {
      results.push(full);
    } else {
      for (const f of findDirsNamed(full, targetName)) results.push(f);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 1. routes.md -- API Routes
// ---------------------------------------------------------------------------

function generateRoutes(framework: FrameworkInfo): string | null {
  if (!framework.appDir) return null;

  const apiDir = path.join(framework.appDir, 'api');
  if (!fs.existsSync(apiDir)) return null;

  const isPagesRouter = framework.routerType === 'pages';
  const routeFiles = isPagesRouter
    ? walk(apiDir, ['.ts', '.tsx', '.js', '.jsx'], framework.skipDirs).filter((f) => !f.endsWith('.d.ts'))
    : walk(apiDir, ['route.ts', 'route.tsx', 'route.js', 'route.jsx'], framework.skipDirs);
  if (routeFiles.length === 0) return null;

  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  const HTTP_METHOD_REGEXES = new Map<string, RegExp>(
    HTTP_METHODS.map((m) => [m, new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`)])
  );
  // Pages Router: handlers branch on req.method, not on export name.
  const PAGES_METHOD_REGEXES = new Map<string, RegExp>(
    HTTP_METHODS.map((m) => [m, new RegExp(`(req|request)\\.method\\s*===?\\s*['"\`]${m}['"\`]`, 'i')])
  );

  interface RouteInfo {
    route: string;
    methods: string[];
    tags: string[];
  }

  const routes: RouteInfo[] = [];

  for (const file of routeFiles) {
    const content = readFileSafe(file);
    if (!content) continue;

    const route = pathToRoute(file, framework.appDir!, framework.routerType || 'app');

    const methods: string[] = [];
    if (isPagesRouter) {
      for (const m of HTTP_METHODS) {
        if (PAGES_METHOD_REGEXES.get(m)!.test(content)) methods.push(m);
      }
      // Fallback: handler with default export but no method branch — mark as ANY.
      if (methods.length === 0 && /export\s+default\s+/.test(content)) methods.push('ANY');
    } else {
      for (const m of HTTP_METHODS) {
        if (HTTP_METHOD_REGEXES.get(m)!.test(content)) methods.push(m);
      }
    }
    if (methods.length === 0) continue;

    // Detect common patterns
    const tags: string[] = [];
    if (/checkPermissions|createPermissionHandler|withAuth|requireAuth/.test(content)) tags.push('auth');
    if (/prisma|db\.|database/i.test(content)) tags.push('db');
    if (/cache|redis/i.test(content)) tags.push('cache');

    routes.push({ route, methods, tags });
  }

  routes.sort((a, b) => a.route.localeCompare(b.route));

  // Group by top-level segment
  const groups = new Map<string, RouteInfo[]>();
  for (const r of routes) {
    const seg = r.route.split('/')[2] || 'root';
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg)!.push(r);
  }

  const lines: string[] = [
    `# API Routes (generated ${TODAY})`,
    `# ${routes.length} routes total.`,
    '',
  ];

  for (const [group, items] of groups) {
    lines.push(`## ${group}`);

    // Group routes by resource parent (first 5 segments)
    const resourceGroups = new Map<string, RouteInfo[]>();
    for (const r of items) {
      const segs = r.route.split('/');
      const key = segs.slice(0, 5).join('/');
      if (!resourceGroups.has(key)) resourceGroups.set(key, []);
      resourceGroups.get(key)!.push(r);
    }

    for (const [, subRoutes] of resourceGroups) {
      if (subRoutes.length <= 5) {
        for (const r of subRoutes) {
          const methods = r.methods.join(',');
          const tagStr = r.tags.length ? ` [${r.tags.join(',')}]` : '';
          lines.push(`${pad(methods, 12)} ${r.route}${tagStr}`);
        }
      } else {
        // Collapse large groups
        const allMethods = new Set<string>();
        const allTags = new Set<string>();
        for (const r of subRoutes) {
          r.methods.forEach((m) => allMethods.add(m));
          r.tags.forEach((t) => allTags.add(t));
        }
        const parentPath = subRoutes[0].route.split('/').slice(0, 5).join('/');
        const methodStr = [...allMethods].join(',');
        const tagStr = allTags.size ? ` [${[...allTags].join(',')}]` : '';
        lines.push(`${pad(methodStr, 12)} ${parentPath}/... (${subRoutes.length} routes)${tagStr}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 2. pages.md -- Page Tree
// ---------------------------------------------------------------------------

function generatePages(framework: FrameworkInfo): string | null {
  if (!framework.appDir) return null;

  const isPagesRouter = framework.routerType === 'pages';
  let pageFiles: string[];
  if (isPagesRouter) {
    const PAGES_SPECIALS = new Set(['_app', '_document', '_error', 'middleware']);
    pageFiles = walk(framework.appDir, ['.tsx', '.jsx', '.ts', '.js'], framework.skipDirs).filter((f) => {
      if (f.endsWith('.d.ts')) return false;
      const rel = path.relative(framework.appDir!, f);
      const segs = rel.split(path.sep);
      if (segs[0] === 'api') return false; // api routes handled by generateRoutes
      const baseName = path.basename(f).replace(/\.(tsx?|jsx?)$/, '');
      if (PAGES_SPECIALS.has(baseName)) return false;
      return true;
    });
  } else {
    pageFiles = walk(framework.appDir, ['page.tsx', 'page.jsx', 'page.ts', 'page.js'], framework.skipDirs);
  }
  if (pageFiles.length === 0) return null;

  interface PageInfo {
    route: string;
    isClient: boolean;
    exportName: string;
  }

  const pages: PageInfo[] = [];

  for (const file of pageFiles) {
    const content = readFileSafe(file);
    if (!content) continue;

    const route = pathToRoute(file, framework.appDir!, framework.routerType || 'app');
    const isClient = /^(?:'use client'|"use client")/.test(content.slice(0, 50).trimStart());

    let exportName = '';
    const exportMatch = content.match(/export\s+default\s+function\s+(\w+)/);
    if (exportMatch) {
      exportName = exportMatch[1];
    } else {
      const fnMatch = content.match(/export\s+default\s+(\w+)/);
      if (fnMatch) exportName = fnMatch[1];
    }

    pages.push({ route, isClient, exportName });
  }

  pages.sort((a, b) => a.route.localeCompare(b.route));

  const lines: string[] = [
    `# Pages (generated ${TODAY})`,
    `# ${pages.length} pages. [client]=client component, [server]=server component.`,
    '',
  ];

  for (const p of pages) {
    const tag = p.isClient ? '[client]' : '[server]';
    const routeStr = pad(p.route, 50);
    lines.push(`${pad(tag, 10)} ${routeStr} ${p.exportName}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 3. lib.md -- Library Exports
// ---------------------------------------------------------------------------

function generateLib(framework: FrameworkInfo, config: Config): string | null {
  // Determine which dirs to scan
  let scanDirs = framework.libDirs;

  // If user specified --include, scan those instead
  if (config.include.length > 0) {
    scanDirs = config.include.map((d) => path.resolve(ROOT, d));
  }

  if (scanDirs.length === 0) {
    // Fallback: scan src/ if it exists
    const srcDir = path.join(ROOT, 'src');
    if (fs.existsSync(srcDir)) {
      scanDirs = [srcDir];
    } else {
      return null;
    }
  }

  interface LibExport {
    kind: string;
    name: string;
    detail: string;
  }

  interface LibFile {
    relPath: string;
    exports: LibExport[];
  }

  const libFiles: LibFile[] = [];

  for (const libDir of scanDirs) {
    if (!fs.existsSync(libDir)) continue;
    const files = walk(libDir, ['.ts', '.tsx', '.js', '.jsx'], framework.skipDirs);

    for (const file of files) {
      const content = readFileSafe(file);
      if (!content) continue;

      const relPath = path.relative(ROOT, file);
      const exports: LibExport[] = [];

      const contentLines = content.split('\n');
      for (const line of contentLines) {
        // export (async) function NAME(params)
        const fnMatch = line.match(
          /^export\s+(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))?/
        );
        if (fnMatch) {
          let params = fnMatch[2] || '()';
          if (params.length > 80) params = params.slice(0, 77) + '...';
          exports.push({ kind: 'fn', name: fnMatch[1], detail: params });
          continue;
        }

        // export const NAME = (async)?(params) =>
        const arrowMatch = line.match(
          /^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*\w+)?\s*=>/
        );
        if (arrowMatch) {
          let params = `(${arrowMatch[2]})`;
          if (params.length > 80) params = params.slice(0, 77) + '...';
          exports.push({ kind: 'fn', name: arrowMatch[1], detail: params });
          continue;
        }

        // export class NAME
        const classMatch = line.match(/^export\s+class\s+(\w+)/);
        if (classMatch) {
          exports.push({ kind: 'class', name: classMatch[1], detail: '' });
          continue;
        }

        // export (interface|type) NAME
        const typeMatch = line.match(/^export\s+(?:interface|type)\s+(\w+)/);
        if (typeMatch) {
          exports.push({ kind: 'type', name: typeMatch[1], detail: '' });
          continue;
        }

        // export const NAME (not arrow fn)
        const constMatch = line.match(
          /^export\s+const\s+(\w+)\s*(?::\s*([\w<>\[\]|&, ]+?))?\s*=/
        );
        if (constMatch && !arrowMatch) {
          const typePart = constMatch[2] ? `: ${constMatch[2].trim()}` : '';
          exports.push({ kind: 'const', name: constMatch[1], detail: typePart });
          continue;
        }
      }

      if (exports.length > 0) {
        const hasFnOrClass = exports.some((e) => e.kind === 'fn' || e.kind === 'class');
        if (hasFnOrClass) {
          libFiles.push({ relPath, exports });
        }
      }
    }
  }

  if (libFiles.length === 0) return null;

  libFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));

  // Group by directory
  const groups = new Map<string, LibFile[]>();
  for (const lf of libFiles) {
    const dir = path.dirname(lf.relPath);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(lf);
  }

  const MAX_EXPORTS = 4;

  const output: string[] = [
    `# Library Exports (generated ${TODAY})`,
    `# fn=function, class=class. Type-only files omitted.`,
    '',
  ];

  for (const [group, files] of groups) {
    const singleFnFiles: { fileName: string; fnName: string }[] = [];
    const multiFnFiles: LibFile[] = [];

    for (const lf of files) {
      const meaningful = lf.exports.filter((e) => e.kind === 'fn' || e.kind === 'class');
      if (meaningful.length === 0) continue;
      if (meaningful.length === 1) {
        singleFnFiles.push({ fileName: path.basename(lf.relPath), fnName: meaningful[0].name });
      } else {
        multiFnFiles.push(lf);
      }
    }

    if (singleFnFiles.length === 0 && multiFnFiles.length === 0) continue;

    output.push(`## ${group}`);

    for (const lf of multiFnFiles) {
      const fileName = path.basename(lf.relPath);
      const meaningful = lf.exports.filter((e) => e.kind === 'fn' || e.kind === 'class');
      output.push(fileName);
      const shown = meaningful.slice(0, MAX_EXPORTS);
      for (const ex of shown) {
        output.push(`  ${ex.kind} ${ex.name}`);
      }
      if (meaningful.length > MAX_EXPORTS) {
        output.push(`  +${meaningful.length - MAX_EXPORTS} more`);
      }
    }

    if (singleFnFiles.length > 0) {
      if (singleFnFiles.length > 6) {
        output.push(`# ${singleFnFiles.length} single-export files:`);
        for (let i = 0; i < singleFnFiles.length; i += 3) {
          const batch = singleFnFiles.slice(i, i + 3);
          output.push(batch.map((f) => `${f.fileName.replace(/\.[jt]sx?$/, '')}:${f.fnName}`).join('  |  '));
        }
      } else {
        for (const f of singleFnFiles) {
          output.push(`${f.fileName}  fn ${f.fnName}`);
        }
      }
    }

    output.push('');
  }

  return output.join('\n');
}

// ---------------------------------------------------------------------------
// 4. schema.md -- Database Schema (Prisma)
// ---------------------------------------------------------------------------

interface SchemaModelField {
  name: string;
  type: string;
  flags: string[];
  comment: string;
}
interface SchemaModelRelation {
  fieldName: string;
  target: string;
  isArray: boolean;
}
interface SchemaModelInfo {
  name: string;
  fields: SchemaModelField[];
  relations: SchemaModelRelation[];
}

function parsePrismaSchema(content: string): SchemaModelInfo[] {
  const SKIP_AUDIT_FIELDS = new Set(['createdAt', 'updatedAt', 'deletedAt', 'isDeleted']);
  const PRISMA_SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'BigInt', 'Decimal', 'Bytes']);

  const lines = content.split('\n');
  const models: SchemaModelInfo[] = [];
  let currentModel: SchemaModelInfo | null = null;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const modelStart = trimmed.match(/^model\s+(\w+)\s*\{/);
    if (modelStart) {
      currentModel = { name: modelStart[1], fields: [], relations: [] };
      braceDepth = 1;
      continue;
    }
    if (!currentModel) continue;
    for (const ch of trimmed) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }
    if (braceDepth <= 0) {
      models.push(currentModel);
      currentModel = null;
      continue;
    }
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
    const fieldMatch = trimmed.match(/^(\w+)\s+([\w\[\]?]+)/);
    if (!fieldMatch) continue;
    const fieldName = fieldMatch[1];
    const fieldType = fieldMatch[2];
    const isRelation = /\@relation\(/.test(trimmed);
    const isArray = fieldType.endsWith('[]');
    const baseType = fieldType.replace('[]', '').replace('?', '');
    if (isRelation || (isArray && /^[A-Z]/.test(baseType))) {
      currentModel.relations.push({ fieldName, target: baseType, isArray });
      continue;
    }
    const isPK = /@id\b/.test(trimmed);
    const isUnique = /@unique\b/.test(trimmed);
    const isEnum = /^[A-Z]/.test(baseType) && !PRISMA_SCALARS.has(baseType);
    if (SKIP_AUDIT_FIELDS.has(fieldName) && !isPK && !isUnique) continue;
    const isKey = isPK || isUnique || isEnum;
    const isFKLike = /Id$|_id$/i.test(fieldName) && fieldName !== 'id';
    if (!isKey && !isFKLike) continue;
    const flags: string[] = [];
    if (isPK) flags.push('PK');
    if (isUnique) flags.push('UQ');
    let comment = '';
    const commentMatch = trimmed.match(/\/\/\s*(.+)/);
    if (commentMatch) comment = commentMatch[1].trim();
    currentModel.fields.push({ name: fieldName, type: fieldType.replace('?', ''), flags, comment });
  }
  return models;
}

function parseDrizzleSchema(content: string): SchemaModelInfo[] {
  // Drizzle field types (pg/mysql/sqlite). Conservative list: only these are
  // accepted as a field "type" to avoid false-matching helper calls.
  const DRIZZLE_TYPES = new Set([
    'serial', 'bigserial', 'integer', 'bigint', 'smallint', 'decimal', 'numeric',
    'real', 'doublePrecision', 'text', 'varchar', 'char', 'boolean', 'timestamp',
    'date', 'time', 'uuid', 'json', 'jsonb', 'tinyint', 'mediumint', 'mediumtext',
    'longtext', 'binary', 'blob', 'int', 'float', 'double', 'datetime',
  ]);

  const models: SchemaModelInfo[] = [];
  const tableRe = /export\s+const\s+(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\s*\(\s*['"`](\w+)['"`]\s*,\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(content)) !== null) {
    const modelName = match[1];
    let i = match.index + match[0].length;
    let depth = 1;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '"' || ch === "'" || ch === '`') {
        const q = ch;
        i++;
        while (i < content.length && content[i] !== q) {
          if (content[i] === '\\') i++;
          i++;
        }
      }
      i++;
    }
    const body = content.substring(match.index + match[0].length, i - 1);
    const fields: SchemaModelField[] = [];
    const fieldRe = /(?:^|,|\n)\s*(\w+)\s*:\s*(\w+)\s*\(/g;
    // Collect all field-start positions first so each field's tail can be
    // bounded to "until the next field" rather than a fixed lookahead window.
    const starts: { name: string; type: string; index: number; afterCall: number }[] = [];
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(body)) !== null) {
      starts.push({ name: fm[1], type: fm[2], index: fm.index, afterCall: fieldRe.lastIndex });
    }
    for (let s = 0; s < starts.length; s++) {
      const cur = starts[s];
      if (!DRIZZLE_TYPES.has(cur.type)) continue;
      const tailEnd = s + 1 < starts.length ? starts[s + 1].index : body.length;
      const tail = body.substring(cur.afterCall, tailEnd);
      const flags: string[] = [];
      if (/\.primaryKey\s*\(/.test(tail)) flags.push('PK');
      if (/\.unique\s*\(/.test(tail)) flags.push('UQ');
      if (/\.references\s*\(/.test(tail)) flags.push('FK');
      const isFKLike = flags.includes('FK') || /Id$|_id$/i.test(cur.name);
      const isKey = flags.includes('PK') || flags.includes('UQ');
      if (!isKey && !isFKLike) continue;
      fields.push({ name: cur.name, type: cur.type, flags, comment: '' });
    }
    if (fields.length > 0) {
      models.push({ name: modelName, fields, relations: [] });
    }
  }
  return models;
}

function generateSchema(framework: FrameworkInfo): string | null {
  if (framework.schemaSources.length === 0) return null;

  const models: SchemaModelInfo[] = [];
  for (const src of framework.schemaSources) {
    const content = readFileSafe(src.path);
    if (!content) continue;
    if (src.kind === 'prisma') {
      models.push(...parsePrismaSchema(content));
    } else if (src.kind === 'drizzle') {
      models.push(...parseDrizzleSchema(content));
    }
  }
  if (models.length === 0) return null;

  const output: string[] = [
    `# Database Schema (generated ${TODAY})`,
    `# ${models.length} models. PK=primary key, UQ=unique, FK=foreign key. Only key/FK/enum fields shown.`,
    '',
  ];

  for (const model of models) {
    if (/_backup_|_temp_|_old$|_bak$/i.test(model.name)) continue;

    const hasRelations = model.relations.length > 0;

    if (model.fields.length <= 1 && !hasRelations) {
      const pk = model.fields[0];
      if (pk) {
        output.push(`**${model.name}** -- ${pk.name}: ${pk.type}`);
      } else {
        output.push(`**${model.name}**`);
      }
      continue;
    }

    if (model.fields.length <= 4 && model.relations.length <= 3) {
      const fieldParts = model.fields.map((f) => {
        const flags = f.flags.length ? `(${f.flags.join(',')})` : '';
        return `${f.name}${flags}`;
      });
      const relParts = model.relations.map((r) => `${r.target}${r.isArray ? '[]' : ''}`);
      const relStr = relParts.length ? ` -> ${relParts.join(', ')}` : '';
      output.push(`**${model.name}** ${fieldParts.join(' | ')}${relStr}`);
      continue;
    }

    output.push(`## ${model.name}`);
    for (const f of model.fields) {
      const flagStr = f.flags.length ? `  ${f.flags.join(',')}` : '';
      const commentStr = f.comment ? `  -- ${f.comment}` : '';
      output.push(`  ${pad(f.name, 22)} ${pad(f.type, 10)}${flagStr}${commentStr}`);
    }

    if (hasRelations) {
      const uniqueTargets = [...new Set(model.relations.map((r) => {
        return `${r.target}${r.isArray ? '[]' : ''}`;
      }))];
      const shown = uniqueTargets.slice(0, 10);
      const extra = uniqueTargets.length > 10 ? ` +${uniqueTargets.length - 10} more` : '';
      output.push(`  -> ${shown.join(', ')}${extra}`);
    }

    output.push('');
  }

  return output.join('\n');
}

// ---------------------------------------------------------------------------
// 5. components.md -- Component Index
// ---------------------------------------------------------------------------

function generateComponents(framework: FrameworkInfo): string | null {
  const searchDirs = [...framework.componentDirs];

  if (searchDirs.length === 0) return null;

  // Common UI primitive names to skip (shadcn/radix/headless-ui base components)
  const UI_PRIMITIVES = new Set([
    'accordion', 'alert', 'alert-dialog', 'avatar', 'badge', 'button', 'calendar',
    'card', 'checkbox', 'collapsible', 'command', 'dialog', 'drawer',
    'dropdown-menu', 'form', 'hover-card', 'input', 'label', 'menubar',
    'navigation-menu', 'popover', 'progress', 'radio-group', 'scroll-area',
    'select', 'separator', 'sheet', 'skeleton', 'slider', 'sonner', 'switch',
    'table', 'tabs', 'textarea', 'toast', 'toaster', 'toggle', 'toggle-group',
    'tooltip', 'context-menu', 'aspect-ratio', 'resizable',
    'breadcrumb', 'carousel', 'chart', 'input-otp', 'pagination', 'sidebar',
  ]);

  interface ComponentInfo {
    name: string;
    isClient: boolean;
    props: string[];
  }

  const groups = new Map<string, ComponentInfo[]>();
  const seenComponents = new Set<string>();

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    if (dir.endsWith('/ui') || dir.includes('/ui/')) continue;

    const files = walk(dir, ['.tsx', '.jsx'], framework.skipDirs);
    const relGroup = path.relative(ROOT, dir);

    const components: ComponentInfo[] = [];

    for (const file of files) {
      if (file.includes('/ui/')) continue;

      const content = readFileSafe(file);
      if (!content) continue;

      const isClient = /^(?:'use client'|"use client")/.test(content.slice(0, 50).trimStart());

      let name = '';
      const defaultFnMatch = content.match(/export\s+default\s+function\s+(\w+)/);
      if (defaultFnMatch) {
        name = defaultFnMatch[1];
      } else {
        const namedExportMatch = content.match(/export\s+(?:function|const)\s+(\w+)/);
        if (namedExportMatch) {
          name = namedExportMatch[1];
        } else {
          name = path.basename(file).replace(/\.[jt]sx?$/, '');
        }
      }

      // Skip UI primitives
      const baseName = name.toLowerCase().replace(/\.[jt]sx?$/, '');
      if (UI_PRIMITIVES.has(baseName)) continue;

      // Deduplicate
      const dedupeKey = `${relGroup}::${name}`;
      if (seenComponents.has(dedupeKey)) continue;
      seenComponents.add(dedupeKey);

      // Extract props (first 5 fields)
      const props: string[] = [];
      const propsInterfaceMatch = content.match(/interface\s+\w*Props\w*\s*\{([^}]*)\}/s);
      if (propsInterfaceMatch) {
        const body = propsInterfaceMatch[1];
        const fieldMatches = body.matchAll(/^\s*(\w+)\s*[?:]/gm);
        let count = 0;
        for (const fm of fieldMatches) {
          if (count >= 5) break;
          props.push(fm[1]);
          count++;
        }
      }

      components.push({ name, isClient, props });
    }

    if (components.length > 0) {
      components.sort((a, b) => a.name.localeCompare(b.name));
      groups.set(relGroup, components);
    }
  }

  if (groups.size === 0) return null;

  // Merge groups by feature area (first 3 path segments)
  const mergedGroups = new Map<string, ComponentInfo[]>();
  for (const [group, comps] of groups) {
    if (comps.length === 0) continue;

    const parts = group.split('/').filter((p) => p !== 'components');
    let targetGroup: string;
    if (parts[0] === 'components' || parts.length === 0) {
      targetGroup = 'components';
    } else if (parts.length <= 3) {
      targetGroup = parts.join('/');
    } else {
      targetGroup = parts.slice(0, 3).join('/');
    }

    if (!mergedGroups.has(targetGroup)) mergedGroups.set(targetGroup, []);
    mergedGroups.get(targetGroup)!.push(...comps);
  }

  const output: string[] = [
    `# Components (generated ${TODAY})`,
    `# (c)=client component. UI primitives (shadcn/radix) omitted.`,
    '',
  ];

  for (const [group, comps] of mergedGroups) {
    const seen = new Set<string>();
    const deduped = comps.filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
    deduped.sort((a, b) => a.name.localeCompare(b.name));

    output.push(`## ${group}`);
    for (const c of deduped) {
      const marker = c.isClient ? '(c) ' : '    ';
      const showProps = deduped.length <= 15;
      const propsStr = showProps && c.props.length ? `  ${c.props.join(', ')}` : '';
      output.push(`${marker}${c.name}${propsStr}`);
    }
    output.push('');
  }

  return output.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('\nai-codex -- codebase indexer for AI assistants\n');

  const config = parseArgs();

  const framework = detectFramework(config);

  // Merge user excludes into framework skipDirs
  for (const dir of config.exclude) {
    framework.skipDirs.add(dir);
  }
  console.log(`  Framework:  ${framework.name}`);
  console.log(`  Output:     ${config.output}/`);
  for (const src of framework.schemaSources) {
    const label = src.kind === 'prisma' ? 'Prisma' : 'Drizzle';
    console.log(`  ${pad(label + ':', 12)}${path.relative(ROOT, src.path)}`);
  }
  console.log('');

  const outputDir = path.resolve(ROOT, config.output);
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    console.error(`Error: could not create output directory "${outputDir}": ${(err as Error).message}`);
    process.exit(1);
  }

  const generators: [string, () => string | null][] = [
    ['routes.md', () => generateRoutes(framework)],
    ['pages.md', () => generatePages(framework)],
    ['lib.md', () => generateLib(framework, config)],
    ['schema.md', () => generateSchema(framework)],
    ['components.md', () => generateComponents(framework)],
  ];

  let totalLines = 0;
  let totalFiles = 0;

  for (const [filename, generator] of generators) {
    const start = Date.now();
    let content: string | null;
    try {
      content = generator();
    } catch (err) {
      console.warn(`  ${pad(filename, 20)} ERROR: ${(err as Error).message}`);
      continue;
    }
    const elapsed = Date.now() - start;

    if (content === null) {
      console.log(`  ${pad(filename, 20)} skipped (not applicable)`);
      continue;
    }

    const lineCount = content.split('\n').length;
    totalLines += lineCount;
    totalFiles++;

    const outPath = path.join(outputDir, filename);
    try {
      fs.writeFileSync(outPath, content, 'utf-8');
    } catch (err) {
      console.error(`  ${pad(filename, 20)} ERROR writing file: ${(err as Error).message}`);
      continue;
    }
    console.log(`  ${pad(filename, 20)} ${pad(String(lineCount) + ' lines', 14)} (${elapsed}ms)`);
  }

  console.log(`\n  Total: ${totalLines} lines across ${totalFiles} files`);
  console.log(`  Output: ${outputDir}/`);
  console.log('');
}

main();
