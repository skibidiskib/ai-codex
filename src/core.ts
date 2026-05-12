// ---------------------------------------------------------------------------
// core.ts — Orchestrator: detect framework, run generators, write output
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';
import type { Config, FrameworkAdapter, FrameworkInfo, SchemaSource } from './types';
import { walk, readFileSafe, pad, DEFAULT_SKIP_DIRS, ROOT } from './helpers';
import { generateSchema } from './generators/schema';
import { generateLib } from './generators/lib';
import { nextjsAdapter } from './adapters/nextjs';
import { sveltekitAdapter } from './adapters/sveltekit';

// ---------------------------------------------------------------------------
// Adapter registry (V2: adding framework = new file + one import line)
// ---------------------------------------------------------------------------

const adapters: FrameworkAdapter[] = [
  nextjsAdapter,
  sveltekitAdapter,
];

// ---------------------------------------------------------------------------
// detectFramework (V1: first non-null wins)
// ---------------------------------------------------------------------------

export function detectFramework(config: Config): FrameworkInfo {
  // Try each adapter in registration order
  for (const adapter of adapters) {
    const info = adapter.detect(ROOT);
    if (info) {
      // Enrich with framework-agnostic schema + lib detection
      enrichSchemaSources(info, config);
      enrichLibDirs(info);
      return info;
    }
  }

  // Generic fallback — no adapter matched
  const info: FrameworkInfo = {
    name: 'generic',
    appDir: null,
    routerType: null,
    runtime: 'node',
    libDirs: [],
    componentDirs: [],
    schemaSources: [],
    skipDirs: new Set(DEFAULT_SKIP_DIRS),
  };
  enrichSchemaSources(info, config);
  enrichLibDirs(info);
  return info;
}

// ---------------------------------------------------------------------------
// Schema source detection (framework-agnostic, V4, V18)
// ---------------------------------------------------------------------------

function enrichSchemaSources(info: FrameworkInfo, config: Config): void {
  // Prisma
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

  // Drizzle (V10: includes src/lib/server/db/ paths)
  if (config.schema && !config.schema.endsWith('.prisma')) {
    const fullPath = path.resolve(ROOT, config.schema);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      info.schemaSources.push({ kind: 'drizzle', path: fullPath });
    }
  } else {
    const drizzleBases = [
      'db', 'src/db', 'lib/db', 'src/lib/db',
      'app/db', 'src/app/db', 'database', 'drizzle',
      'src/lib/server/db',
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
}

// ---------------------------------------------------------------------------
// Lib dir detection (framework-agnostic, V18)
// ---------------------------------------------------------------------------

function enrichLibDirs(info: FrameworkInfo): void {
  if (info.libDirs.length > 0) return; // Adapter already set libDirs

  const libCandidates = ['lib', 'src/lib', 'utils', 'src/utils', 'src/helpers', 'helpers'];
  for (const dir of libCandidates) {
    const fullPath = path.join(ROOT, dir);
    if (fs.existsSync(fullPath)) {
      info.libDirs.push(fullPath);
    }
  }
}

// ---------------------------------------------------------------------------
// main — orchestration loop
// ---------------------------------------------------------------------------

export interface MainResult {
  totalLines: number;
  totalFiles: number;
  outputDir: string;
}

export function main(config: Config): MainResult {
  const log = config.quiet ? () => {} : console.log.bind(console);

  log('\nai-codex -- codebase indexer for AI assistants\n');

  const framework = detectFramework(config);

  // Merge user excludes into framework skipDirs
  for (const dir of config.exclude) {
    framework.skipDirs.add(dir);
  }
  log(`  Framework:  ${framework.name}`);
  log(`  Output:     ${config.output}/`);
  for (const src of framework.schemaSources) {
    const label = src.kind === 'prisma' ? 'Prisma' : 'Drizzle';
    log(`  ${pad(label + ':', 12)}${path.relative(ROOT, src.path)}`);
  }
  log('');

  const outputDir = path.resolve(ROOT, config.output);
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    console.error(`Error: could not create output directory "${outputDir}": ${(err as Error).message}`);
    process.exit(1);
  }

  // Find the matching adapter for route/page/component generation
  const adapter = adapters.find((a) => a.name === framework.name);

  const generators: [string, () => string | null][] = [
    ['routes.md', () => adapter ? adapter.generateRoutes(framework) : null],
    ['pages.md', () => adapter ? adapter.generatePages(framework) : null],
    ['lib.md', () => generateLib(framework, config)],
    ['schema.md', () => generateSchema(framework)],
    ['components.md', () => adapter ? adapter.generateComponents(framework) : null],
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
      log(`  ${pad(filename, 20)} skipped (not applicable)`);
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
    log(`  ${pad(filename, 20)} ${pad(String(lineCount) + ' lines', 14)} (${elapsed}ms)`);
  }

  log(`\n  Total: ${totalLines} lines across ${totalFiles} files`);
  log(`  Output: ${outputDir}/`);
  log('');

  return { totalLines, totalFiles, outputDir };
}
