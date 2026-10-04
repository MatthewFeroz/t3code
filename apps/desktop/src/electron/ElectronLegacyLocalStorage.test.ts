import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";
import * as NodeVM from "node:vm";
import { beforeEach, vi } from "vite-plus/test";

const { destinationSession, sourceSession, makeView, getPath, fromPath } = vi.hoisted(() => ({
  destinationSession: {
    protocol: { handle: vi.fn(), unhandle: vi.fn() },
    flushStorageData: vi.fn(),
  },
  sourceSession: { protocol: { handle: vi.fn(), unhandle: vi.fn() } },
  makeView: vi.fn(),
  getPath: vi.fn(),
  fromPath: vi.fn<(_path: string) => unknown>(),
}));

vi.mock("electron", () => ({
  app: { getPath },
  session: { defaultSession: destinationSession, fromPath },
  WebContentsView: vi.fn(function (options: { webPreferences: { session: unknown } }) {
    return makeView(options.webPreferences.session);
  }),
}));

import { LEGACY_LOCAL_STORAGE_IMPORT_KEY } from "../app/legacyLocalStorage.ts";
import { importLegacyProfile } from "./ElectronLegacyLocalStorage.ts";

const stashKey = "t3code:prompt-stash:v2";
const stash = (entries: Array<{ id: string; prompt: string }>) =>
  JSON.stringify({ version: 2, state: { entries } });

function view(values: Record<string, string>) {
  let destroyed = false;
  const listeners: Array<() => void> = [];
  const localStorage = Object.assign(Object.create(null), values);
  Object.defineProperties(localStorage, {
    getItem: { value: (key: string) => localStorage[key] ?? null },
    setItem: {
      value: vi.fn((key: string, value: string) => {
        localStorage[key] = value;
      }),
    },
    removeItem: {
      value: (key: string) => {
        delete localStorage[key];
      },
    },
  });
  const destroy = () => {
    destroyed = true;
    for (const listener of listeners.splice(0)) listener();
  };
  const webContents = {
    isDestroyed: () => destroyed,
    once: (_event: string, listener: () => void) => {
      listeners.push(listener);
    },
    close: vi.fn(destroy),
    loadURL: vi.fn(async () => {}),
    executeJavaScript: vi.fn(async (script: string): Promise<unknown> =>
      NodeVM.runInNewContext(script, { localStorage }),
    ),
  };
  return { webContents, localStorage, destroy };
}

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "legacy-storage-test-" });
  yield* fs.makeDirectory(`${directory}/t3code/Local Storage/leveldb`, { recursive: true });
  yield* fs.writeFileString(`${directory}/t3code/Local Storage/leveldb/CURRENT`, "fixture");
  getPath.mockReturnValue(`${directory}/v2`);
  return directory;
});

describe("Electron legacy Local Storage lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromPath.mockReturnValue(sourceSession);
  });

  it.effect("recovers through fresh snapshots when an older snapshot cannot be removed", () =>
    Effect.gen(function* () {
      const directory = yield* fixture;
      const fs = yield* FileSystem.FileSystem;
      const snapshotRoot = `${directory}/v2/v1-local-storage-import`;
      const lockedFile = `${snapshotRoot}/Local Storage/leveldb/CURRENT`;
      yield* fs.makeDirectory(`${snapshotRoot}/Local Storage/leveldb`, { recursive: true });
      yield* fs.writeFileString(lockedFile, "locked old snapshot");
      const lockedFs = {
        ...fs,
        remove: (target: string, options?: Parameters<typeof fs.remove>[1]) =>
          target === snapshotRoot
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "remove",
                  pathOrDescriptor: target,
                }),
              )
            : fs.remove(target, options),
      };
      const recovered = stash([{ id: "old", prompt: "V1" }]);
      const first = view({});
      makeView.mockImplementation((session) =>
        session === destinationSession ? first : view({ [stashKey]: recovered }),
      );
      yield* importLegacyProfile(directory).pipe(
        Effect.provideService(FileSystem.FileSystem, lockedFs),
      );
      assert.equal(first.localStorage.getItem(stashKey), recovered);
      assert.equal(first.localStorage.getItem(LEGACY_LOCAL_STORAGE_IMPORT_KEY), "1");
      assert.equal(yield* fs.readFileString(lockedFile), "locked old snapshot");

      const second = view({});
      makeView.mockImplementation((session) =>
        session === destinationSession ? second : view({ [stashKey]: recovered }),
      );
      yield* importLegacyProfile(directory).pipe(
        Effect.provideService(FileSystem.FileSystem, lockedFs),
      );
      assert.equal(second.localStorage.getItem(stashKey), recovered);
      const firstPath = fromPath.mock.calls[0]![0];
      const secondPath = fromPath.mock.calls[1]![0];
      assert.notEqual(firstPath, secondPath);
      assert.isTrue(yield* fs.exists(`${firstPath}/Local Storage/leveldb/CURRENT`));
      assert.isTrue(yield* fs.exists(`${secondPath}/Local Storage/leveldb/CURRENT`));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("finishes a timed-out write and destroys its writer before handing storage to V2", () =>
    Effect.gen(function* () {
      const directory = yield* fixture;
      const destination = view({});
      const source = view({ [stashKey]: stash([{ id: "old", prompt: "recover" }]) });
      makeView.mockImplementation((session) =>
        session === destinationSession ? destination : source,
      );
      const writing = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      const writeResult = Promise.withResolvers<unknown>();
      const execute = destination.webContents.executeJavaScript.getMockImplementation()!;
      destination.webContents.executeJavaScript.mockImplementation((script) => {
        if (script.includes("localStorage.setItem")) {
          writing.resolve();
          return writeResult.promise;
        }
        return execute(script);
      });
      destination.webContents.close.mockImplementation(() => {
        closed.resolve();
      });
      let openedV2 = false;
      const startup = yield* importLegacyProfile(directory).pipe(
        Effect.timeout("10 seconds"),
        Effect.ignore,
        Effect.andThen(
          Effect.sync(() => {
            openedV2 = true;
          }),
        ),
        Effect.forkChild,
      );
      yield* Effect.promise(() => writing.promise);
      yield* TestClock.adjust("10 seconds");
      assert.isFalse(openedV2);
      assert.equal(destination.webContents.close.mock.calls.length, 0);
      writeResult.resolve(true);
      yield* Effect.promise(() => closed.promise);
      assert.isFalse(openedV2);
      assert.equal(destinationSession.flushStorageData.mock.calls.length, 1);
      assert.equal(destinationSession.protocol.unhandle.mock.calls.length, 0);
      destination.destroy();
      yield* Fiber.join(startup);
      assert.isTrue(openedV2);
      assert.equal(destinationSession.protocol.unhandle.mock.calls.length, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "restores V2 after a failed import, then retries without resurrecting later deletions",
    () =>
      Effect.gen(function* () {
        const directory = yield* fixture;
        const original = stash([{ id: "current", prompt: "V2" }]);
        const destination = view({ [stashKey]: original });
        const source = view({
          [stashKey]: stash([{ id: "old", prompt: "V1" }]),
          "t3code:theme": "dark",
        });
        makeView.mockImplementation((session) =>
          session === destinationSession ? destination : source,
        );
        destination.localStorage.setItem.mockImplementation((key: string, value: string) => {
          if (key === "t3code:theme") throw new Error("quota");
          destination.localStorage[key] = value;
        });
        const error = yield* importLegacyProfile(directory).pipe(Effect.flip);
        assert.equal(error._tag, "LegacyLocalStorageImportError");
        assert.equal(destination.localStorage.getItem(stashKey), original);
        assert.isNull(destination.localStorage.getItem(LEGACY_LOCAL_STORAGE_IMPORT_KEY));
        const retry = view({ [stashKey]: original });
        makeView.mockImplementation((session) =>
          session === destinationSession
            ? retry
            : view({
                [stashKey]: stash([{ id: "old", prompt: "V1" }]),
                "t3code:theme": "dark",
              }),
        );
        yield* importLegacyProfile(directory);
        assert.equal(retry.localStorage.getItem(LEGACY_LOCAL_STORAGE_IMPORT_KEY), "1");
        assert.equal(
          retry.localStorage.getItem(stashKey),
          stash([
            { id: "current", prompt: "V2" },
            { id: "old", prompt: "V1" },
          ]),
        );
        const restarted = view({
          [stashKey]: original,
          [LEGACY_LOCAL_STORAGE_IMPORT_KEY]: "1",
        });
        makeView.mockReturnValue(restarted);
        yield* importLegacyProfile(directory);
        assert.equal(restarted.localStorage.getItem(stashKey), original);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rolls back newly recovered content when the completion marker cannot be written", () =>
    Effect.gen(function* () {
      const directory = yield* fixture;
      const destination = view({});
      const source = view({ [stashKey]: stash([{ id: "old", prompt: "V1" }]) });
      makeView.mockImplementation((session) =>
        session === destinationSession ? destination : source,
      );
      destination.localStorage.setItem.mockImplementation((key: string, value: string) => {
        if (key === LEGACY_LOCAL_STORAGE_IMPORT_KEY) throw new Error("quota");
        destination.localStorage[key] = value;
      });
      yield* importLegacyProfile(directory).pipe(Effect.flip);
      assert.isNull(destination.localStorage.getItem(stashKey));
      assert.isNull(destination.localStorage.getItem(LEGACY_LOCAL_STORAGE_IMPORT_KEY));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "waits for destruction after protocol registration fails without removing its owner",
    () =>
      Effect.gen(function* () {
        const directory = yield* fixture;
        const destination = view({});
        makeView.mockReturnValue(destination);
        const closed = Promise.withResolvers<void>();
        destination.webContents.close.mockImplementation(() => {
          closed.resolve();
        });
        const cause = new Error("already registered");
        destinationSession.protocol.handle.mockImplementationOnce(() => {
          throw cause;
        });
        let resumed = false;
        const startup = yield* importLegacyProfile(directory).pipe(
          Effect.flip,
          Effect.tap(() =>
            Effect.sync(() => {
              resumed = true;
            }),
          ),
          Effect.forkChild,
        );
        yield* Effect.promise(() => closed.promise);
        assert.isFalse(resumed);
        destination.destroy();
        const error = yield* Fiber.join(startup);
        assert.equal(error._tag, "LegacyLocalStorageImportError");
        if (error._tag === "LegacyLocalStorageImportError") assert.strictEqual(error.cause, cause);
        assert.equal(destinationSession.protocol.unhandle.mock.calls.length, 0);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
