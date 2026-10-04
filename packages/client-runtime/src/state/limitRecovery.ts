// @effect-diagnostics globalDate:off -- Resume labels use the viewer's local calendar and timezone.
import type { EnvironmentThreadShell } from "./models.ts";

/** Only a persisted recovery for the current usage-limit stop promises a restart. */
export function resolveScheduledLimitResume(
  thread: Pick<
    EnvironmentThreadShell,
    "runtime" | "latestRun" | "limitRecovery" | "archivedAt" | "settledOverride"
  >,
  now = new Date(),
) {
  const recovery = thread.limitRecovery;
  if (
    thread.runtime?.status !== "failed" ||
    thread.runtime.lastErrorClass !== "usage_limit" ||
    thread.archivedAt !== null ||
    thread.settledOverride === "settled" ||
    !recovery?.autoResume ||
    recovery.runId !== thread.latestRun?.runId ||
    recovery.resetAt !== thread.runtime.usageLimitResetAt
  )
    return null;
  const reset = new Date(recovery.resetAt);
  if (!Number.isFinite(reset.getTime())) return null;
  const sameDay =
    reset.getFullYear() === now.getFullYear() &&
    reset.getMonth() === now.getMonth() &&
    reset.getDate() === now.getDate();
  const time = reset.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const date = reset.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(reset.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
  });
  return {
    label: sameDay ? time : `${date}, ${time}`,
    accessibilityLabel: sameDay ? `Resumes at ${time}` : `Resumes ${date}, ${time}`,
    description: `Automatically resumes when usage resets at ${reset.toLocaleString(undefined, { timeZoneName: "short" })}`,
  };
}
