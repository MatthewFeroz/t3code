import type { AgentSkillDetailParams, AgentSkillQuery } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  makeEnvironmentHttpApiUrlBuilder,
} from "../rpc/http.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";

export const fetchEnvironmentSkills = Effect.fn("clientRuntime.fetchEnvironmentSkills")(function* (
  prepared: PreparedConnection,
  query: AgentSkillQuery,
) {
  const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl);
  const requestUrl = makeEnvironmentHttpApiUrlBuilder(prepared.httpBaseUrl).skills.list({ query });
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const headers = yield* buildEnvironmentAuthHeaders(
    prepared.httpAuthorization,
    "GET",
    requestUrl,
    signer,
  );
  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    35_000,
    withEnvironmentCredentials(prepared.httpAuthorization, client.skills.list({ headers, query })),
  );
});

export const fetchEnvironmentSkill = Effect.fn("clientRuntime.fetchEnvironmentSkill")(function* (
  prepared: PreparedConnection,
  query: AgentSkillQuery,
  params: AgentSkillDetailParams,
) {
  const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl);
  const requestUrl = makeEnvironmentHttpApiUrlBuilder(prepared.httpBaseUrl).skills.detail({
    params,
    query,
  });
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const headers = yield* buildEnvironmentAuthHeaders(
    prepared.httpAuthorization,
    "GET",
    requestUrl,
    signer,
  );
  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    35_000,
    withEnvironmentCredentials(
      prepared.httpAuthorization,
      client.skills.detail({ headers, query, params }),
    ),
  );
});
