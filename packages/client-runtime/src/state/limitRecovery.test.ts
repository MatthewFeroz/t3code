// @effect-diagnostics globalDate:off -- Exercise viewer-local calendar formatting.
import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, RunId } from "@t3tools/contracts";
import { resolveScheduledLimitResume } from "./limitRecovery.ts";

const runId = RunId.make("limited-run");
const now = new Date(2026, 9, 4, 1);
const resetAt = new Date(2026, 9, 4, 4).toISOString();
const thread = {
  archivedAt: null,
  settledOverride: null,
  runtime: {
    status: "failed" as const,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: null,
    lastError: "Usage limit reached",
    lastErrorClass: "usage_limit" as const,
    usageLimitResetAt: resetAt,
    updatedAt: now.toISOString(),
  },
  latestRun: {
    runId,
    status: "failed" as const,
    requestedAt: now.toISOString(),
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    assistantMessageId: null,
  },
  limitRecovery: { runId, resetAt, autoResume: true },
};

describe("scheduled usage-limit resume", () => {
  it("shows the local time for today's reset and the date for another day", () => {
    const time = new Date(resetAt).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(resolveScheduledLimitResume(thread, now)?.label).toBe(`Resumes at ${time}`);
    expect(resolveScheduledLimitResume(thread, new Date(2026, 9, 3, 1))?.label).toContain("Oct 4");
    expect(resolveScheduledLimitResume(thread, now)?.description).toContain(
      "Automatically resumes",
    );
  });
  it("clears the promise after cancellation or when recovery belongs to another stop", () => {
    expect(
      resolveScheduledLimitResume(
        { ...thread, limitRecovery: { ...thread.limitRecovery, autoResume: false } },
        now,
      ),
    ).toBeNull();
    expect(
      resolveScheduledLimitResume(
        { ...thread, limitRecovery: { ...thread.limitRecovery, runId: RunId.make("old-run") } },
        now,
      ),
    ).toBeNull();
    expect(
      resolveScheduledLimitResume(
        {
          ...thread,
          limitRecovery: {
            ...thread.limitRecovery,
            resetAt: new Date(2026, 9, 5, 4).toISOString(),
          },
        },
        now,
      ),
    ).toBeNull();
  });
  it("does not show a scheduled resume once work starts or the thread is settled or archived", () => {
    expect(
      resolveScheduledLimitResume(
        { ...thread, runtime: { ...thread.runtime, status: "running" } },
        now,
      ),
    ).toBeNull();
    expect(resolveScheduledLimitResume({ ...thread, settledOverride: "settled" }, now)).toBeNull();
    expect(
      resolveScheduledLimitResume({ ...thread, archivedAt: now.toISOString() }, now),
    ).toBeNull();
  });
  it("keeps the scheduled label while waiting for a restart after the reset time", () => {
    expect(resolveScheduledLimitResume(thread, new Date(2026, 9, 4, 5))).not.toBeNull();
  });
});
