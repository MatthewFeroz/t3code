// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { vi } from "vite-plus/test";

import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ProcessRunner from "../processRunner.ts";
import { make, skillBodyFromMarkdown, skillDescriptionFromMarkdown } from "./SkillCatalog.ts";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));

const runOutput = (stdout: string): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: ChildProcessSpawner.ExitCode(0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

it("parses skill metadata and removes frontmatter from the instruction body", () => {
  const markdown = `---
name: example
description: Keep this description concise.
metadata:
  internal: false
---

# Example

Do the useful thing.
`;

  expect(skillDescriptionFromMarkdown(markdown)).toBe("Keep this description concise.");
  expect(skillBodyFromMarkdown(markdown)).toBe("# Example\n\nDo the useful thing.");
});

it.effect("discovers both CLI scopes and reads only catalogued skill files", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const tempDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skills-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => NodeFSP.rm(tempDir, { recursive: true, force: true })),
      );
      const projectPath = NodePath.join(tempDir, "project-skill");
      const globalPath = NodePath.join(tempDir, "global-skill");
      yield* Effect.promise(() =>
        Promise.all([
          NodeFSP.mkdir(projectPath, { recursive: true }),
          NodeFSP.mkdir(globalPath, { recursive: true }),
        ]),
      );
      yield* Effect.promise(() =>
        Promise.all([
          NodeFSP.writeFile(
            NodePath.join(projectPath, "SKILL.md"),
            "---\nname: project-skill\ndescription: Project instructions.\n---\n\n# Project\n",
          ),
          NodeFSP.writeFile(
            NodePath.join(globalPath, "SKILL.md"),
            "---\nname: global-skill\ndescription: Global instructions.\n---\n\n# Global\n",
          ),
        ]),
      );

      const invocations: ProcessRunner.ProcessRunInput[] = [];
      const runner = ProcessRunner.ProcessRunner.of({
        run: (input) =>
          Effect.sync(() => {
            invocations.push(input);
            const global = input.args.includes("--global");
            return runOutput(
              JSON.stringify([
                {
                  name: global ? "global-skill" : "project-skill",
                  path: global ? globalPath : projectPath,
                  scope: global ? "global" : "project",
                  agents: global ? ["Codex", "Claude Code"] : ["Codex"],
                  source: global ? "owner/repo" : null,
                  sourceUrl: global ? "https://github.com/owner/repo.git" : null,
                  sourceType: global ? "github" : null,
                },
              ]),
            );
          }),
      });
      const catalog = yield* make().pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, runner),
      );

      expect(yield* catalog.list(tempDir)).toEqual([
        {
          name: "project-skill",
          description: "Project instructions.",
          path: projectPath,
          scope: "project",
          agents: ["Codex"],
          source: null,
          sourceUrl: null,
          sourceType: null,
        },
        {
          name: "global-skill",
          description: "Global instructions.",
          path: globalPath,
          scope: "global",
          agents: ["Codex", "Claude Code"],
          source: "owner/repo",
          sourceUrl: "https://github.com/owner/repo.git",
          sourceType: "github",
        },
      ]);

      const detail = yield* catalog.detail("global", "global-skill", tempDir);
      expect(Option.getOrThrow(detail).content).toBe("# Global");
      expect(Option.isNone(yield* catalog.detail("global", "../not-a-skill", tempDir))).toBe(true);
      expect(invocations).toHaveLength(2);
      expect(invocations.every((input) => input.cwd === tempDir)).toBe(true);
      expect(invocations.every((input) => input.command === "npx")).toBe(true);
      expect(invocations.every((input) => input.args.includes("--package=skills@1.5.23"))).toBe(
        true,
      );
      for (const input of invocations) {
        const prefix = input.args[input.args.indexOf("--prefix") + 1];
        expect(prefix).not.toBe(tempDir);
        expect(
          yield* Effect.promise(() =>
            NodeFSP.access(prefix!).then(
              () => false,
              () => true,
            ),
          ),
        ).toBe(true);
      }
    }),
  ),
);

it.effect("keeps same-named project skills separate when clients browse different projects", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const tempDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skill-projects-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => NodeFSP.rm(tempDir, { recursive: true, force: true })),
      );
      const roots = [NodePath.join(tempDir, "first"), NodePath.join(tempDir, "second")];
      yield* Effect.promise(() =>
        Promise.all(
          roots.map(async (root) => {
            await NodeFSP.mkdir(root, { recursive: true });
            await NodeFSP.writeFile(NodePath.join(root, "SKILL.md"), `Instructions for ${root}`);
          }),
        ),
      );
      const runner = ProcessRunner.ProcessRunner.of({
        run: (input) =>
          Effect.succeed(
            runOutput(
              JSON.stringify(
                input.args.includes("--global")
                  ? []
                  : [
                      {
                        name: "shared-name",
                        path: input.cwd,
                        scope: "project",
                        agents: ["Codex"],
                        source: null,
                        sourceUrl: null,
                        sourceType: null,
                      },
                    ],
              ),
            ),
          ),
      });
      const catalog = yield* make().pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, runner),
      );
      const [first, second] = roots;
      yield* catalog.list(first);
      yield* catalog.list(second);
      expect(
        Option.getOrThrow(yield* catalog.detail("project", "shared-name", first)).content,
      ).toBe(`Instructions for ${first}`);
      expect(
        Option.getOrThrow(yield* catalog.detail("project", "shared-name", second)).content,
      ).toBe(`Instructions for ${second}`);
    }),
  ),
);

it.effect("scans only global skills when no project is selected", () =>
  Effect.gen(function* () {
    const invocations: ProcessRunner.ProcessRunInput[] = [];
    const runner = ProcessRunner.ProcessRunner.of({
      run: (input) =>
        Effect.sync(() => {
          invocations.push(input);
          return runOutput("[]");
        }),
    });
    const catalog = yield* make().pipe(Effect.provideService(ProcessRunner.ProcessRunner, runner));
    expect(yield* catalog.list()).toEqual([]);
    expect(Option.isNone(yield* catalog.detail("project", "shared-name"))).toBe(true);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.args).toContain("--global");
    expect(invocations[0]?.cwd).toBeUndefined();
  }),
);

it.effect("bounds skill reads, including files that grow after opening", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skill-limit-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
      );
      const filePath = NodePath.join(root, "SKILL.md");
      const limit = 512 * 1024;
      const runner = ProcessRunner.ProcessRunner.of({
        run: () =>
          Effect.succeed(
            runOutput(
              JSON.stringify([
                {
                  name: "bounded",
                  path: root,
                  scope: "global",
                  agents: [],
                  source: null,
                  sourceUrl: null,
                  sourceType: null,
                },
              ]),
            ),
          ),
      });
      const catalog = yield* make().pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, runner),
      );
      for (const length of [0, limit]) {
        yield* Effect.promise(() => NodeFSP.writeFile(filePath, "x".repeat(length)));
        expect(Option.getOrThrow(yield* catalog.detail("global", "bounded")).content).toHaveLength(
          length,
        );
      }
      yield* catalog.list();
      const open = NodeFSP.open;
      let closed = false;
      const spy = vi.spyOn(NodeFSP, "open").mockImplementationOnce(async (...args) => {
        const file = await open(...args);
        const close = file.close.bind(file);
        vi.spyOn(file, "close").mockImplementation(async () => {
          await close();
          closed = true;
        });
        await NodeFSP.appendFile(filePath, "x");
        return file;
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()));
      const error = yield* catalog.detail("global", "bounded").pipe(Effect.flip);
      expect(error._tag).toBe("SkillReadError");
      expect(error.cause).toEqual(new Error(`SKILL.md exceeds ${limit} bytes`));
      expect(closed).toBe(true);
      expect((yield* catalog.list())[0]?.description).toBe("");
    }),
  ),
);

it.effect("shares matching scans, bounds distinct work, and refreshes after completion", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let runs = 0;
    let active = 0;
    let peak = 0;
    const runner = ProcessRunner.ProcessRunner.of({
      run: () =>
        Effect.gen(function* () {
          runs++;
          active++;
          peak = Math.max(peak, active);
          if (active === 2) yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          return runOutput("[]");
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              active--;
            }),
          ),
        ),
    });
    const catalog = yield* make().pipe(Effect.provideService(ProcessRunner.ProcessRunner, runner));
    const first = yield* catalog.list("/project-a").pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    // Each subscriber joins the already-running project/global scans.
    const subscribers = yield* Effect.forEach(Array.from({ length: 20 }), () =>
      catalog.list("/project-a").pipe(Effect.forkChild),
    );
    yield* Effect.yieldNow;
    const busy = yield* catalog.list("/project-b").pipe(Effect.flip);
    expect(busy._tag).toBe("SkillDiscoveryError");
    if (busy._tag === "SkillDiscoveryError") expect(busy.stage).toBe("busy");
    expect(runs).toBe(2);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Effect.forEach(subscribers, Fiber.join);
    expect(runs).toBe(2);
    expect(peak).toBe(2);
    yield* catalog.list("/project-a");
    expect(runs).toBe(4);
    expect(active).toBe(0);
  }),
);

it.effect("releases discovery slots after CLI failure and retries on refresh", () =>
  Effect.gen(function* () {
    let fail = true;
    const runner = ProcessRunner.ProcessRunner.of({
      run: () =>
        Effect.sync(() => ({
          ...runOutput("[]"),
          code: ChildProcessSpawner.ExitCode(fail ? 1 : 0),
        })),
    });
    const catalog = yield* make().pipe(Effect.provideService(ProcessRunner.ProcessRunner, runner));
    expect((yield* catalog.list().pipe(Effect.flip))._tag).toBe("SkillDiscoveryError");
    fail = false;
    expect(yield* catalog.list()).toEqual([]);
  }),
);

it.effect("cancels abandoned scans and releases their discovery slots", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    let active = 0;
    let block = true;
    const runner = ProcessRunner.ProcessRunner.of({
      run: () =>
        Effect.gen(function* () {
          active++;
          if (active === 2) yield* Deferred.succeed(entered, undefined);
          if (block) return yield* Effect.never;
          return runOutput("[]");
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              active--;
            }),
          ),
        ),
    });
    const catalog = yield* make().pipe(Effect.provideService(ProcessRunner.ProcessRunner, runner));
    const request = yield* catalog.list("/project-a").pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    yield* Fiber.interrupt(request);
    expect(active).toBe(0);
    block = false;
    expect(yield* catalog.list("/project-a")).toEqual([]);
    expect(active).toBe(0);
  }),
);
