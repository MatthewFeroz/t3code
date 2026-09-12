import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  presentations: new Map<string, { connection: { phase: string } }>(),
  appState: "active",
  listeners: new Set<() => void>(),
  probe: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.presentations }));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.appState;
    },
    addEventListener: (_: string, listener: () => void) => {
      state.listeners.add(listener);
      return { remove: () => state.listeners.delete(listener) };
    },
  },
}));
vi.mock("../state/presentation", () => ({ environmentPresentations: { presentationsAtom: {} } }));
vi.mock("../state/server", () => ({ serverEnvironment: { refreshProviders: {} } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.probe }));

import { useSubscriptionUsage } from "./useSubscriptionUsage";
import { WIDGET_REFRESH_INTERVAL } from "./subscriptionUsageSnapshot";

function Harness({ enabled = true }: { enabled?: boolean }) {
  useSubscriptionUsage(enabled);
  return null;
}
let renderer: ReactTestRenderer | undefined;
async function transition(phase: string) {
  await act(async () => {
    state.appState = phase;
    for (const listener of state.listeners) listener();
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  state.appState = "active";
  state.presentations = new Map([
    ["online", { connection: { phase: "connected" } }],
    ["offline", { connection: { phase: "disconnected" } }],
  ]);
  state.probe.mockReset().mockResolvedValue({ _tag: "Success" });
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  vi.useRealTimers();
  expect(state.listeners.size).toBe(0);
});

describe("mounted widget refresh lifecycle", () => {
  it("refreshes connected hosts, pauses in background, resumes, and cleans up", async () => {
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    expect(state.probe.mock.calls).toEqual([[{ environmentId: "online", input: {} }]]);
    await transition("background");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WIDGET_REFRESH_INTERVAL * 3);
    });
    expect(state.probe).toHaveBeenCalledTimes(1);
    await transition("active");
    expect(state.probe).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WIDGET_REFRESH_INTERVAL);
    });
    expect(state.probe).toHaveBeenCalledTimes(3);
    await act(async () => {
      renderer!.unmount();
      renderer = undefined;
    });
    await vi.advanceTimersByTimeAsync(WIDGET_REFRESH_INTERVAL);
    expect(state.probe).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles reconnects and repeated config emissions without a request storm", async () => {
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => {
      state.presentations = new Map([
        ["online", { connection: { phase: "connected" } }],
        ["offline", { connection: { phase: "connected" } }],
      ]);
      renderer!.update(createElement(Harness));
    });
    expect(state.probe).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 5; index++) {
      await act(async () => {
        state.presentations = new Map(state.presentations);
        renderer!.update(createElement(Harness));
      });
    }
    expect(state.probe).toHaveBeenCalledTimes(2);
    await act(async () => {
      state.presentations = new Map();
      renderer!.update(createElement(Harness));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WIDGET_REFRESH_INTERVAL * 2);
    });
    expect(state.probe).toHaveBeenCalledTimes(2);
  });
  it("waits for catalog readiness before probing", async () => {
    await act(async () => {
      renderer = create(createElement(Harness, { enabled: false }));
      await vi.advanceTimersByTimeAsync(WIDGET_REFRESH_INTERVAL);
    });
    expect(state.probe).not.toHaveBeenCalled();
    await act(async () => {
      renderer!.update(createElement(Harness, { enabled: true }));
    });
    expect(state.probe).toHaveBeenCalledOnce();
  });
});
