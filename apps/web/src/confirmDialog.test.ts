import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  completeConfirmDialogClose,
  isConfirmDialogActive,
  readConfirmDialogState,
  registerConfirmDialogHost,
  requestConfirmDialog,
  resetConfirmDialogForTests,
  respondToConfirmDialog,
} from "./confirmDialog";

function requireConfirmation(confirmation: Promise<boolean> | undefined): Promise<boolean> {
  if (!confirmation) {
    throw new Error("Expected a registered confirmation host.");
  }
  return confirmation;
}

describe("confirm dialog coordinator", () => {
  beforeEach(() => {
    resetConfirmDialogForTests();
  });

  it("returns undefined until a themed host is mounted", () => {
    expect(requestConfirmDialog("Confirm this action?")).toBeUndefined();
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
  });

  it("resolves a displayed confirmation and waits for its close transition", async () => {
    const unregister = registerConfirmDialogHost();
    const confirmation = requireConfirmation(
      requestConfirmDialog("Delete this thread?", { variant: "destructive" }),
    );

    expect(readConfirmDialogState()).toEqual({
      status: "confirming",
      message: "Delete this thread?",
      variant: "destructive",
    });

    respondToConfirmDialog(true);
    await expect(confirmation).resolves.toBe(true);
    // Still on screen while it closes, so nothing may cover it yet.
    expect(isConfirmDialogActive()).toBe(true);
    expect(readConfirmDialogState()).toEqual({
      status: "closing",
      message: "Delete this thread?",
      variant: "destructive",
    });

    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
    expect(isConfirmDialogActive()).toBe(false);
    unregister();
  });

  it("keeps a queued tool call's details through display and close", async () => {
    const unregister = registerConfirmDialogHost();
    const toolCall = {
      identifier: "excalidraw · export_to_excalidraw",
      highlights: [],
      description: "Upload diagram to excalidraw.com and return shareable URL.",
      arguments: { json: "{}" },
      argumentDescriptions: { json: "Serialized Excalidraw JSON" },
    };
    const first = requireConfirmation(requestConfirmDialog("Delete the project?"));
    const second = requireConfirmation(
      requestConfirmDialog("Allow excalidraw to run Export to excalidraw?", { toolCall }),
    );

    respondToConfirmDialog(false);
    await expect(first).resolves.toBe(false);
    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({
      status: "confirming",
      message: "Allow excalidraw to run Export to excalidraw?",
      variant: "default",
      toolCall,
    });

    respondToConfirmDialog(true);
    await expect(second).resolves.toBe(true);
    // The closing dialog keeps its content rather than flashing the plain layout.
    expect(readConfirmDialogState()).toMatchObject({ status: "closing", toolCall });
    unregister();
  });

  it("serializes concurrent confirmations", async () => {
    const unregister = registerConfirmDialogHost();
    const first = requireConfirmation(requestConfirmDialog("Delete the project?"));
    const second = requireConfirmation(requestConfirmDialog("Delete the worktree too?"));

    respondToConfirmDialog(false);
    await expect(first).resolves.toBe(false);
    expect(readConfirmDialogState()).toEqual({
      status: "closing",
      message: "Delete the project?",
      variant: "default",
    });

    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({
      status: "confirming",
      message: "Delete the worktree too?",
      variant: "default",
    });

    respondToConfirmDialog(true);
    await expect(second).resolves.toBe(true);
    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
    unregister();
  });

  it("cancels active and queued confirmations if the last host unmounts", async () => {
    const unregister = registerConfirmDialogHost();
    const active = requireConfirmation(requestConfirmDialog("Delete the thread?"));
    const queued = requireConfirmation(requestConfirmDialog("Delete the worktree too?"));

    unregister();

    await expect(Promise.all([active, queued])).resolves.toEqual([false, false]);
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
  });

  it("ignores responses after the active dialog has been closed", () => {
    const unregister = registerConfirmDialogHost();
    const confirmation = requireConfirmation(requestConfirmDialog("Continue?"));

    respondToConfirmDialog(true);
    respondToConfirmDialog(false);
    completeConfirmDialogClose();

    expect(readConfirmDialogState()).toEqual({ status: "idle" });
    unregister();
    return expect(confirmation).resolves.toBe(true);
  });
});
