import { describe, expect, it } from "vite-plus/test";

import { mcpAppToolCallHighlights, summarizeMcpAppToolCall } from "./toolCall.ts";

// Excalidraw's definition, as its server lists it.
const exportTool = {
  name: "export_to_excalidraw",
  description: "Upload diagram to excalidraw.com and return shareable URL.",
  inputSchema: {
    type: "object",
    properties: { json: { type: "string", description: "Serialized Excalidraw JSON" } },
    required: ["json"],
  },
};

describe("summarizeMcpAppToolCall", () => {
  it("says what the tool does from the server's definition", () => {
    expect(
      summarizeMcpAppToolCall({ server: "excalidraw", name: exportTool.name, tool: exportTool }),
    ).toEqual({
      question: "Allow excalidraw to run Export to excalidraw?",
      identifier: "excalidraw · export_to_excalidraw",
      description: "Upload diagram to excalidraw.com and return shareable URL.",
      argumentDescriptions: { json: "Serialized Excalidraw JSON" },
    });
  });

  it("prefers the annotation title, then the definition's title, over the name", () => {
    const tool = { ...exportTool, title: "Share on excalidraw.com" };
    expect(
      summarizeMcpAppToolCall({ server: "excalidraw", name: tool.name, title: "Export", tool })
        .question,
    ).toBe("Allow excalidraw to run Export?");
    expect(summarizeMcpAppToolCall({ server: "excalidraw", name: tool.name, tool }).question).toBe(
      "Allow excalidraw to run Share on excalidraw.com?",
    );
  });

  it("reads camelCase and kebab-case names", () => {
    expect(summarizeMcpAppToolCall({ server: "s", name: "saveCheckpoint" }).question).toBe(
      "Allow s to run Save checkpoint?",
    );
    expect(summarizeMcpAppToolCall({ server: "s", name: "save-checkpoint" }).question).toBe(
      "Allow s to run Save checkpoint?",
    );
  });

  it("falls back to the name alone when the server describes nothing", () => {
    expect(
      summarizeMcpAppToolCall({
        server: "s",
        name: "save_checkpoint",
        tool: {
          name: "save_checkpoint",
          description: " ",
          inputSchema: { properties: { id: {} } },
        },
      }),
    ).toEqual({
      question: "Allow s to run Save checkpoint?",
      identifier: "s · save_checkpoint",
      argumentDescriptions: {},
    });
  });
});

describe("mcpAppToolCallHighlights", () => {
  // The PDF app's save call: the path is what the user is approving.
  it("surfaces the short arguments a call acts on and leaves payloads in the request", () => {
    expect(
      mcpAppToolCallHighlights({
        url: "file:///tmp/signed-contract.pdf",
        data: "JVBERi0xLjcK".repeat(40),
        overwrite: true,
        options: { flatten: true },
        notes: "line one\nline two",
        scene: '{"type":"excalidraw"}',
      }),
    ).toEqual([
      { name: "url", value: "file:///tmp/signed-contract.pdf" },
      { name: "overwrite", value: "true" },
    ]);
  });
});
