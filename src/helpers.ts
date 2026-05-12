// ---------------------------------------------------------------------------
// helpers.ts — Shared utilities for ai-codex
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';

export const ROOT = process.cwd();
export const TODAY = new Date().toISOString().slice(0, 10);

export const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', '.worktrees', '__pycache__', '.turbo',
  'dist', 'build', '.cache', 'coverage', '.nyc_output', '.parcel-cache',
  '.ai-codex', '.claude',
]);

export function shouldSkipFile(name: string): boolean {
  return (
    name.includes('.backup.') ||
    name.includes('-backup-') ||
    name.endsWith('.d.ts') ||
    name.endsWith('.map') ||
    name.endsWith('.min.js') ||
    name.endsWith('.min.css')
  );
}

export function walk(dir: string, extFilter?: string[], skipDirs?: Set<string>): string[] {
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

export function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export function pad(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

export function findDirsNamed(base: string, targetName: string): string[] {
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
