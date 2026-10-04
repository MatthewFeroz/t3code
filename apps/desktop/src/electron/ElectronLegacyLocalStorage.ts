import * as Electron from "electron";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  importLegacyLocalStorage,
  LEGACY_LOCAL_STORAGE_IMPORT_KEY,
} from "../app/legacyLocalStorage.ts";

export class LegacyLocalStorageImportError extends Schema.TaggedError<LegacyLocalStorageImportError>()(
  "LegacyLocalStorageImportError",
  {
    stage: Schema.Literals([
      "cleanup-snapshot",
      "discover-profile",
      "snapshot-profile",
      "open-storage",
      "load-storage",
      "read-storage",
      "write-storage",
      "flush-storage",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `V1 Local Storage import failed during ${this.stage}.`;
  }
}

export class LegacyLocalStorageSnapshotChangedError extends Schema.TaggedError<LegacyLocalStorageSnapshotChangedError>()(
  "LegacyLocalStorageSnapshotChangedError",
  {},
) {
  override get message(): string {
    return "V1 Local Storage changed during import; close V1 and restart V2 to retry.";
  }
}

const stageFailure = (stage: LegacyLocalStorageImportError["stage"]) => (cause: unknown) =>
  new LegacyLocalStorageImportError({ stage, cause });
const atStage = <A, E, R>(
  stage: LegacyLocalStorageImportError["stage"],
  effect: Effect.Effect<A, E, R>,
) => effect.pipe(Effect.mapError(stageFailure(stage)));

const electronPromise = <A>(stage: LegacyLocalStorageImportError["stage"], run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: stageFailure(stage),
  });
const readStorage = (view: Electron.WebContentsView) =>
  electronPromise(
    "read-storage",
    async () =>
      (await view.webContents.executeJavaScript(
        `Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])`,
      )) as Array<[string, string]>,
  );
const blankPage = () =>
  new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
const makeView = (session: Electron.Session) =>
  new Electron.WebContentsView({
    webPreferences: { session, sandbox: true, contextIsolation: true },
  });
const waitForClose = (view: Electron.WebContentsView, force: boolean) =>
  Effect.callback<void>((resume) => {
    if (view.webContents.isDestroyed()) return resume(Effect.void);
    const destroyed = () => resume(Effect.void);
    view.webContents.once("destroyed", destroyed);
    if (force && view.webContents.getOSProcessId() > 0) {
      view.webContents.forcefullyCrashRenderer();
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false });
    }
    return Effect.sync(() => view.webContents.removeListener("destroyed", destroyed));
  }).pipe(Effect.interruptible);
const closeView = (view: Electron.WebContentsView) =>
  waitForClose(view, false).pipe(
    Effect.timeout("1 second"),
    Effect.catchTag("TimeoutError", () =>
      waitForClose(view, true).pipe(
        Effect.timeout("1 second"),
        // If even forced teardown fails, fail startup rather than reuse an active writer.
        Effect.orDie,
      ),
    ),
  );
const openStorage = (session: Electron.Session) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const view = yield* Effect.try({
        try: () => makeView(session),
        catch: stageFailure("open-storage"),
      });
      yield* Effect.try({
        try: () => session.protocol.handle("t3code", blankPage),
        catch: stageFailure("open-storage"),
      }).pipe(Effect.onError(() => closeView(view)));
      return view;
    }),
    (view) =>
      closeView(view).pipe(Effect.andThen(Effect.sync(() => session.protocol.unhandle("t3code")))),
  );
const encodeWrites = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.Tuple([Schema.String, Schema.String]))),
);

/** Run before registering the real renderer protocol or creating any app windows. */
export const importLegacyProfile = Effect.fn("desktop.importLegacyProfile")(
  function* (appDataDirectory: string) {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const path = yield* Path.Path;
    const snapshotRoot = path.join(Electron.app.getPath("userData"), "v1-local-storage-import");
    // Windows can hold the temporary database open until the previous process exits.
    yield* atStage(
      "cleanup-snapshot",
      fs.remove(snapshotRoot, { recursive: true, force: true }),
    ).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not remove previous V1 import snapshots", error),
      ),
    );
    const destinationSession = Electron.session.defaultSession;
    const destinationView = yield* openStorage(destinationSession);
    yield* electronPromise("load-storage", () =>
      destinationView.webContents.loadURL("t3code://app/"),
    );
    const current = new Map(yield* readStorage(destinationView));
    if (current.has(LEGACY_LOCAL_STORAGE_IMPORT_KEY)) return;
    let source: string | undefined;
    for (const name of ["t3code", "T3 Code (Alpha)"]) {
      const candidate = path.join(appDataDirectory, name, "Local Storage", "leveldb");
      if (yield* atStage("discover-profile", fs.exists(path.join(candidate, "CURRENT")))) {
        source = candidate;
        break;
      }
    }
    if (!source) return;
    const sourcePath = source;
    yield* atStage("snapshot-profile", fs.makeDirectory(snapshotRoot, { recursive: true }));
    // Never read a previous attempt's profile, even when its cleanup failed.
    const snapshot = yield* atStage(
      "snapshot-profile",
      fs.makeTempDirectory({ directory: snapshotRoot, prefix: "attempt-" }),
    );
    const target = path.join(snapshot, "Local Storage", "leveldb");
    yield* atStage("snapshot-profile", fs.makeDirectory(target, { recursive: true }));
    const files = (yield* atStage("snapshot-profile", fs.readDirectory(sourcePath)))
      .filter((name) => name !== "LOCK")
      .sort();
    const fingerprint = (filePath: string) =>
      fs.readFile(filePath).pipe(
        Effect.flatMap((bytes) => crypto.digest("SHA-256", bytes)),
        Effect.map(Encoding.encodeHex),
      );
    const before = yield* atStage(
      "snapshot-profile",
      Effect.forEach(files, (name) => fingerprint(path.join(sourcePath, name))),
    );
    for (const name of files)
      yield* atStage(
        "snapshot-profile",
        fs.copyFile(path.join(sourcePath, name), path.join(target, name)),
      );
    const afterFiles = (yield* atStage("snapshot-profile", fs.readDirectory(sourcePath)))
      .filter((name) => name !== "LOCK")
      .sort();
    const after = yield* atStage(
      "snapshot-profile",
      Effect.forEach(files, (name) => fingerprint(path.join(sourcePath, name))),
    );
    const copied = yield* atStage(
      "snapshot-profile",
      Effect.forEach(files, (name) => fingerprint(path.join(target, name))),
    );
    // Never acknowledge a snapshot that V1 wrote or compacted while we copied it.
    if (
      files.join("\n") !== afterFiles.join("\n") ||
      before.some((digest, index) => digest !== after[index] || digest !== copied[index])
    ) {
      return yield* new LegacyLocalStorageSnapshotChangedError({});
    }
    const sourceSession = yield* Effect.try({
      try: () => Electron.session.fromPath(snapshot),
      catch: stageFailure("open-storage"),
    });
    const sourceView = yield* openStorage(sourceSession);
    yield* electronPromise("load-storage", () => sourceView.webContents.loadURL("t3code://app/"));
    const entries = yield* readStorage(sourceView);
    const writes: Array<[string, string]> = [];
    importLegacyLocalStorage(
      {
        getItem: (key) => current.get(key) ?? null,
        setItem: (key, value) => {
          current.set(key, value);
          writes.push([key, value]);
        },
      },
      entries,
    );
    // Timeout cleanup stops the writer before startup can reuse its storage session.
    yield* Effect.gen(function* () {
      yield* electronPromise("write-storage", () =>
        destinationView.webContents.executeJavaScript(`
    const written = [];
    try {
      for (const [key, value] of ${encodeWrites(writes)}) {
        const previous = localStorage.getItem(key);
        localStorage.setItem(key, value);
        written.push([key, previous]);
      }
    } catch (error) {
      // Reverse successful writes so a retry cannot resurrect partially exposed data.
      for (const [key, previous] of written.reverse()) {
        try {
          if (previous === null) localStorage.removeItem(key);
          else localStorage.setItem(key, previous);
        } catch {
          // Attempt the remaining keys and preserve the original write error.
        }
      }
      throw error;
    }
    true;
  `),
      );
      yield* Effect.try({
        try: () => destinationSession.flushStorageData(),
        catch: stageFailure("flush-storage"),
      });
    });
  },
  (effect) => effect.pipe(Effect.timeout("10 seconds"), Effect.scoped),
);
