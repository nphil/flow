import { isJsonObject, type Json } from './json';

const MAX_DIFFS = 25;

function typeOf(v: Json): string {
  if (Array.isArray(v)) return 'array';
  return v === null ? 'null' : typeof v;
}

/** Structural diff of two canonical configs; returns human-readable paths that differ. */
export function semanticDiff(a: Json, b: Json, path = '', out: string[] = []): string[] {
  if (out.length >= MAX_DIFFS) return out;
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) {
    out.push(`${path || '(root)'}: type ${ta} -> ${tb}`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${path}: length ${a.length} -> ${b.length}`);
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      semanticDiff(a[i] ?? null, b[i] ?? null, `${path}[${i}]`, out);
    }
    return out;
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) {
        out.push(`${path}.${k}: added (${JSON.stringify(b[k]).slice(0, 90)})`);
      } else if (!(k in b)) {
        out.push(`${path}.${k}: REMOVED (${JSON.stringify(a[k]).slice(0, 90)})`);
      } else {
        semanticDiff(a[k], b[k], `${path}.${k}`, out);
      }
    }
    return out;
  }
  if (a !== b) {
    out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
  return out;
}
