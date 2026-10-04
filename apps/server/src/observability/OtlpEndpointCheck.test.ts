import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { DEFAULT_SIGNAL_EXPORT } from "@t3tools/shared/observability";
import * as OtelEnvironment from "@t3tools/shared/otelEnvironment";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as OtlpEndpointCheck from "./OtlpEndpointCheck.ts";

interface PostedRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Answers every post with `status`, or fails like a refused connection when it is null. */
const checkWith = (
  status: number | null,
  overrides: Partial<ServerConfig.ServerConfig["Service"]> = {},
) => {
  const requests: Array<PostedRequest> = [];
  const httpClient = HttpClient.make((request) => {
    requests.push({
      url: request.url,
      headers: request.headers,
      body: request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
    });
    return status === null
      ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          }),
        )
      : Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status })));
  });
  const configLayer = Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return ServerConfig.make({ ...config, ...overrides });
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-otlp-check-" })));
  const layer = OtlpEndpointCheck.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
    Layer.provide(configLayer),
    Layer.provide(NodeServices.layer),
  );
  return { requests, layer };
};

const check = (input: Parameters<OtlpEndpointCheck.OtlpEndpointCheck["Service"]["check"]>[0]) =>
  Effect.gen(function* () {
    const service = yield* OtlpEndpointCheck.OtlpEndpointCheck;
    return yield* service.check(input);
  });

describe("OtlpEndpointCheck", () => {
  it.effect("posts an empty export for the signal with the T3 headers", () => {
    const { requests, layer } = checkWith(200, {
      otlpMetricsExport: { ...DEFAULT_SIGNAL_EXPORT, headers: { authorization: "Bearer t3" } },
    });
    return Effect.gen(function* () {
      const result = yield* check({ signal: "metrics", url: "http://collector:4318/v1/metrics" });

      assert.strictEqual(result._tag, "Accepted");
      assert.lengthOf(requests, 1);
      assert.strictEqual(requests[0]?.url, "http://collector:4318/v1/metrics");
      assert.strictEqual(requests[0]?.headers.authorization, "Bearer t3");
      assert.strictEqual(requests[0]?.body, `{"resourceMetrics":[]}`);
    }).pipe(Effect.provide(layer));
  });

  it.effect("reports the status a receiver rejects the export with", () => {
    const { layer } = checkWith(401);
    return Effect.gen(function* () {
      const result = yield* check({ signal: "traces", url: "http://collector:4318/v1/traces" });

      assert.deepStrictEqual(result, { _tag: "Rejected", status: 401 });
    }).pipe(Effect.provide(layer));
  });

  it.effect("reports an endpoint that cannot be reached", () => {
    const { layer } = checkWith(null);
    return Effect.gen(function* () {
      const result = yield* check({ signal: "logs", url: "http://localhost:1/v1/logs" });

      assert.deepStrictEqual(result, { _tag: "Unreachable", timedOut: false });
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps OTEL endpoint credentials off other endpoints", () => {
    const otelUrl = "https://otel.example.com/v1/traces";
    const otelExport = { ...DEFAULT_SIGNAL_EXPORT, headers: { "x-api-key": "secret" } };
    const { requests, layer } = checkWith(200, {
      otlpTracesUrl: otelUrl,
      otlpTracesExport: otelExport,
      otelEnvironment: {
        ...OtelEnvironment.none,
        traces: OtelEnvironment.OtelSignal.Export({
          url: otelUrl,
          protocol: otelExport.protocol,
          headers: otelExport.headers,
        }),
      },
    });
    return Effect.gen(function* () {
      yield* check({ signal: "traces", url: otelUrl });
      yield* check({ signal: "traces", url: "https://elsewhere.example.com/v1/traces" });

      assert.strictEqual(requests[0]?.headers["x-api-key"], "secret");
      assert.isUndefined(requests[1]?.headers["x-api-key"]);
    }).pipe(Effect.provide(layer));
  });
});
