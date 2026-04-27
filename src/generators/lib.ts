// ---------------------------------------------------------------------------
// generators/lib.ts — Framework-agnostic library export generator
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';
import type { FrameworkInfo, Config } from '../types';
import { walk, readFileSafe, ROOT, TODAY } from '../helpers';

// ---------------------------------------------------------------------------
// generateLib
// ---------------------------------------------------------------------------

export function generateLib(framework: FrameworkInfo, config: Config): string | null {
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
