import * as Predicate from "effect/Predicate";

/** What an approval prompt says about a tool call an MCP App asks to make. */
export interface McpAppToolCallSummary {
  /** The prompt's question, naming the server and the tool. */
  readonly question: string;
  /** The exact server and tool, which the readable question may not show. */
  readonly identifier: string;
  /** The server's own description of the tool, when it gives one. */
  readonly description?: string;
  /** Each argument's description from the tool's input schema, by name. */
  readonly argumentDescriptions: Readonly<Record<string, string>>;
}

/** A short top-level argument shown without opening the request. */
export interface McpAppToolCallHighlight {
  readonly name: string;
  readonly value: string;
}

const HIGHLIGHT_MAX_LENGTH = 120;
const HIGHLIGHT_MAX_COUNT = 6;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

/** `export_to_excalidraw` reads as "Export to excalidraw". */
const readableToolName = (name: string): string => {
  const words = name
    .replace(/[_.-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.length === 0 ? name : words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Describes a tool call from the server's MCP `Tool` definition, so an
 * approval can say what the tool does instead of printing its arguments.
 * `title` is the annotation title T3 already resolved; the definition's own
 * `title` comes next, then a readable form of the tool's name. The title and
 * description are the server's claims, so callers show `identifier` too.
 */
export function summarizeMcpAppToolCall(input: {
  readonly server: string;
  readonly name: string;
  readonly title?: string | undefined;
  readonly tool?: unknown;
}): McpAppToolCallSummary {
  const tool = Predicate.isObject(input.tool) ? input.tool : undefined;
  const label =
    nonEmptyString(input.title) ?? nonEmptyString(tool?.title) ?? readableToolName(input.name);
  const description = nonEmptyString(tool?.description);

  const argumentDescriptions: Record<string, string> = {};
  const schema = Predicate.isObject(tool?.inputSchema) ? tool.inputSchema : undefined;
  if (Predicate.isObject(schema?.properties)) {
    for (const [name, property] of Object.entries(schema.properties)) {
      const text = Predicate.isObject(property) ? nonEmptyString(property.description) : undefined;
      if (text !== undefined) argumentDescriptions[name] = text;
    }
  }

  return {
    question: `Allow ${input.server} to run ${label}?`,
    identifier: `${input.server} · ${input.name}`,
    ...(description === undefined ? {} : { description }),
    argumentDescriptions,
  };
}

/**
 * The top-level arguments that fit on one line: usually what the call acts on,
 * such as a path, URL, or name. The tool's description says what a tool can
 * do; these say what this call will do it to. Everything else waits behind
 * the full request.
 */
export function mcpAppToolCallHighlights(
  args: Readonly<Record<string, unknown>>,
): ReadonlyArray<McpAppToolCallHighlight> {
  const highlights: McpAppToolCallHighlight[] = [];
  for (const [name, value] of Object.entries(args)) {
    if (highlights.length === HIGHLIGHT_MAX_COUNT) break;
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      highlights.push({ name, value: String(value) });
      continue;
    }
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (
      text.length > 0 &&
      text.length <= HIGHLIGHT_MAX_LENGTH &&
      !/[\r\n]/.test(text) &&
      !text.startsWith("{") &&
      !text.startsWith("[")
    ) {
      highlights.push({ name, value: text });
    }
  }
  return highlights;
}
