/**
 * Plain JSON value, the shape of a Home Assistant automation or script config
 * as returned by `/api/config/automation/config/<id>` or loaded from YAML.
 */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type JsonObject = { [k: string]: Json };

export function isJsonObject(v: Json | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Narrow an arbitrary value (e.g. a `js-yaml` load result) to {@link Json}.
 * YAML can also produce Date, undefined or non-finite numbers; those are not
 * JSON and a config containing them cannot be compared faithfully.
 */
export function isJson(v: unknown): v is Json {
  if (v === null) return true;
  switch (typeof v) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(v);
    case 'object':
      if (Array.isArray(v)) return v.every(isJson);
      return Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(isJson);
    default:
      return false;
  }
}
