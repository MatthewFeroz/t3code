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
  parseRegistryExport,
  readManagedPolicy,
  WINDOWS_POLICY_KEY,
  windowsPolicyDocument,
} from "./managedPolicyFile.ts";

const policy = JSON.stringify({ schemaVersion: 1, organization: "Example Corp" });

type Result = { readonly stdout: string; readonly exitCode: number };

const TEMP = "C:\\Temp\\t3code-policy";
const EXPORT_FILE = `${TEMP}\\policy.reg`;

/** What `reg export` writes for the policy key, given each subkey's value lines. */
const regExport = (sections: Readonly<Record<string, ReadonlyArray<string>>>) =>
  [
    "Windows Registry Editor Version 5.00",
    ...Object.entries(sections).flatMap(([key, lines]) => [
      "",
      `[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\T3Tools\\T3Code${key === "" ? "" : `\\${key}`}]`,
      ...lines,
    ]),
    "",
  ].join("\r\n");

/** reg.exe whose export, policy key query, and Policies root query exit with these codes. */
const reg = ({ exported = 0, key = 0, root = 0 } = {}) => ({
  "C:\\Windows\\System32\\reg.exe": (args: ReadonlyArray<string>) => ({
    stdout: "",
    exitCode: args[0] === "export" ? exported : args[1]?.endsWith("\\T3Code") ? key : root,
  }),
});

/** Files that exist, and what a command prints and exits with, by command name and arguments. */
const machine = (
  files: Readonly<Record<string, string>>,
  commands: Readonly<Record<string, Result | ((args: ReadonlyArray<string>) => Result)>>,
) =>
  Layer.mergeAll(
    FileSystem.layerNoop({
      exists: (path) => Effect.succeed(path in files),
      readFileString: (path) => Effect.succeed(files[path] ?? ""),
      makeTempDirectoryScoped: () => Effect.succeed(TEMP),
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
      const exported = { [EXPORT_FILE]: regExport({ "": ['"Organization"="Example Corp"'] }) };

      assert.equal(yield* read("win32", exported, reg()), WINDOWS_POLICY_KEY);
      assert.isUndefined(yield* read("win32", {}, reg({ key: 1 })));
      // reg exits 1 for failures too, so neither of these may read as no policy.
      assert.include(yield* read("win32", {}, reg({ key: 1, root: 1 })), "registry cannot be read");
      assert.include(
        yield* read("win32", exported, reg({ exported: 1 })),
        "registry cannot be read",
      );
      assert.equal(
        yield* read("win32", { [managedPolicyPath("win32")]: policy }, reg({ key: 1 })),
        managedPolicyPath("win32"),
      );
      assert.include(
        yield* read("win32", { ...exported, [managedPolicyPath("win32")]: policy }, reg()),
        "deploy the policy one way",
      );
      // Group Policy can leave the key behind with nothing in it.
      assert.isUndefined(yield* read("win32", { [EXPORT_FILE]: regExport({ "": [] }) }, reg()));
    }),
  );

  it.effect("builds the policy from the values the Group Policy template writes", () =>
    Effect.gen(function* () {
      // As a Windows 10 PC exports them: text outside the console code page, and escaped quotes.
      const sections = {
        "": [
          '"Organization"="Société 日本 ✓"',
          '"SupportUrl"=""',
          '"MaxRuntimeMode"="auto-accept-edits"',
          '"Telemetry"=dword:00000000',
          '"Settings"="{\\"enableAgentBrowserAccess\\": {\\"value\\": \\"a\\\\\\\\b\\", \\"locked\\": true}}"',
          '"UpdatesMode"="off"',
          '"AllowNightly"=dword:00000001',
          '"Updates"=dword:00000001',
          '"Clients"=dword:00000001',
          '"AllowedDrivers"=dword:00000001',
        ],
        Clients: ['"desktop"=dword:00000001', '"remote"=dword:00000000'],
        AllowedDrivers: ['"codex"=dword:00000001', '"claudeAgent"=dword:00000001'],
      };
      assert.deepStrictEqual(windowsPolicyDocument(parseRegistryExport(regExport(sections))), {
        document: {
          schemaVersion: 1,
          organization: "Société 日本 ✓",
          settings: { enableAgentBrowserAccess: { value: "a\\b", locked: true } },
          limits: {
            maxRuntimeMode: "auto-accept-edits",
            telemetry: false,
            updates: { mode: "off", allowNightly: true },
            clients: ["desktop"],
            providers: { allowedDrivers: ["codex", "claudeAgent"] },
          },
        },
      });

      const organization = '"Organization"="Example Corp"';
      // Disabling a policy in Windows 11 leaves each checkbox's falseValue in the registry.
      assert.deepStrictEqual(
        windowsPolicyDocument(
          parseRegistryExport(
            regExport({
              "": [
                organization,
                '"Clients"=dword:00000000',
                '"AllowedDrivers"=dword:00000000',
                '"Updates"=dword:00000000',
                '"AllowNightly"=dword:00000000',
                '"Telemetry"=dword:00000000',
              ],
              Clients: [
                '"desktop"=dword:00000000',
                '"local-browser"=dword:00000000',
                '"remote"=dword:00000000',
              ],
              AllowedDrivers: ['"codex"=dword:00000000', '"claudeAgent"=dword:00000000'],
            }),
          ),
        ),
        {
          document: {
            schemaVersion: 1,
            organization: "Example Corp",
            limits: { telemetry: false },
          },
        },
      );
      // Anything the template does not write fails closed rather than being ignored.
      for (const [values, reason] of [
        [{ "": [organization, '"Telemetry"=dword:00000002'] }, "DWORD of 0 or 1"],
        [{ "": [organization, '"MaxMode"="auto"'] }, "not a T3 Code policy value"],
        [{ "": [organization], Other: ['"x"=dword:00000001'] }, "not a T3 Code policy key"],
        [{ "": [organization, '"Settings"="{"'] }, "not valid JSON"],
        [{ "": [organization, '"Clients"=dword:00000002'] }, "DWORD of 0 or 1"],
        [
          { "": [organization, '"Clients"=dword:00000001'], Clients: ['"desktop"=dword:00000000'] },
          "does not match the policy schema",
        ],
        [
          { "": [organization], Clients: ['"remote"=dword:00000000'] },
          "does not match the policy schema",
        ],
        [{ "": ['"Organization"=dword:00000001'] }, "Organization must be a string"],
        [{ "": ['"Organization"=hex(2):45,00,00,00'] }, "Organization must be a string"],
        [
          { "": ['"MaxRuntimeMode"="auto-accept-edits"'] },
          "set the Organization policy whenever another T3 Code policy is set",
        ],
        [{ "": ['"Policy"="{}"'] }, "Policy is not a T3 Code policy value"],
      ] as const) {
        assert.include(yield* read("win32", { [EXPORT_FILE]: regExport(values) }, reg()), reason);
      }
    }),
  );
});
