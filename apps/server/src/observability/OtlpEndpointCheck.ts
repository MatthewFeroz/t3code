import type {
  OtlpEndpointCheckInput,
  OtlpEndpointCheckResult,
  OtlpSignal,
} from "@t3tools/contracts";
import { otlpSerializationLayer } from "@t3tools/shared/observability";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient } from "effect/unstable/http";
import { OtlpSerialization } from "effect/unstable/observability";

import * as ServerConfig from "../config.ts";

const CHECK_TIMEOUT = "5 seconds";

export class OtlpEndpointCheck extends Context.Service<
  OtlpEndpointCheck,
  {
    /**
     * Posts an empty export for the signal to `url` from this server, with the
     * protocol and credentials a saved endpoint would export with. Receivers
     * accept an empty export without storing anything.
     */
    readonly check: (input: OtlpEndpointCheckInput) => Effect.Effect<OtlpEndpointCheckResult>;
  }
>()("t3/observability/OtlpEndpointCheck") {}

const emptyExport = (
  serialization: OtlpSerialization.OtlpSerialization["Service"],
  signal: OtlpSignal,
) => {
  switch (signal) {
    case "traces":
      return serialization.traces({ resourceSpans: [] });
    case "metrics":
      return serialization.metrics({ resourceMetrics: [] });
    case "logs":
      return serialization.logs({ resourceLogs: [] });
  }
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const httpClient = yield* HttpClient.HttpClient;

  const running = {
    traces: { url: config.otlpTracesUrl, export: config.otlpTracesExport },
    metrics: { url: config.otlpMetricsUrl, export: config.otlpMetricsExport },
    logs: { url: config.otlpLogsUrl, export: config.otlpLogsExport },
  } satisfies Record<OtlpSignal, unknown>;

  const check = Effect.fn("OtlpEndpointCheck.check")(function* ({
    signal,
    url,
  }: OtlpEndpointCheckInput) {
    const { url: runningUrl, export: signalExport } = running[signal];
    // Credentials from an OTEL_EXPORTER_OTLP_* endpoint stay paired with that
    // endpoint. Every other source shares T3CODE_OTLP_HEADERS, which a saved
    // endpoint would also export with.
    const headers =
      url === runningUrl || config.otelEnvironment[signal]._tag !== "Export"
        ? signalExport.headers
        : undefined;
    const body = yield* Effect.gen(function* () {
      const serialization = yield* OtlpSerialization.OtlpSerialization;
      return emptyExport(serialization, signal);
    }).pipe(Effect.provide(otlpSerializationLayer(signalExport.protocol)));
    const startedAt = yield* Clock.currentTimeMillis;
    const response = yield* httpClient
      .post(url, { body, headers })
      .pipe(Effect.timeoutOption(CHECK_TIMEOUT), Effect.option);
    if (Option.isNone(response)) {
      return { _tag: "Unreachable", timedOut: false } as const;
    }
    if (Option.isNone(response.value)) {
      return { _tag: "Unreachable", timedOut: true } as const;
    }
    const { status } = response.value.value;
    if (status < 200 || status >= 300) {
      return { _tag: "Rejected", status } as const;
    }
    const latencyMs = (yield* Clock.currentTimeMillis) - startedAt;
    return { _tag: "Accepted", latencyMs } as const;
  });

  return OtlpEndpointCheck.of({ check });
});

export const layer = Layer.effect(OtlpEndpointCheck, make);
