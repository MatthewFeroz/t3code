import type { ReactElement } from "react";
import { EnvironmentId, ProviderDriverKind, type AcpRegistrySearchAgent } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const atoms = vi.hoisted(() => ({
  search: Symbol("acp-search"),
  prepare: Symbol("acp-prepare"),
}));

const state = vi.hoisted(() => ({
  result: null as { readonly agents: ReadonlyArray<AcpRegistrySearchAgent> } | null,
  error: null as string | null,
  isPending: false,
  refresh: vi.fn(),
  search: vi.fn(() => atoms.search),
  prepare: vi.fn(),
}));

const lifecycle = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (cleanup) lifecycle.cleanups.push(cleanup);
    },
    useRef: reactHookHarness.useRef,
    useLayoutEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (cleanup) lifecycle.cleanups.push(cleanup);
    },
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../state/server", () => ({
  serverEnvironment: {
    searchAcpRegistry: state.search,
    prepareAcpRegistryAgent: atoms.prepare,
  },
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: state.result,
    error: state.error,
    isPending: state.isPending,
    refresh: state.refresh,
  }),
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => state.prepare,
}));

vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  isAtomCommandInterrupted: () => false,
  squashAtomCommandFailure: () => new Error("Prepare failed."),
}));

import { AcpRegistrySearchStep } from "./AcpRegistrySearchStep";

const environmentId = EnvironmentId.make("remote-device");
const gemini: AcpRegistrySearchAgent = {
  id: "gemini",
  name: "Gemini CLI",
  version: "1.2.3",
  description: "Google's agent",
  authors: ["Google <gemini-cli@google.com>", "Contributor"],
  license: "Apache-2.0",
  website: "https://example.com/docs",
  repository: "https://example.com/source",
  icon: "https://example.com/icon.png",
  distribution: "npx",
  integrity: "registry",
};

function render(options?: {
  readonly configured?: boolean;
  readonly onPrepared?: (agent: AcpRegistrySearchAgent) => void;
}): ReactElement<Record<string, unknown>> {
  hooks.beginRender();
  return AcpRegistrySearchStep({
    environmentId,
    providerInstances: options?.configured
      ? {
          acpRegistry_gemini: {
            driver: ProviderDriverKind.make("acpRegistry"),
            config: { agentId: "gemini" },
          },
        }
      : {},
    onPrepared: options?.onPrepared ?? vi.fn(),
    onManualConfiguration: vi.fn(),
  }) as ReactElement<Record<string, unknown>>;
}

function findByAriaLabel(
  tree: ReactElement<Record<string, unknown>>,
  label: string,
): ReactElement<Record<string, unknown>> {
  const found = visitElements(tree, (element) => element.props["aria-label"] === label);
  expect(found).not.toBeNull();
  return found!;
}

describe("AcpRegistrySearchStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hooks.reset();
    state.result = null;
    state.error = null;
    state.isPending = false;
    state.refresh.mockReset();
    state.search.mockClear();
    state.prepare.mockReset().mockResolvedValue({
      _tag: "Success",
      value: { agentId: "gemini", version: "1.2.3", distribution: "npx", prepared: true },
    });
    lifecycle.cleanups = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });
  afterEach(() => {
    for (const cleanup of lifecycle.cleanups) cleanup();
    vi.useRealTimers();
  });

  it("loads the catalog once and filters it locally while typing", () => {
    const amp: AcpRegistrySearchAgent = { ...gemini, id: "amp-acp", name: "Amp", authors: [] };
    const piAcp: AcpRegistrySearchAgent = {
      ...gemini,
      id: "pi-acp",
      name: "pi ACP",
      description: "ACP adapter for pi coding agent",
      authors: [],
    };
    state.result = { agents: [amp, gemini, piAcp] };
    const initial = render();
    expect(state.search).toHaveBeenLastCalledWith({ environmentId, input: { query: "" } });
    expect(findByAriaLabel(initial, "Add Amp")).not.toBeNull();

    const input = findByAriaLabel(initial, "Search ACP Registry");
    expect(input.props.size).toBe("sm");
    const type = (value: string) =>
      (input.props.onChange as (event: { currentTarget: { value: string } }) => void)({
        currentTarget: { value },
      });

    type("  pi ");
    const filtered = render();
    expect(state.search).toHaveBeenLastCalledWith({ environmentId, input: { query: "" } });
    expect(findByAriaLabel(filtered, "Add pi ACP")).not.toBeNull();
    expect(visitElements(filtered, (el) => el.props["aria-label"] === "Add Amp")).toBeNull();
    // Authors are searchable, not just names.
    type("google");
    const byAuthor = render();
    expect(findByAriaLabel(byAuthor, "Add Gemini CLI")).not.toBeNull();
    expect(visitElements(byAuthor, (el) => el.props["aria-label"] === "Add pi ACP")).toBeNull();

    type("");
    const cleared = render();
    expect(findByAriaLabel(cleared, "Add Amp")).not.toBeNull();
    expect(findByAriaLabel(cleared, "Add pi ACP")).not.toBeNull();
    expect(state.search).toHaveBeenLastCalledWith({ environmentId, input: { query: "" } });
  });

  it("renders deterministic loading, error, and empty states", () => {
    state.isPending = true;
    expect(
      visitElements(render(), (element) => element.props.children === "Searching the registry..."),
    ).not.toBeNull();

    state.isPending = false;
    state.error = "Registry unavailable.";
    expect(
      visitElements(render(), (element) => element.props.children === "Registry unavailable."),
    ).not.toBeNull();

    state.error = null;
    state.result = { agents: [] };
    expect(
      visitElements(render(), (element) => element.props.children === "No compatible agents found"),
    ).not.toBeNull();
  });

  it("prepares a result before handing it back to the wizard", async () => {
    state.prepare.mockResolvedValueOnce({
      _tag: "Success",
      value: { agentId: "gemini", version: "2.0.0", distribution: "binary", prepared: true },
    });
    state.result = { agents: [gemini] };
    const onPrepared = vi.fn();
    const tree = render({ onPrepared });

    const add = findByAriaLabel(tree, "Add Gemini CLI");
    (add.props.onClick as (() => void) | undefined)?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.prepare).toHaveBeenCalledWith({
      environmentId,
      input: { agentId: "gemini" },
    });
    expect(onPrepared).toHaveBeenCalledWith({
      ...gemini,
      version: "2.0.0",
      distribution: "binary",
    });
  });

  it("ignores a stale prepare completion", async () => {
    let resolveFirst!: (value: { readonly _tag: "Success"; readonly value: unknown }) => void;
    let resolveSecond!: (value: { readonly _tag: "Success"; readonly value: unknown }) => void;
    state.prepare
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    state.result = { agents: [gemini] };
    const onPrepared = vi.fn();
    const tree = render({ onPrepared });
    const add = findByAriaLabel(tree, "Add Gemini CLI");

    (add.props.onClick as (() => void) | undefined)?.();
    (add.props.onClick as (() => void) | undefined)?.();
    resolveFirst({ _tag: "Success", value: {} });
    await Promise.resolve();
    expect(onPrepared).not.toHaveBeenCalled();

    resolveSecond({ _tag: "Success", value: {} });
    await Promise.resolve();
    expect(onPrepared).toHaveBeenCalledOnce();
  });

  it("ignores prepare completion after unmount", async () => {
    let resolvePrepare!: (value: { readonly _tag: "Success"; readonly value: unknown }) => void;
    state.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrepare = resolve;
        }),
    );
    state.result = { agents: [gemini] };
    const onPrepared = vi.fn();
    const tree = render({ onPrepared });

    const add = findByAriaLabel(tree, "Add Gemini CLI");
    (add.props.onClick as (() => void) | undefined)?.();
    for (const cleanup of lifecycle.cleanups) cleanup();
    resolvePrepare({ _tag: "Success", value: {} });
    await Promise.resolve();

    expect(onPrepared).not.toHaveBeenCalled();
  });

  it("renders existing registry configuration as already added", () => {
    state.result = { agents: [gemini] };
    const tree = render({ configured: true });
    const added = findByAriaLabel(tree, "Already added Gemini CLI");

    expect(added.props.disabled).toBe(true);
  });
});
