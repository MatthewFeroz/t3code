import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  SNAPSHOT_MAX_AGE,
  WIDGET_REFRESH_INTERVAL,
  createWidgetRefresher,
  subscriptionUsageProps,
  subscriptionUsageTimeline,
} from "./subscriptionUsageSnapshot";

const now = Date.parse("2026-09-12T12:00:00Z");
function account(driver: string, usedPercent = 25): LimitAccount {
  return {
    key: driver,
    driver: ProviderDriverKind.make(driver),
    displayName: null,
    email: "private@example.com",
    plan: undefined,
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: {
      checkedAt: new Date(now).toISOString(),
      windows: [
        {
          id: "session",
          kind: "session",
          label: "Session",
          usedPercent,
          resetsAt: new Date(now + 60 * 60_000).toISOString(),
        },
      ],
    },
  };
}

describe("subscription usage widget", () => {
  it("shows remaining quota for both providers without copying account identities", () => {
    const props = subscriptionUsageProps([account("codex"), account("claudeAgent", 100)], now);
    expect(props.providers.map((p) => [p.name, p.windows[0]?.remaining])).toEqual([
      ["Codex", 75],
      ["Claude", 0],
    ]);
    expect(JSON.stringify(props)).not.toContain("private@example.com");
  });

  it("labels multiple accounts as a pool", () => {
    const second = { ...account("codex", 75), key: "second" };
    const provider = subscriptionUsageProps([account("codex"), second], now).providers[0]!;
    expect(provider.detail).toBe("2 accounts · pooled");
    expect(provider.windows[0]?.remaining).toBe(50);
  });

  it("keeps model-specific limits and unknown reset times", () => {
    const original = account("claudeAgent");
    const scoped = {
      ...original,
      limits: {
        ...original.limits,
        windows: [
          ...original.limits.windows,
          {
            id: "seven_day_opus",
            kind: "weekly" as const,
            label: "Weekly · Opus",
            usedPercent: 40,
          },
        ],
      },
    };
    const windows = subscriptionUsageProps([scoped], now).providers[1]!.windows;
    expect(windows).toHaveLength(2);
    expect(windows.find((window) => window.label === "Weekly · Opus")).toEqual({
      label: "Weekly · Opus",
      remaining: 60,
      reset: "Reset time unavailable",
    });
  });

  it("does not extend freshness when the same old snapshot is received again", () => {
    const timeline = subscriptionUsageTimeline(
      subscriptionUsageProps([account("codex")], now),
      now + 4 * 60_000,
    );
    expect(timeline[0]!.props.checkedAt).toBe(now);
    expect(timeline.at(-1)!.date.getTime()).toBe(now + SNAPSHOT_MAX_AGE);
    expect(subscriptionUsageProps([], now).providers.every((p) => p.windows.length === 0)).toBe(
      true,
    );
  });

  it("expires each provider separately, including at reset, without inventing a refill", () => {
    const original = account("codex");
    const reset = now + 60_000;
    const codex = {
      ...original,
      limits: {
        ...original.limits,
        windows: [{ ...original.limits.windows[0]!, resetsAt: new Date(reset).toISOString() }],
      },
    };
    const timeline = subscriptionUsageTimeline(
      subscriptionUsageProps([codex, account("claudeAgent")], now),
      now,
    );
    expect(timeline.map((entry) => entry.date.getTime())).toEqual([
      now,
      reset,
      now + SNAPSHOT_MAX_AGE,
    ]);
    expect(timeline[1]?.props.providers[0]?.windows).toEqual([]);
    expect(timeline[1]?.props.providers[1]?.windows[0]?.remaining).toBe(75);
    expect(timeline[2]?.props.providers.every((provider) => provider.windows.length === 0)).toBe(
      true,
    );
  });

  it("shows unknown for missing data and asks for refresh for stale data", () => {
    expect(subscriptionUsageProps([], now).providers.every((p) => p.windows.length === 0)).toBe(
      true,
    );
    const stale = subscriptionUsageProps([account("codex")], now + SNAPSHOT_MAX_AGE);
    expect(stale.providers[0]?.detail).toBe("Open T3 to refresh");
    expect(stale.providers[0]?.windows).toEqual([]);
  });
});

describe("widget refresh probes", () => {
  it("throttles each connected environment independently and retries failures", async () => {
    const probe = vi
      .fn<(id: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const refresh = createWidgetRefresher(probe);
    await refresh([], now);
    expect(probe).not.toHaveBeenCalled();
    await refresh(["first"], now);
    await refresh(["first", "second"], now + 1);
    expect(probe.mock.calls).toEqual([["first"], ["second"]]);
    await refresh(["first"], now + WIDGET_REFRESH_INTERVAL);
    expect(probe.mock.calls).toEqual([["first"], ["second"], ["first"]]);
  });

  it("does not overlap a slow probe even after the refresh interval", async () => {
    let finish!: () => void;
    const probe = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const refresh = createWidgetRefresher(probe);
    const first = refresh(["one", "one"], now);
    await refresh(["one"], now + WIDGET_REFRESH_INTERVAL);
    expect(probe).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });
});
