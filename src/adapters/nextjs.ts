// ---------------------------------------------------------------------------
// adapters/nextjs.ts — Next.js framework adapter
// Extracted from generate-codex.ts. V5: byte-identical output.
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';
import type { FrameworkAdapter, FrameworkInfo } from '../types';
import { walk, readFileSafe, pad, findDirsNamed, DEFAULT_SKIP_DIRS, ROOT, TODAY } from '../helpers';

// ---------------------------------------------------------------------------
// pathToRoute — Next.js route path resolution (V3: adapter-owned)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// detect — V1: returns FrameworkInfo | null. Null = not a Next.js project.
// ---------------------------------------------------------------------------

function detect(root: string): FrameworkInfo | null {
  const nextConfig = ['next.config.js', 'next.config.mjs', 'next.config.ts']
    .find((f) => fs.existsSync(path.join(root, f)));
  if (!nextConfig) return null;

  const skipDirs = new Set(DEFAULT_SKIP_DIRS);
  const info: FrameworkInfo = {
    name: 'nextjs',
    appDir: null,
    routerType: null,
    runtime: 'node',              // V16: default
    libDirs: [],
    componentDirs: [],
    schemaSources: [],
    skipDirs,
  };

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
        if (e.isDirectory() && !skipDirs.has(e.name)) {
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
      .map((c) => path.join(root, c))
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

  // Detect component directories
  const compCandidates = ['components', 'src/components', 'app/components'];
  for (const dir of compCandidates) {
    const fullPath = path.join(root, dir);
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

// ---------------------------------------------------------------------------
// generateRoutes — API Routes (V3: adapter-owned path resolution)
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

    const route = pathToRoute(file, framework.appDir!, framework.routerType as 'app' | 'pages' ?? 'app');

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
// generatePages — Page Tree (V3: adapter-owned)
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

    const route = pathToRoute(file, framework.appDir!, framework.routerType as 'app' | 'pages' ?? 'app');
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
// generateComponents — Component Index (V3: adapter-owned)
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
// Export adapter (I.adapter)
// ---------------------------------------------------------------------------

export const nextjsAdapter: FrameworkAdapter = {
  name: 'nextjs',
  detect,
  generateRoutes,
  generatePages,
  generateComponents,
};
