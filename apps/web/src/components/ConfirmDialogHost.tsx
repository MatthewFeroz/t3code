import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  registerConfirmDialogHost,
  respondToConfirmDialog,
  subscribeConfirmDialog,
} from "../confirmDialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { ToolCallDetails } from "./ToolCallRequest";

type ConfirmationCopy = {
  readonly title: string;
  readonly description: string | null;
};

function resolveConfirmDialogCopy(message: string): ConfirmationCopy {
  const normalizedMessage = message.trim();
  const lines = normalizedMessage.split("\n");
  const questionLineIndex = lines.findIndex((line) => line.trim().endsWith("?"));

  if (questionLineIndex >= 0) {
    const title = lines[questionLineIndex]!.trim();
    const description = lines
      .filter((_, index) => index !== questionLineIndex)
      .join("\n")
      .trim();
    return { title, description: description || null };
  }

  const questionMarkIndex = normalizedMessage.indexOf("?");
  if (questionMarkIndex >= 0) {
    return {
      title: normalizedMessage.slice(0, questionMarkIndex + 1).trim(),
      description: normalizedMessage.slice(questionMarkIndex + 1).trim() || null,
    };
  }

  return {
    title: "Confirm action",
    description: normalizedMessage || "This action requires your confirmation.",
  };
}

export function ConfirmDialogHost() {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const state = useSyncExternalStore(
    subscribeConfirmDialog,
    readConfirmDialogState,
    readConfirmDialogState,
  );

  useEffect(() => registerConfirmDialogHost(), []);

  const message = state.status === "idle" ? "" : state.message;
  const toolCall = state.status === "idle" ? undefined : state.toolCall;
  const [requestView, setRequestView] = useState({ toolCall, key: 0 });
  if (requestView.toolCall !== toolCall) {
    setRequestView({ toolCall, key: requestView.key + 1 });
  }
  // A tool call's message is already the question; its description is the tool's.
  const copy: ConfirmationCopy = toolCall
    ? { title: message, description: null }
    : resolveConfirmDialogCopy(message);
  const confirmVariant = state.status === "idle" ? "default" : state.variant;
  const onCancel = () => respondToConfirmDialog(false);
  const onConfirm = () => respondToConfirmDialog(true);

  return (
    <AlertDialog
      open={state.status === "confirming"}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) completeConfirmDialogClose();
      }}
    >
      <AlertDialogPopup initialFocus={cancelRef}>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            {copy.description ? (
              <AlertDialogDescription className="whitespace-pre-line">
                {copy.description}
              </AlertDialogDescription>
            ) : null}
            {toolCall ? <ToolCallDetails key={requestView.key} toolCall={toolCall} /> : null}
          </AlertDialogHeader>
        </div>
        <div className="shrink-0">
          <AlertDialogFooter>
            <AlertDialogClose ref={cancelRef} render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button variant={confirmVariant} onClick={onConfirm}>
              Confirm
            </Button>
          </AlertDialogFooter>
        </div>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
