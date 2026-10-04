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
  snoozedUntil: null,
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
    expect(resolveScheduledLimitResume(thread, now)?.label).toBe(time);
    expect(resolveScheduledLimitResume(thread, new Date(2026, 9, 3, 1))?.label).toContain("Oct 4");
    expect(resolveScheduledLimitResume(thread, now)?.description).toContain(
      "Auto-resume scheduled",
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
  it("shows a later snooze time because recovery cannot start before the thread wakes", () => {
    const snoozedUntil = new Date(2026, 9, 5, 4).toISOString();
    const later = resolveScheduledLimitResume({ ...thread, snoozedUntil }, now);
    const nextDay = resolveScheduledLimitResume(
      {
        ...thread,
        runtime: { ...thread.runtime, usageLimitResetAt: snoozedUntil },
        limitRecovery: { ...thread.limitRecovery, resetAt: snoozedUntil },
      },
      now,
    );
    expect(later?.label).toBe(nextDay?.label);
    expect(later?.label).toContain("Oct 5");
    expect(
      resolveScheduledLimitResume({ ...thread, snoozedUntil: now.toISOString() }, now)?.label,
    ).toBe(resolveScheduledLimitResume(thread, now)?.label);
  });
  it("does not promise recovery when it is missing, invalid, or belongs to a different failure", () => {
    expect(resolveScheduledLimitResume({ ...thread, limitRecovery: null }, now)).toBeNull();
    expect(
      resolveScheduledLimitResume(
        { ...thread, runtime: { ...thread.runtime, lastErrorClass: "provider_error" } },
        now,
      ),
    ).toBeNull();
    expect(
      resolveScheduledLimitResume(
        {
          ...thread,
          runtime: { ...thread.runtime, usageLimitResetAt: "invalid" },
          limitRecovery: { ...thread.limitRecovery, resetAt: "invalid" },
        },
        now,
      ),
    ).toBeNull();
  });
  it("keeps the scheduled label while waiting for a restart after the reset time", () => {
    expect(resolveScheduledLimitResume(thread, new Date(2026, 9, 4, 5))).not.toBeNull();
  });
});
