import { describe, expect, it } from "vite-plus/test";

import {
  countRequestItemTypes,
  formatRequestSize,
  parseEmbeddedJson,
  previewRequestScalar,
  summarizeRequestValue,
} from "./request.ts";

describe("parseEmbeddedJson", () => {
  it("unpacks a string that holds a JSON object or list", () => {
    expect(parseEmbeddedJson('{\n  "type": "excalidraw"\n}')).toEqual({ type: "excalidraw" });
    expect(parseEmbeddedJson(" [1, 2]")).toEqual([1, 2]);
  });

  it("leaves other values alone", () => {
    expect(parseEmbeddedJson("hello")).toBe("hello");
    expect(parseEmbeddedJson("{not json")).toBe("{not json");
    expect(parseEmbeddedJson("42")).toBe("42");
    expect(parseEmbeddedJson(42)).toBe(42);
  });
});

describe("summarizeRequestValue", () => {
  it("names an item by the fields that usually say what it is", () => {
    expect(summarizeRequestValue({ id: "a1", type: "arrow", x: 160 })).toBe("arrow · a1");
    expect(summarizeRequestValue({ type: "text", text: "Browser", id: "browser-label" })).toBe(
      "text · Browser",
    );
  });

  it("counts fields or items when nothing names it", () => {
    expect(summarizeRequestValue({ gridSize: 20, viewBackgroundColor: "#fff" })).toBe("2 fields");
    expect(summarizeRequestValue({})).toBe("empty");
    expect(summarizeRequestValue([1])).toBe("1 item");
  });
});

describe("countRequestItemTypes", () => {
  it("groups typed items", () => {
    expect(
      countRequestItemTypes([{ type: "text" }, { type: "rectangle" }, { type: "text" }, 3]),
    ).toBe("text ×2, rectangle ×1");
  });

  it("says nothing for untyped lists", () => {
    expect(countRequestItemTypes([1, "a", { name: "x" }])).toBeUndefined();
  });
});

describe("previewRequestScalar", () => {
  it("cuts long text to one line and notes its length", () => {
    const preview = previewRequestScalar("x".repeat(5000));
    expect(preview.startsWith("x".repeat(120) + "…")).toBe(true);
    expect(preview).toContain("5,000 characters");
  });

  it("shows short values as they are", () => {
    expect(previewRequestScalar("http://localhost:5855")).toBe("http://localhost:5855");
    expect(previewRequestScalar(null)).toBe("null");
    expect(previewRequestScalar(false)).toBe("false");
  });
});

describe("formatRequestSize", () => {
  it("measures the serialized arguments", () => {
    expect(formatRequestSize({ a: 1 })).toBe("7 B");
    expect(formatRequestSize({ json: "x".repeat(15_000) })).toBe("14.7 KB");
  });
});
