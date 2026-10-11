import type { ConfirmDialogOptions, ConfirmDialogVariant } from "@t3tools/contracts";

/**
 * A confirmation about a tool call: the message is the question, and the
 * dialog adds what the tool does and its arguments, folded.
 */
export interface ConfirmDialogToolCall {
  readonly description?: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly argumentDescriptions: Readonly<Record<string, string>>;
}

export type ConfirmDialogState =
  | { readonly status: "idle" }
  | ({ readonly status: "confirming" } & ConfirmDialogContent)
  | ({ readonly status: "closing" } & ConfirmDialogContent);

type ConfirmDialogContent = {
  readonly message: string;
  readonly variant: ConfirmDialogVariant;
  readonly toolCall?: ConfirmDialogToolCall;
};

type PendingConfirmation = ConfirmDialogContent & {
  readonly resolve: (confirmed: boolean) => void;
};

const contentOf = (pending: PendingConfirmation): ConfirmDialogContent => ({
  message: pending.message,
  variant: pending.variant,
  ...(pending.toolCall === undefined ? {} : { toolCall: pending.toolCall }),
});

const idleState: ConfirmDialogState = { status: "idle" };
let state: ConfirmDialogState = idleState;
let activeConfirmation: PendingConfirmation | null = null;
let queuedConfirmations: PendingConfirmation[] = [];
let registeredHostCount = 0;
const listeners = new Set<() => void>();

function publish(next: ConfirmDialogState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function resolvePendingConfirmations(confirmed: boolean): void {
  activeConfirmation?.resolve(confirmed);
  for (const confirmation of queuedConfirmations) {
    confirmation.resolve(confirmed);
  }
  activeConfirmation = null;
  queuedConfirmations = [];
}

export function readConfirmDialogState(): ConfirmDialogState {
  return state;
}

export function subscribeConfirmDialog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Registers the renderer host that can present themed confirmations. The
 * returned cleanup function also cancels any request left without a host.
 */
export function registerConfirmDialogHost(): () => void {
  registeredHostCount += 1;
  let registered = true;

  return () => {
    if (!registered) return;
    registered = false;
    registeredHostCount = Math.max(0, registeredHostCount - 1);

    if (registeredHostCount === 0) {
      resolvePendingConfirmations(false);
      publish(idleState);
    }
  };
}

/**
 * Requests a themed confirmation when a host is mounted. An undefined result
 * means no themed host is currently available.
 */
export function requestConfirmDialog(
  message: string,
  options?: ConfirmDialogOptions & { readonly toolCall?: ConfirmDialogToolCall },
): Promise<boolean> | undefined {
  if (registeredHostCount === 0) return undefined;

  const confirmation = new Promise<boolean>((resolve) => {
    const pending = {
      message,
      variant: options?.variant ?? "default",
      ...(options?.toolCall === undefined ? {} : { toolCall: options.toolCall }),
      resolve,
    } satisfies PendingConfirmation;
    if (activeConfirmation || state.status === "closing") {
      queuedConfirmations.push(pending);
      return;
    }

    activeConfirmation = pending;
    publish({ status: "confirming", ...contentOf(pending) });
  });

  return confirmation;
}

/** True while a confirmation is shown, closing, or waiting to be shown. */
export function isConfirmDialogActive(): boolean {
  return state.status !== "idle" || activeConfirmation !== null || queuedConfirmations.length > 0;
}

export function respondToConfirmDialog(confirmed: boolean): void {
  if (state.status !== "confirming" || !activeConfirmation) return;

  const confirmation = activeConfirmation;
  activeConfirmation = null;
  confirmation.resolve(confirmed);
  publish({ ...state, status: "closing" });
}

export function completeConfirmDialogClose(): void {
  if (state.status !== "closing") return;

  const next = queuedConfirmations.shift();
  if (!next) {
    publish(idleState);
    return;
  }

  activeConfirmation = next;
  publish({ status: "confirming", ...contentOf(next) });
}

export function resetConfirmDialogForTests(): void {
  resolvePendingConfirmations(false);
  registeredHostCount = 0;
  publish(idleState);
  listeners.clear();
}
