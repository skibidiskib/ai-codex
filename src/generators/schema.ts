// ---------------------------------------------------------------------------
// generators/schema.ts — Framework-agnostic schema generators
// ---------------------------------------------------------------------------

import type { SchemaModelField, SchemaModelInfo, FrameworkInfo } from '../types';
import { readFileSafe, pad, TODAY } from '../helpers';

// ---------------------------------------------------------------------------
// Prisma parser
// ---------------------------------------------------------------------------

export function parsePrismaSchema(content: string): SchemaModelInfo[] {
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

// ---------------------------------------------------------------------------
// Drizzle parser
// ---------------------------------------------------------------------------

export function parseDrizzleSchema(content: string): SchemaModelInfo[] {
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

// ---------------------------------------------------------------------------
// wrangler.jsonc / wrangler.toml binding parser (V11)
// ---------------------------------------------------------------------------

/**
 * Parse wrangler.jsonc or wrangler.toml to extract binding metadata.
 * Returns a map of binding name → type (e.g. { DB: 'd1', ASSETS_BUCKET: 'r2' }).
 * Handles JSONC (strips single-line comments before JSON parsing).
 */
export function parseWranglerBindings(content: string): Record<string, string> {
  const bindings: Record<string, string> = {};

  // Try JSONC parsing first (wrangler.jsonc)
  // Strip single-line comments (// ...) being careful not to strip inside strings
  let cleaned = content;
  try {
    // Naive JSONC: strip // comments outside strings
    cleaned = cleaned.replace(/("(?:[^"\\]|\\.)*")|(\/\/.*$)/gm, '$1');
    const json = JSON.parse(cleaned);

    // D1 bindings
    if (Array.isArray(json.d1_databases)) {
      for (const db of json.d1_databases) {
        if (db.binding) bindings[db.binding] = 'd1';
      }
    }
    // R2 bindings
    if (Array.isArray(json.r2_buckets)) {
      for (const bucket of json.r2_buckets) {
        if (bucket.binding) bindings[bucket.binding] = 'r2';
      }
    }
    // KV bindings
    if (Array.isArray(json.kv_namespaces)) {
      for (const kv of json.kv_namespaces) {
        if (kv.binding) bindings[kv.binding] = 'kv';
      }
    }
    // Durable Object bindings
    if (Array.isArray(json.durable_objects?.bindings)) {
      for (const dob of json.durable_objects.bindings) {
        if (dob.name) bindings[dob.name] = 'durable-object';
      }
    }
    // Service bindings
    if (Array.isArray(json.services)) {
      for (const svc of json.services) {
        if (svc.binding) bindings[svc.binding] = 'service';
      }
    }
    // Queues
    if (Array.isArray(json.queues?.producers)) {
      for (const q of json.queues.producers) {
        if (q.binding) bindings[q.binding] = 'queue';
      }
    }
    // Vectorize
    if (Array.isArray(json.vectorize)) {
      for (const v of json.vectorize) {
        if (v.binding) bindings[v.binding] = 'vectorize';
      }
    }
    // Hyperdrive
    if (Array.isArray(json.hyperdrive)) {
      for (const h of json.hyperdrive) {
        if (h.binding) bindings[h.binding] = 'hyperdrive';
      }
    }
    // Browser bindings
    if (Array.isArray(json.browser)) {
      for (const b of json.browser) {
        if (b.binding) bindings[b.binding] = 'browser';
      }
    }
    // AI bindings
    if (json.ai?.binding) {
      bindings[json.ai.binding] = 'ai';
    }
    // Assets
    if (json.assets?.binding) {
      bindings[json.assets.binding] = 'assets';
    }
    // Workers for Platforms (dispatch namespaces)
    if (Array.isArray(json.dispatch_namespaces)) {
      for (const d of json.dispatch_namespaces) {
        if (d.binding) bindings[d.binding] = 'dispatch-namespace';
      }
    }
  } catch {
    // Not JSON — might be TOML. Simple regex-based extraction for wrangler.toml.
    // D1
    const d1Re = /\[\[d1_databases\]\][\s\S]*?binding\s*=\s*["'](\w+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = d1Re.exec(content)) !== null) bindings[m[1]] = 'd1';

    // R2
    const r2Re = /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*["'](\w+)["']/g;
    while ((m = r2Re.exec(content)) !== null) bindings[m[1]] = 'r2';

    // KV
    const kvRe = /\[\[kv_namespaces\]\][\s\S]*?binding\s*=\s*["'](\w+)["']/g;
    while ((m = kvRe.exec(content)) !== null) bindings[m[1]] = 'kv';

    // Queues
    const qRe = /\[\[queues\.producers\]\][\s\S]*?binding\s*=\s*["'](\w+)["']/g;
    while ((m = qRe.exec(content)) !== null) bindings[m[1]] = 'queue';
  }

  return bindings;
}

// ---------------------------------------------------------------------------
// generateSchema — framework-agnostic (V4)
// ---------------------------------------------------------------------------

export function generateSchema(framework: FrameworkInfo): string | null {
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
  ];

  // V11: emit binding metadata as comment in header
  if (framework.bindings && Object.keys(framework.bindings).length > 0) {
    const bindingParts = Object.entries(framework.bindings)
      .map(([name, type]) => `${name}:${type}`);
    output.push(`# Bindings: ${bindingParts.join(', ')}`);
  }

  output.push('');

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
