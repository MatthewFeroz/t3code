import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { fetchEnvironmentSkill, fetchEnvironmentSkills } from "./skills.ts";

const target = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("skills-environment"),
  label: "Skills environment",
  httpBaseUrl: "https://skills.example.test",
  wsBaseUrl: "wss://skills.example.test",
});
const prepared: PreparedConnection = {
  environmentId: target.environmentId,
  label: target.label,
  httpBaseUrl: target.httpBaseUrl,
  socketUrl: "wss://skills.example.test/ws",
  httpAuthorization: null,
  target,
};
const skill = {
  name: "example",
  scope: "project" as const,
  description: "Example skill",
  path: "/repo/.agents/skills/example",
  agents: ["Codex"],
  source: null,
  sourceUrl: null,
  sourceType: null,
};

describe("environment skills HTTP", () => {
  it.effect("sends the selected project to both endpoints and includes local session cookies", () =>
    Effect.gen(function* () {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      const http = remoteHttpClientLayer((request, init) => {
        const url = String(request);
        calls.push({ url, init: init ?? {} });
        return Promise.resolve(
          Response.json(
            url.includes("/project/") ? { ...skill, content: "Instructions" } : [skill],
          ),
        );
      });
      const query = { projectId: ProjectId.make("project-selected") };
      expect(yield* fetchEnvironmentSkills(prepared, query).pipe(Effect.provide(http))).toEqual([
        skill,
      ]);
      expect(
        (yield* fetchEnvironmentSkill(prepared, query, { scope: "project", name: "example" }).pipe(
          Effect.provide(http),
        )).content,
      ).toBe("Instructions");
      expect(calls.map((call) => call.url)).toEqual([
        "https://skills.example.test/api/skills?projectId=project-selected",
        "https://skills.example.test/api/skills/project/example?projectId=project-selected",
      ]);
      expect(calls.every((call) => call.init.credentials === "include")).toBe(true);
    }),
  );

  it.effect("uses the remote environment bearer credential for global discovery", () =>
    Effect.gen(function* () {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      yield* fetchEnvironmentSkills(
        {
          ...prepared,
          httpBaseUrl: "https://remote.example.test",
          httpAuthorization: { _tag: "Bearer", token: "remote-token" },
        },
        {},
      ).pipe(
        Effect.provide(
          remoteHttpClientLayer((request, init) => {
            calls.push({ url: String(request), init: init ?? {} });
            return Promise.resolve(Response.json([]));
          }),
        ),
      );
      expect(calls[0]?.url).toBe("https://remote.example.test/api/skills");
      expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer remote-token");
    }),
  );

  it.effect("signs relay requests for the selected skill endpoint", () =>
    Effect.gen(function* () {
      const proofs: Array<{ method: string; url: string; accessToken?: string }> = [];
      const calls: RequestInit[] = [];
      yield* fetchEnvironmentSkill(
        {
          ...prepared,
          httpAuthorization: {
            _tag: "Dpop",
            accessToken: "relay-token",
            expiresAtEpochMs: 3600000,
          },
        },
        { projectId: ProjectId.make("relay-project") },
        { scope: "project", name: "example" },
      ).pipe(
        Effect.provideService(
          RemoteEnvironmentAuthorization,
          RemoteEnvironmentAuthorization.of({
            authorizeBearer: () => Effect.die("Unexpected bearer preparation"),
            authorizeDpop: () => Effect.die("Unexpected socket preparation"),
            authorizeDpopHttp: () =>
              Effect.succeed({
                environmentId: prepared.environmentId,
                label: prepared.label,
                httpBaseUrl: prepared.httpBaseUrl,
                httpAuthorization: {
                  _tag: "Dpop" as const,
                  accessToken: "relay-token",
                  expiresAtEpochMs: 3600000,
                },
              }),
          }),
        ),
        Effect.provideService(
          ManagedRelayDpopSigner,
          ManagedRelayDpopSigner.of({
            thumbprint: Effect.succeed("test-thumbprint"),
            createProof: (input) =>
              Effect.sync(() => {
                proofs.push(input);
                return "signed-proof";
              }),
          }),
        ),
        Effect.provide(
          remoteHttpClientLayer((_request, init) => {
            calls.push(init ?? {});
            return Promise.resolve(Response.json({ ...skill, content: "Instructions" }));
          }),
        ),
      );
      expect(proofs).toEqual([
        {
          method: "GET",
          url: "https://skills.example.test/api/skills/project/example?projectId=relay-project",
          accessToken: "relay-token",
        },
      ]);
      expect(new Headers(calls[0]?.headers).get("dpop")).toBe("signed-proof");
      expect(new Headers(calls[0]?.headers).get("authorization")).toBe("DPoP relay-token");
    }),
  );
});
