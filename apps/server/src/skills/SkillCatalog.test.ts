// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ProcessRunner from "../processRunner.ts";
import { make, skillBodyFromMarkdown, skillDescriptionFromMarkdown } from "./SkillCatalog.ts";

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
      expect(invocations.every((input) => input.args.includes("skills"))).toBe(true);
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
