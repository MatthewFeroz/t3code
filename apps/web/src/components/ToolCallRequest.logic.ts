import * as Predicate from "effect/Predicate";

// Fields that usually name what an item is, in the order a summary uses them.
const SUMMARY_FIELDS = ["type", "kind", "name", "title", "text", "label", "id"] as const;
const PREVIEW_LENGTH = 120;

/**
 * A string argument that holds JSON, such as a serialized document, reads as
 * the data it carries. Anything else stays as it is.
 */
export function parseEmbeddedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

/** One line for an object or list: what it is, not everything in it. */
export function summarizeRequestValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
  if (!Predicate.isObject(value)) return previewRequestScalar(value);
  const named = SUMMARY_FIELDS.map((field) => value[field])
    .filter((field): field is string => typeof field === "string" && field.trim().length > 0)
    .slice(0, 2);
  if (named.length > 0) return named.join(" · ");
  const size = Object.keys(value).length;
  if (size === 0) return "empty";
  return size === 1 ? "1 field" : `${size} fields`;
}

/** For a list of typed items, how many of each: "text ×6, rectangle ×5". */
export function countRequestItemTypes(items: ReadonlyArray<unknown>): string | undefined {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (Predicate.isObject(item) && typeof item.type === "string") {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return undefined;
  return [...counts].map(([type, count]) => `${type} ×${count}`).join(", ");
}

/** A scalar on one line, with long text cut short and its full length noted. */
export function previewRequestScalar(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  if (text.length <= PREVIEW_LENGTH) return text;
  return `${text.slice(0, PREVIEW_LENGTH)}… (${text.length.toLocaleString()} characters)`;
}

export function formatRequestSize(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
