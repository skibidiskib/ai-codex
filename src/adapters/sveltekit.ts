// ---------------------------------------------------------------------------
// adapters/sveltekit.ts — SvelteKit framework adapter
// V6-V9, V12-V13, V15-V16, C9-C16
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';
import type { FrameworkAdapter, FrameworkInfo } from '../types';
import { walk, readFileSafe, pad, findDirsNamed, DEFAULT_SKIP_DIRS, ROOT, TODAY } from '../helpers';
import { parseWranglerBindings } from '../generators/schema';

// ---------------------------------------------------------------------------
// pathToRoute — SvelteKit route path resolution (V8, V3)
// ---------------------------------------------------------------------------

function pathToRoute(filePath: string, base: string): string {
  let rel = path.relative(base, filePath);
  // Get the directory (file is always +server.ts, +page.svelte, etc.)
  rel = path.dirname(rel);
  // Strip route groups: (name) → removed (V8)
  rel = rel.replace(/\([\w-]+\)\/?/g, '');
  // [...rest] → :* (V8)
  rel = rel.replace(/\[\.\.\.(\w+)\]/g, ':*');
  // [[optional]] → :optional (V8) — must precede [param] replace
  rel = rel.replace(/\[\[([^\]]+)\]\]/g, ':$1');
  // [param] → :param (V8)
  rel = rel.replace(/\[([^\]]+)\]/g, ':$1');
  rel = '/' + rel.replace(/\\/g, '/');
  if (rel === '/.') rel = '/';
  if (rel.length > 1 && rel.endsWith('/')) rel = rel.slice(0, -1);
  return rel;
}

// ---------------------------------------------------------------------------
// detect — V6: returns null when svelte.config.js absent
// ---------------------------------------------------------------------------

function detect(root: string): FrameworkInfo | null {
  // V6: must check file exists
  const svelteConfig = ['svelte.config.js', 'svelte.config.mjs', 'svelte.config.ts']
    .find((f) => fs.existsSync(path.join(root, f)));
  if (!svelteConfig) return null;

  const skipDirs = new Set(DEFAULT_SKIP_DIRS);
  const info: FrameworkInfo = {
    name: 'sveltekit',
    appDir: null,
    routerType: 'sveltekit',   // V15
    runtime: 'node',            // V16: default, overridden below
    libDirs: [],
    componentDirs: [],
    schemaSources: [],
    skipDirs,
  };

  // Detect src/routes dir (C9)
  const routesCandidates = ['src/routes', 'src/lib/routes', 'routes'];
  for (const candidate of routesCandidates) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      info.appDir = full;
      break;
    }
  }

  // V16: detect adapter-cloudflare for runtime (C14)
  const configContent = readFileSafe(path.join(root, svelteConfig));
  if (/adapter-cloudflare/.test(configContent)) {
    info.runtime = 'cloudflare-workers';
  }

  // V11: parse wrangler.jsonc/wrangler.toml for bindings (C12)
  const wranglerFile = ['wrangler.jsonc', 'wrangler.toml']
    .find((f) => fs.existsSync(path.join(root, f)));
  if (wranglerFile) {
    info.runtime = 'cloudflare-workers';
    const wranglerContent = readFileSafe(path.join(root, wranglerFile));
    const bindings = parseWranglerBindings(wranglerContent);
    if (Object.keys(bindings).length > 0) {
      info.bindings = bindings;
    }
  }


  // Detect lib dir: SvelteKit convention is src/lib (C9)
  const libCandidates = ['src/lib', 'src/lib/server', 'lib'];
  for (const dir of libCandidates) {
    const full = path.join(root, dir);
    if (fs.existsSync(full)) {
      info.libDirs.push(full);
    }
  }

  // Detect component dirs
  const compCandidates = ['src/lib/components', 'src/components', 'src/lib/ui'];
  for (const dir of compCandidates) {
    const full = path.join(root, dir);
    if (fs.existsSync(full)) {
      info.componentDirs.push(full);
    }
  }

  // Find nested component dirs under src/routes
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

// ---------------------------------------------------------------------------
// generateRoutes — +server.ts → API routes (V7, C10)
// ---------------------------------------------------------------------------

function generateRoutes(framework: FrameworkInfo): string | null {
  if (!framework.appDir) return null;

  // C10: +server.ts files with named exports
  const serverFiles = walk(framework.appDir, ['+server.ts', '+server.js'], framework.skipDirs);
  if (serverFiles.length === 0) return null;

  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
  const METHOD_REGEX = new Map<string, RegExp>(
    HTTP_METHODS.map((m) => [m, new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\s*(?::\\s*\\w+)?\\s*=`)])
  );

  interface RouteInfo {
    route: string;
    methods: string[];
    tags: string[];
  }

  const routes: RouteInfo[] = [];

  for (const file of serverFiles) {
    const content = readFileSafe(file);
    if (!content) continue;

    const route = pathToRoute(file, framework.appDir!);
    const methods: string[] = [];
    for (const m of HTTP_METHODS) {
      if (METHOD_REGEX.get(m)!.test(content)) methods.push(m);
    }
    if (methods.length === 0) continue;

    // Detect common patterns
    const tags: string[] = [];
    if (/checkPermissions|withAuth|requireAuth/.test(content)) tags.push('auth');
    if (/prisma|db\.|database/i.test(content)) tags.push('db');
    if (/cache|redis/i.test(content)) tags.push('cache');

    routes.push({ route, methods, tags });
  }

  if (routes.length === 0) return null;

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
    for (const r of items) {
      const methods = r.methods.join(',');
      const tagStr = r.tags.length ? ` [${r.tags.join(',')}]` : '';
      lines.push(`${pad(methods, 12)} ${r.route}${tagStr}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// generatePages — +page.svelte pages (V7, V12, V13, C15)
// ---------------------------------------------------------------------------

function generatePages(framework: FrameworkInfo): string | null {
  if (!framework.appDir) return null;

  // V7: +page.svelte → page. +layout.svelte → excluded.
  const pageFiles = walk(framework.appDir, ['+page.svelte'], framework.skipDirs);
  if (pageFiles.length === 0) return null;

  interface PageInfo {
    route: string;
    tag: string;       // [ssr] or [csr]
    actions: string[]; // V13: action names
  }

  const pages: PageInfo[] = [];

  for (const file of pageFiles) {
    const dir = path.dirname(file);
    const route = pathToRoute(file, framework.appDir!);

    // V12: determine SSR/CSR tag
    let tag = '[csr]'; // default: just +page.svelte, no load
    const serverLoadFile = path.join(dir, '+page.server.ts');
    const serverLoadJsFile = path.join(dir, '+page.server.js');
    const clientLoadFile = path.join(dir, '+page.ts');
    const clientLoadJsFile = path.join(dir, '+page.js');

    const hasServerLoad = fs.existsSync(serverLoadFile) || fs.existsSync(serverLoadJsFile);
    let clientLoadContent = '';

    if (hasServerLoad) {
      tag = '[ssr]';
    } else if (fs.existsSync(clientLoadFile)) {
      clientLoadContent = readFileSafe(clientLoadFile);
      if (/export\s+(async\s+)?function\s+load\b/.test(clientLoadContent)) {
        tag = '[ssr]';
      }
    } else if (fs.existsSync(clientLoadJsFile)) {
      clientLoadContent = readFileSafe(clientLoadJsFile);
      if (/export\s+(async\s+)?function\s+load\b/.test(clientLoadContent)) {
        tag = '[ssr]';
      }
    }

    // V13: detect actions in +page.server.ts (C16)
    const actions: string[] = [];
    if (hasServerLoad) {
      const serverContent = readFileSafe(fs.existsSync(serverLoadFile) ? serverLoadFile : serverLoadJsFile);
      // Look for action definitions: each top-level property in the actions object
      // Match lines like:   default: async () => { ... },
      //                       contact: async () => { ... },
      // Strategy: find the actions export, then extract top-level keys
      const actionsExportMatch = serverContent.match(/export\s+const\s+actions\s*=\s*\{/);
      if (actionsExportMatch) {
        const startIdx = actionsExportMatch.index! + actionsExportMatch[0].length;
        // Track braces to find the end of the actions object
        let depth = 1;
        let i = startIdx;
        while (i < serverContent.length && depth > 0) {
          const ch = serverContent[i];
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
          else if (ch === '"' || ch === "'" || ch === '`') {
            // Skip strings
            const q = ch;
            i++;
            while (i < serverContent.length && serverContent[i] !== q) {
              if (serverContent[i] === '\\') i++;
              i++;
            }
          }
          i++;
        }
        const actionsBody = serverContent.substring(startIdx, i - 1);
        // Extract top-level keys: identifier followed by : at the start of a logical segment
        // These are the action names
        const actionNameRegex = /(^|,|\n)\s*(\w+)\s*:/g;
        let actionMatch: RegExpExecArray | null;
        const names: string[] = [];
        while ((actionMatch = actionNameRegex.exec(actionsBody)) !== null) {
          names.push(actionMatch[2]);
        }
        // Reorder: default first, then others
        if (names.includes('default')) {
          actions.push('default');
          for (const n of names) {
            if (n !== 'default') actions.push(n);
          }
        } else {
          actions.push(...names);
        }
      }
    }

    pages.push({ route, tag, actions });
  }

  pages.sort((a, b) => a.route.localeCompare(b.route));

  const lines: string[] = [
    `# Pages (generated ${TODAY})`,
    `# ${pages.length} pages. [ssr]=server load, [csr]=client-only.`,
    '',
  ];

  for (const p of pages) {
    const actionStr = p.actions.length ? ` actions:${p.actions.join(',')}` : '';
    lines.push(`${pad(p.tag, 10)} ${pad(p.route, 50)}${actionStr}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// generateComponents — .svelte components (V9, C11)
// ---------------------------------------------------------------------------

function generateComponents(framework: FrameworkInfo): string | null {
  const searchDirs = [...framework.componentDirs];
  if (searchDirs.length === 0) return null;

  interface ComponentInfo {
    name: string;
    props: string[];
  }

  const groups = new Map<string, ComponentInfo[]>();
  const seenComponents = new Set<string>();

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    const files = walk(dir, ['.svelte'], framework.skipDirs);
    const relGroup = path.relative(ROOT, dir);

    const components: ComponentInfo[] = [];

    for (const file of files) {
      const content = readFileSafe(file);
      if (!content) continue;

      const name = path.basename(file).replace(/\.svelte$/, '');

      // Deduplicate
      const dedupeKey = `${relGroup}::${name}`;
      if (seenComponents.has(dedupeKey)) continue;
      seenComponents.add(dedupeKey);

      // V9: extract props
      const props: string[] = [];

      // Svelte 5 runes: let { a, b, c } = $props() (C11)
      const runesMatch = content.match(/let\s*\{\s*([^}]+)\}\s*=\s*\$props\(/);
      if (runesMatch) {
        const destructured = runesMatch[1];
        // Extract identifiers, stripping defaults and types
        const ids = destructured.matchAll(/(\w+)\s*(?:=|:|,|\}|$)/g);
        let count = 0;
        for (const id of ids) {
          if (count >= 5) break;
          if (id[1] && !['function', 'const', 'let', 'var'].includes(id[1])) {
            props.push(id[1]);
            count++;
          }
        }
      } else {
        // Svelte 4: export let propName (C11)
        const exportLetMatches = content.matchAll(/export\s+let\s+(\w+)/g);
        let count = 0;
        for (const m of exportLetMatches) {
          if (count >= 5) break;
          props.push(m[1]);
          count++;
        }
      }

      components.push({ name, props });
    }

    if (components.length > 0) {
      components.sort((a, b) => a.name.localeCompare(b.name));
      groups.set(relGroup, components);
    }
  }

  if (groups.size === 0) return null;

  // Merge groups by feature area
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
    `# SvelteKit components (.svelte).`,
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
      const showProps = deduped.length <= 15;
      const propsStr = showProps && c.props.length ? `  ${c.props.join(', ')}` : '';
      output.push(`    ${c.name}${propsStr}`);
    }
    output.push('');
  }

  return output.join('\n');
}

// ---------------------------------------------------------------------------
// Export adapter (I.adapter, V17: adapters don't import each other)
// ---------------------------------------------------------------------------

export const sveltekitAdapter: FrameworkAdapter = {
  name: 'sveltekit',
  detect,
  generateRoutes,
  generatePages,
  generateComponents,
};
