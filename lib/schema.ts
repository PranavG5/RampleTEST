// Turns a provider's JSON Schema into a flat list of form fields.
// Pika marks media inputs with `media_kinds`; Higgsfield uses `format: "uri"`.
// Anything too complex for a simple control falls back to a JSON editor.

import type { JSONSchema, MediaKind } from "./types";

export type FieldKind =
  | "prompt"
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "media"
  | "mediaList"
  | "stringList"
  | "json";

export interface FormField {
  name: string;
  label: string;
  description?: string;
  kind: FieldKind;
  required: boolean;
  defaultValue?: unknown;
  enumValues?: (string | number | boolean)[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  mediaKinds?: MediaKind[];
  minItems?: number;
  maxItems?: number;
  numericItems?: boolean;
  example?: string; // for json fields: a filled-in skeleton built from the schema
  schema: JSONSchema;
}

const PROMPT_NAMES = new Set(["prompt", "prompt_text", "text_prompt"]);
const NOT_MEDIA = /(link|website|webhook|callback|homepage)/i;

function resolveRef(s: JSONSchema, root: JSONSchema): JSONSchema {
  let cur = s;
  for (let i = 0; i < 5 && cur && typeof cur.$ref === "string"; i++) {
    const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(cur.$ref);
    const target = m ? root[m[1]]?.[m[2]] : undefined;
    if (!target) break;
    const { $ref: _ignored, ...rest } = cur;
    cur = { ...target, ...rest };
  }
  if (Array.isArray(cur.allOf) && cur.allOf.length === 1) {
    const { allOf, ...rest } = cur;
    cur = { ...resolveRef(allOf[0], root), ...rest };
  }
  return cur;
}

// Strip `anyOf: [X, {type: null}]` down to X.
function unwrap(s: JSONSchema, root: JSONSchema): { s: JSONSchema; nullable: boolean } {
  let cur = resolveRef(s, root);
  let nullable = false;
  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(cur[key])) {
      const variants = (cur[key] as JSONSchema[]).map((v) => resolveRef(v, root));
      const nonNull = variants.filter((v) => v.type !== "null");
      if (nonNull.length < variants.length) nullable = true;
      if (nonNull.length === 1) {
        const { [key]: _drop, ...outer } = cur;
        cur = { ...nonNull[0], ...outer };
      }
    }
  }
  if (Array.isArray(cur.type)) {
    const types = (cur.type as string[]).filter((t) => t !== "null");
    if (types.length < cur.type.length) nullable = true;
    if (types.length === 1) cur = { ...cur, type: types[0] };
  }
  return { s: cur, nullable };
}

// "4-15 seconds or 'auto'" style unions become one dropdown; preset-or-custom
// unions keep only the presets. Returns null when that would lose too much.
function choicesFromUnion(s: JSONSchema, root: JSONSchema): (string | number)[] | null {
  const variants = [...(s.anyOf ?? s.oneOf ?? [])].map((v: JSONSchema) => resolveRef(v, root)).filter((v: JSONSchema) => v.type !== "null");
  if (variants.length < 2) return null;
  const out: (string | number)[] = [];
  let sawChoice = false;
  for (const v of variants) {
    if (v.const !== undefined) {
      out.push(v.const);
      sawChoice = true;
    } else if (Array.isArray(v.enum)) {
      out.push(...v.enum);
      sawChoice = true;
    } else if (v.type === "integer" && typeof v.minimum === "number" && typeof v.maximum === "number" && v.maximum - v.minimum <= 60) {
      for (let n = v.minimum; n <= v.maximum; n++) out.push(n);
    } else if (v.type === "object") {
      continue; // custom object option (e.g. explicit width/height); presets cover the common case
    } else {
      return null;
    }
  }
  return sawChoice && out.length ? [...new Set(out)] : null;
}

function exampleFor(raw: JSONSchema, root: JSONSchema, depth = 0): unknown {
  if (depth > 4) return null;
  const { s } = unwrap(raw, root);
  const variants = s.anyOf ?? s.oneOf;
  if (Array.isArray(variants)) {
    const first = variants.map((v: JSONSchema) => resolveRef(v, root)).find((v: JSONSchema) => v.type !== "null");
    return first ? exampleFor(first, root, depth + 1) : null;
  }
  if (s.const !== undefined) return s.const;
  if (s.default !== undefined && s.default !== null) return s.default;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (Array.isArray(s.media_kinds) || s.format === "uri") return "@file:your-upload.jpg";
  switch (s.type) {
    case "string":
      return "";
    case "integer":
    case "number":
      return s.minimum ?? 0;
    case "boolean":
      return false;
    case "array":
      return [exampleFor(s.items ?? {}, root, depth + 1)];
    case "object": {
      const out: Record<string, unknown> = {};
      const req = new Set<string>(s.required ?? []);
      for (const [k, v] of Object.entries((s.properties ?? {}) as Record<string, JSONSchema>)) {
        if (req.size && !req.has(k)) continue;
        out[k] = exampleFor(v, root, depth + 1);
      }
      return out;
    }
    default:
      return null;
  }
}

function guessKinds(name: string): MediaKind[] {
  const n = name.toLowerCase();
  if (/audio|sound|music|voice|speech/.test(n)) return ["audio"];
  if (/video|clip|footage/.test(n)) return ["video"];
  if (/image|frame|mask|photo|img|picture|logo/.test(n)) return ["image"];
  return ["image", "video"];
}

function isMediaString(name: string, s: JSONSchema): MediaKind[] | null {
  if (s.type !== "string") return null;
  if (Array.isArray(s.media_kinds) && s.media_kinds.length) return s.media_kinds as MediaKind[];
  const looksUrl = s.format === "uri" || (typeof s.pattern === "string" && s.pattern.startsWith("^https?"));
  if (!looksUrl || NOT_MEDIA.test(name)) return null;
  return guessKinds(name);
}

function humanize(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\burls?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

export function schemaToFields(schema: JSONSchema | null | undefined): FormField[] {
  if (!schema || typeof schema !== "object") return [];
  const root = schema;
  const props: Record<string, JSONSchema> = schema.properties ?? {};
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const fields: FormField[] = [];

  for (const [name, raw] of Object.entries(props)) {
    const { s } = unwrap(raw, root);
    const base = {
      name,
      label: humanize(name) || name,
      description: s.description ?? raw.description,
      required: required.has(name),
      defaultValue: raw.default ?? s.default,
      schema: s,
    };
    // Some schemas use a const discriminator; nothing for the user to set.
    if (s.const !== undefined) continue;

    const mediaKinds = isMediaString(name, s);
    const unionChoices = s.anyOf || s.oneOf ? choicesFromUnion(s, root) : null;
    if (unionChoices) {
      fields.push({ ...base, kind: "enum", enumValues: unionChoices });
    } else if (PROMPT_NAMES.has(name) && s.type === "string") {
      fields.push({ ...base, kind: "prompt", maxLength: s.maxLength });
    } else if (mediaKinds) {
      fields.push({ ...base, kind: "media", mediaKinds });
    } else if (Array.isArray(s.enum) && s.enum.length) {
      fields.push({ ...base, kind: "enum", enumValues: s.enum });
    } else if (s.type === "boolean") {
      fields.push({ ...base, kind: "boolean" });
    } else if (s.type === "integer" || s.type === "number") {
      fields.push({
        ...base,
        kind: s.type,
        min: s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum : undefined),
        max: s.maximum ?? (s.exclusiveMaximum !== undefined ? s.exclusiveMaximum : undefined),
        step: s.multipleOf ?? (s.type === "integer" ? 1 : undefined),
      });
    } else if (s.type === "string") {
      const long = /prompt|text|script|description|caption|lyrics/i.test(name) || (s.maxLength ?? 0) > 200;
      fields.push({ ...base, kind: long ? "textarea" : "text", maxLength: s.maxLength });
    } else if (s.type === "array") {
      const item = unwrap(s.items ?? {}, root).s;
      const itemMedia = isMediaString(name, item);
      if (itemMedia) {
        fields.push({ ...base, kind: "mediaList", mediaKinds: itemMedia, minItems: s.minItems, maxItems: s.maxItems });
      } else if (item.type === "string" && !item.enum) {
        fields.push({ ...base, kind: "stringList", minItems: s.minItems, maxItems: s.maxItems });
      } else if (item.type === "integer" || item.type === "number") {
        fields.push({ ...base, kind: "stringList", minItems: s.minItems, maxItems: s.maxItems, numericItems: true });
      } else {
        fields.push({ ...base, kind: "json" });
      }
    } else {
      fields.push({ ...base, kind: "json" });
    }
    const last = fields[fields.length - 1];
    if (last?.name === name && last.kind === "json") last.example = JSON.stringify(exampleFor(raw, root), null, 2);
  }

  const order: Record<FieldKind, number> = {
    prompt: 0, media: 1, mediaList: 1, textarea: 2, text: 3, enum: 4, integer: 4, number: 4,
    boolean: 5, stringList: 6, json: 7,
  };
  return fields.sort((a, b) => order[a.kind] - order[b.kind] || Number(b.required) - Number(a.required));
}

export function initialValue(f: FormField): unknown {
  if (f.kind === "media" || f.kind === "mediaList") return [];
  if (f.kind === "json") return f.defaultValue === undefined || f.defaultValue === null ? "" : JSON.stringify(f.defaultValue, null, 2);
  if (f.kind === "stringList") return Array.isArray(f.defaultValue) ? (f.defaultValue as string[]).join("\n") : "";
  return f.defaultValue ?? undefined;
}

// Builds the request body. `media` maps a field name to resolved public URLs.
export function buildInput(
  fields: FormField[],
  values: Record<string, unknown>,
  prompt: string,
  media: Record<string, string[]>,
): { input: Record<string, unknown>; errors: string[] } {
  const input: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const f of fields) {
    const v = values[f.name];
    switch (f.kind) {
      case "prompt":
        if (prompt.trim()) input[f.name] = prompt.trim();
        break;
      case "media": {
        const urls = media[f.name] ?? [];
        if (urls[0]) input[f.name] = urls[0];
        break;
      }
      case "mediaList": {
        const urls = media[f.name] ?? [];
        if (urls.length) input[f.name] = f.maxItems ? urls.slice(0, f.maxItems) : urls;
        if (f.minItems && urls.length && urls.length < f.minItems) errors.push(`${f.label} needs at least ${f.minItems} files`);
        break;
      }
      case "integer":
      case "number":
        if (v !== undefined && v !== null && v !== "") {
          const n = Number(v);
          if (Number.isNaN(n)) errors.push(`${f.label} must be a number`);
          else input[f.name] = f.kind === "integer" ? Math.round(n) : n;
        }
        break;
      case "boolean":
        if (typeof v === "boolean") input[f.name] = v;
        break;
      case "enum":
        if (v !== undefined && v !== null && v !== "") {
          // Select boxes hand back strings; map back to the schema's real value type.
          const match = f.enumValues?.find((e) => String(e) === String(v));
          input[f.name] = match ?? v;
        }
        break;
      case "stringList": {
        const items = String(v ?? "")
          .split(f.numericItems ? /[\n,]/ : "\n")
          .map((x) => x.trim())
          .filter(Boolean);
        if (f.numericItems && items.some((x) => Number.isNaN(Number(x)))) errors.push(`${f.label} must be numbers`);
        else if (items.length) input[f.name] = f.numericItems ? items.map(Number) : items;
        break;
      }
      case "json": {
        const text = String(v ?? "").trim();
        if (text) {
          try {
            input[f.name] = JSON.parse(text);
          } catch {
            errors.push(`${f.label} is not valid JSON`);
          }
        }
        break;
      }
      default:
        if (typeof v === "string" && v.trim()) input[f.name] = v;
    }
    if (f.required && input[f.name] === undefined) {
      errors.push(`${f.label} is required`);
    }
  }
  return { input, errors };
}

// JSON fields can reference uploads as "@file:<name>"; these get swapped for
// hosted URLs at generate time.
export function collectFileRefs(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") {
    const m = /^@file:(.+)$/.exec(v.trim());
    if (m) out.add(m[1]);
  } else if (Array.isArray(v)) v.forEach((x) => collectFileRefs(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectFileRefs(x, out));
  return out;
}

export function replaceFileRefs(v: unknown, urls: Record<string, string>): unknown {
  if (typeof v === "string") {
    const m = /^@file:(.+)$/.exec(v.trim());
    return m && urls[m[1]] ? urls[m[1]] : v;
  }
  if (Array.isArray(v)) return v.map((x) => replaceFileRefs(x, urls));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replaceFileRefs(x, urls)]));
  return v;
}
