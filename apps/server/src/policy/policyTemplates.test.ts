import { assert, it } from "@effect/vitest";
import { WINDOWS_POLICY_LISTS, WINDOWS_POLICY_VALUES } from "@t3tools/shared/managedPolicyFile";

import { windowsAdmx } from "./policyTemplates.ts";

it("gives every registry value the Windows reader accepts a Group Policy control", () => {
  const admx = windowsAdmx();
  for (const name of Object.keys(WINDOWS_POLICY_VALUES)) {
    assert.include(admx, `valueName="${name}"`);
  }
  for (const key of Object.keys(WINDOWS_POLICY_LISTS)) {
    assert.include(admx, `key="SOFTWARE\\Policies\\T3Tools\\T3Code\\${key}"`);
  }
});
