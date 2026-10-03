import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  importLegacyLocalStorage,
  LEGACY_LOCAL_STORAGE_IMPORT_KEY,
} from "../app/legacyLocalStorage.ts";

export class LegacyLocalStorageImportError extends Schema.TaggedError<LegacyLocalStorageImportError>()(
  "LegacyLocalStorageImportError",
  { cause: Schema.Defect() },
) {}

const electronPromise = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new LegacyLocalStorageImportError({ cause }),
  });
const readStorage = (view: Electron.WebContentsView) =>
  electronPromise(
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
const openStorage = (session: Electron.Session) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        const view = makeView(session);
        try {
          session.protocol.handle("t3code", blankPage);
          return view;
        } catch (cause) {
          view.webContents.close();
          throw cause;
        }
      },
      catch: (cause) => new LegacyLocalStorageImportError({ cause }),
    }),
    (view) =>
      Effect.sync(() => {
        view.webContents.close();
        session.protocol.unhandle("t3code");
      }),
  );
const encodeWrites = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.Tuple([Schema.String, Schema.String]))),
);

/** Run before registering the real renderer protocol or creating any app windows. */
export const importLegacyProfile = Effect.fn("desktop.importLegacyProfile")(function* (
  appDataDirectory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const snapshot = path.join(Electron.app.getPath("userData"), "v1-local-storage-import");
  // Windows can hold the temporary database open until the previous process exits.
  yield* fs.remove(snapshot, { recursive: true, force: true });
  const destinationSession = Electron.session.defaultSession;
  const destinationView = yield* openStorage(destinationSession);
  yield* electronPromise(() => destinationView.webContents.loadURL("t3code://app/"));
  const current = new Map(yield* readStorage(destinationView));
  if (current.has(LEGACY_LOCAL_STORAGE_IMPORT_KEY)) return;
  let source: string | undefined;
  for (const name of ["t3code", "T3 Code (Alpha)"]) {
    const candidate = path.join(appDataDirectory, name, "Local Storage", "leveldb");
    if (yield* fs.exists(path.join(candidate, "CURRENT"))) {
      source = candidate;
      break;
    }
  }
  if (!source) return;
  const sourcePath = source;
  const target = path.join(snapshot, "Local Storage", "leveldb");
  yield* fs.makeDirectory(target, { recursive: true });
  const files = (yield* fs.readDirectory(sourcePath)).filter((name) => name !== "LOCK").sort();
  const before = yield* Effect.forEach(files, (name) => fs.stat(path.join(sourcePath, name)));
  for (const name of files)
    yield* fs.copyFile(path.join(sourcePath, name), path.join(target, name));
  const afterFiles = (yield* fs.readDirectory(sourcePath)).filter((name) => name !== "LOCK").sort();
  const after = yield* Effect.forEach(files, (name) => fs.stat(path.join(sourcePath, name)));
  // Never acknowledge a snapshot that V1 wrote or compacted while we copied it.
  if (
    files.join("\n") !== afterFiles.join("\n") ||
    before.some(
      (stat, index) =>
        stat.size !== after[index]?.size ||
        Option.getOrNull(stat.mtime)?.getTime() !==
          Option.getOrNull(after[index]!.mtime)?.getTime(),
    )
  ) {
    return yield* new LegacyLocalStorageImportError({
      cause: "V1 Local Storage changed during import; close V1 and restart V2 to retry.",
    });
  }
  const sourceSession = Electron.session.fromPath(snapshot);
  const sourceView = yield* openStorage(sourceSession);
  yield* electronPromise(() => sourceView.webContents.loadURL("t3code://app/"));
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
  yield* electronPromise(() =>
    destinationView.webContents.executeJavaScript(`
    for (const [key, value] of ${encodeWrites(writes)}) localStorage.setItem(key, value);
    true;
  `),
  );
  destinationSession.flushStorageData();
}, Effect.scoped);
