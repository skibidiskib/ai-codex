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
import type { Config } from './types';
import { ROOT } from './helpers';
import { main } from './core';

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    output: '.ai-codex',
    include: [],
    exclude: [],
    schema: null,
    quiet: false,
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
      if (fileConfig.quiet) config.quiet = fileConfig.quiet;
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
      case '--quiet':
      case '-q':
        config.quiet = true;
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
  --quiet, -q           Suppress output (for hooks/CI)
  --version, -v         Show version
  --help, -h            Show this help

Config file:
  Place a codex.config.json in your project root to set defaults.
`);
}

// ---------------------------------------------------------------------------
// Entry point (V14: CLI entrypoint unchanged)
// ---------------------------------------------------------------------------

main(parseArgs());
