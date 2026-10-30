import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import {
  MACOS_MANAGED_PREFERENCES_PATH,
  managedPolicyPath,
  parseRegistryValues,
  readManagedPolicy,
  WINDOWS_POLICY_KEY,
  windowsPolicyDocument,
} from "./managedPolicyFile.ts";

const policy = JSON.stringify({ schemaVersion: 1, organization: "Example Corp" });

type Result = { readonly stdout: string; readonly exitCode: number };

/** Files that exist, and what a command prints and exits with, by command name and arguments. */
const machine = (
  files: Readonly<Record<string, string>>,
  commands: Readonly<Record<string, Result | ((args: ReadonlyArray<string>) => Result)>>,
) =>
  Layer.mergeAll(
    FileSystem.layerNoop({
      exists: (path) => Effect.succeed(path in files),
      readFileString: (path) => Effect.succeed(files[path] ?? ""),
    }),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) => {
        const { command: name, args } = command as unknown as {
          readonly command: string;
          readonly args: ReadonlyArray<string>;
        };
        const answer = commands[name] ?? { stdout: "", exitCode: 127 };
        const result = typeof answer === "function" ? answer(args) : answer;
        return Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.exitCode)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            unref: Effect.succeed(Effect.void),
            stdin: Sink.drain,
            stdout: Stream.make(new TextEncoder().encode(result.stdout)),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
          }),
        );
      }),
    ),
  );

const read = (
  platform: NodeJS.Platform,
  files: Readonly<Record<string, string>>,
  commands: Parameters<typeof machine>[1] = {},
) =>
  readManagedPolicy(platform).pipe(
    Effect.map((found) => found?.source),
    Effect.catchTags({
      ManagedPolicyFileError: (error) => Effect.succeed(`error: ${error.reason}`),
    }),
    Effect.provide(machine(files, commands)),
  );

describe("readManagedPolicy", () => {
  it.effect("reads a macOS configuration profile, and refuses one beside a policy file", () =>
    Effect.gen(function* () {
      const plutil = { "/usr/bin/plutil": { stdout: policy, exitCode: 0 } };
      const profile = { [MACOS_MANAGED_PREFERENCES_PATH]: "<binary plist>" };
      const file = { [managedPolicyPath("darwin")]: policy };

      assert.equal(yield* read("darwin", profile, plutil), MACOS_MANAGED_PREFERENCES_PATH);
      const plist = (contents: object) => ({
        "/usr/bin/plutil": { stdout: JSON.stringify(contents), exitCode: 0 },
      });
      const settings = JSON.parse(policy);
      // What macOS 27 writes for a manually installed profile.
      assert.equal(
        yield* read(
          "darwin",
          profile,
          plist({ ...settings, PayloadUUID: "e8c7f49b", _manualProfile: true }),
        ),
        MACOS_MANAGED_PREFERENCES_PATH,
      );
      assert.equal(
        yield* read("darwin", profile, plist({ Forced: [{ mcx_preference_settings: settings }] })),
        MACOS_MANAGED_PREFERENCES_PATH,
      );
      // Keys beside the wrapper, or a second entry, are refused rather than dropped or merged.
      for (const ambiguous of [
        { Forced: [{ mcx_preference_settings: settings }], limits: { telemetry: false } },
        { Forced: [{ mcx_preference_settings: settings }, { mcx_preference_settings: settings }] },
      ]) {
        assert.include(
          yield* read("darwin", profile, plist(ambiguous)),
          "does not match the policy schema",
        );
      }
      assert.equal(yield* read("darwin", file), managedPolicyPath("darwin"));
      const typo = JSON.stringify({ ...settings, limits: { maxRuntimeMod: "auto" } });
      assert.include(
        yield* read("darwin", { [managedPolicyPath("darwin")]: typo }),
        '["limits"]["maxRuntimeMod"]',
      );
      assert.isUndefined(yield* read("darwin", {}));
      assert.include(
        yield* read("darwin", { ...profile, ...file }, plutil),
        "deploy the policy one way",
      );
      // A profile plutil cannot convert fails closed rather than reading as no policy.
      assert.include(
        yield* read("darwin", profile, { "/usr/bin/plutil": { stdout: "", exitCode: 1 } }),
        "cannot be read",
      );
    }),
  );

  it.effect("reads the Windows Policies key, and treats a missing or empty one as none", () =>
    Effect.gen(function* () {
      // The Policies root answers unless the registry itself cannot be read.
      const reg = (stdout: string, exitCode = 0, rootExitCode = 0) => ({
        "C:\\Windows\\System32\\reg.exe": (args: ReadonlyArray<string>) =>
          args.includes("/s") ? { stdout, exitCode } : { stdout: "", exitCode: rootExitCode },
      });
      const output = `\r\n${WINDOWS_POLICY_KEY}\r\n    Organization    REG_SZ    Example Corp\r\n\r\n`;

      assert.equal(yield* read("win32", {}, reg(output)), WINDOWS_POLICY_KEY);
      assert.isUndefined(yield* read("win32", {}, reg("", 1)));
      // A query that fails exits 1 too, so it must not read as no policy.
      assert.include(yield* read("win32", {}, reg("", 1, 1)), "registry cannot be read");
      assert.equal(
        yield* read("win32", { [managedPolicyPath("win32")]: policy }, reg("", 1)),
        managedPolicyPath("win32"),
      );
      assert.include(
        yield* read("win32", { [managedPolicyPath("win32")]: policy }, reg(output)),
        "deploy the policy one way",
      );
      // Group Policy can leave the key behind with nothing in it.
      assert.isUndefined(yield* read("win32", {}, reg(`\r\n${WINDOWS_POLICY_KEY}\r\n\r\n`)));
    }),
  );

  it.effect("builds the policy from the values the Group Policy template writes", () =>
    Effect.gen(function* () {
      const root = "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\T3Tools\\T3Code";
      const keys = (sections: Readonly<Record<string, ReadonlyArray<string>>>) =>
        Object.entries(sections)
          .map(([key, lines]) =>
            [key === "" ? root : `${root}\\${key}`, ...lines.map((line) => `    ${line}`)].join(
              "\r\n",
            ),
          )
          .join("\r\n\r\n");
      const reg = (stdout: string) => ({
        "C:\\Windows\\System32\\reg.exe": (args: ReadonlyArray<string>) =>
          args.includes("/s") ? { stdout, exitCode: 0 } : { stdout: "", exitCode: 0 },
      });
      const policy = {
        "": [
          "Organization    REG_SZ    Example Corp",
          "SupportUrl    REG_SZ    ",
          "MaxRuntimeMode    REG_SZ    auto-accept-edits",
          "Telemetry    REG_DWORD    0x0",
          'Settings    REG_SZ    {"enableAgentBrowserAccess": {"value": false, "locked": true}}',
          "UpdatesMode    REG_SZ    off",
          "AllowNightly    REG_DWORD    0x1",
        ],
        Clients: ["desktop    REG_DWORD    0x1", "remote    REG_DWORD    0x0"],
        AllowedDrivers: ["codex    REG_DWORD    0x1", "claudeAgent    REG_DWORD    0x1"],
      };
      assert.deepStrictEqual(windowsPolicyDocument(parseRegistryValues(keys(policy))), {
        document: {
          schemaVersion: 1,
          organization: "Example Corp",
          settings: { enableAgentBrowserAccess: { value: false, locked: true } },
          limits: {
            maxRuntimeMode: "auto-accept-edits",
            telemetry: false,
            updates: { mode: "off", allowNightly: true },
            clients: ["desktop"],
            providers: { allowedDrivers: ["codex", "claudeAgent"] },
          },
        },
      });
      assert.equal(yield* read("win32", {}, reg(keys(policy))), WINDOWS_POLICY_KEY);

      // Anything the template does not write fails closed rather than being ignored.
      for (const [sections, reason] of [
        [
          { "": ["Organization    REG_SZ    Example Corp", "Telemetry    REG_DWORD    0x2"] },
          "DWORD of 0 or 1",
        ],
        [
          { "": ["Organization    REG_SZ    Example Corp", "MaxMode    REG_SZ    auto"] },
          "not a T3 Code policy value",
        ],
        [
          { "": ["Organization    REG_SZ    Example Corp"], Other: ["x    REG_DWORD    0x1"] },
          "not a T3 Code policy key",
        ],
        [
          { "": ["Organization    REG_SZ    Example Corp", "Settings    REG_SZ    {"] },
          "not valid JSON",
        ],
        [
          {
            "": ["Organization    REG_SZ    Example Corp"],
            Clients: ["remote    REG_DWORD    0x0"],
          },
          "does not match the policy schema",
        ],
        [{ "": ["Organization    REG_DWORD    0x1"] }, "Organization must be a string"],
        [
          {
            "": [
              `Policy    REG_SZ    ${JSON.stringify({ schemaVersion: 1, organization: "Example Corp" })}`,
            ],
          },
          "Policy is not a T3 Code policy value",
        ],
      ] as const) {
        assert.include(yield* read("win32", {}, reg(keys(sections))), reason);
      }
    }),
  );
});
