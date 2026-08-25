import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { RevealInFileManagerInput } from "./editor.ts";

const decodeRevealInFileManagerInput = Schema.decodeUnknownSync(RevealInFileManagerInput);

describe("RevealInFileManagerInput", () => {
  it("preserves leading and trailing spaces in valid file paths", () => {
    expect(decodeRevealInFileManagerInput({ path: " /tmp/report " })).toEqual({
      path: " /tmp/report ",
    });
  });

  it("rejects an empty path", () => {
    expect(() => decodeRevealInFileManagerInput({ path: "" })).toThrow();
  });
});
