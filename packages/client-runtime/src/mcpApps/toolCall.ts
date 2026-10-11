import * as Predicate from "effect/Predicate";

/** What an approval prompt says about a tool call an MCP App asks to make. */
export interface McpAppToolCallSummary {
  /** The prompt's question, naming the server and the tool. */
  readonly question: string;
  /** The server's own description of the tool, when it gives one. */
  readonly description?: string;
  /** Each argument's description from the tool's input schema, by name. */
  readonly argumentDescriptions: Readonly<Record<string, string>>;
}

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

/** `export_to_excalidraw` reads as "Export to excalidraw". */
const readableToolName = (name: string): string => {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.length === 0 ? name : words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Describes a tool call from the server's MCP `Tool` definition, so an
 * approval can say what the tool does instead of printing its arguments.
 * `title` is the annotation title T3 already resolved; the definition's own
 * `title` comes next, then a readable form of the tool's name.
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
    ...(description === undefined ? {} : { description }),
    argumentDescriptions,
  };
}
