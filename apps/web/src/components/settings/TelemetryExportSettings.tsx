import type { OtlpEndpointCheckResult, OtlpSignal } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings } from "./useScopedSettings";
import { SettingsSection } from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";

const SIGNALS = [
  { key: "otlpTracesUrl", label: "Traces", signal: "traces" },
  { key: "otlpMetricsUrl", label: "Metrics", signal: "metrics" },
  { key: "otlpLogsUrl", label: "Logs", signal: "logs" },
] as const;

type SignalKey = (typeof SIGNALS)[number]["key"];

/**
 * The latest check for a signal; it describes the field only while `url` is still its value.
 * `null` is in flight. "unavailable" means the server could not run it, such as an older server.
 */
type EndpointCheck = {
  readonly url: string;
  readonly result: OtlpEndpointCheckResult | "unavailable" | null;
};

const isHttpUrl = (url: string) => /^https?:\/\/./.test(url);

function endpointStatus(url: string, check: EndpointCheck | undefined) {
  if (url === "") return { label: "Off", dot: "bg-muted-foreground/40" };
  if (check?.url !== url) return { label: "Not checked", dot: "bg-muted-foreground/40" };
  const { result } = check;
  if (result === null) return { label: "Checking…", dot: "bg-warning" };
  if (result === "unavailable") return { label: "Couldn't check", dot: "bg-muted-foreground/40" };
  switch (result._tag) {
    case "Accepted":
      return { label: `Connected · ${Math.round(result.latencyMs)} ms`, dot: "bg-success" };
    case "Rejected":
      return { label: `Rejected · HTTP ${result.status}`, dot: "bg-destructive" };
    case "Unreachable":
      return { label: result.timedOut ? "Timed out" : "Unreachable", dot: "bg-destructive" };
  }
}

export function TelemetryExportSettings() {
  const { environment, scope } = useSettingsScope();
  const saved = useScopedSettings((settings) => settings.observability);
  const [draft, setDraft] = useState<Partial<typeof saved>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const environmentId = scope.kind === "environment" ? environment?.environmentId : undefined;
  // Saved endpoints open as pending; the effect below sends their checks.
  const [checks, setChecks] = useState<Partial<Record<SignalKey, EndpointCheck>>>(() =>
    environmentId === undefined
      ? {}
      : Object.fromEntries(
          SIGNALS.filter(({ key }) => isHttpUrl(saved[key])).map(({ key }) => [
            key,
            { url: saved[key], result: null },
          ]),
        ),
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: true });
  // Failures show in the status instead of a toast per field.
  const checkOtlpEndpoint = useAtomCommand(serverEnvironment.checkOtlpEndpoint, {
    reportFailure: false,
    reportDefect: false,
  });
  const values = { ...saved, ...draft };
  const changedSignals = SIGNALS.filter(({ key }) => values[key].trim() !== saved[key]);
  const changed = changedSignals.length > 0;
  const running = environment?.serverConfig?.observability;

  const sendCheck = async (key: SignalKey, signal: OtlpSignal, url: string) => {
    if (!environmentId) return;
    const response = await checkOtlpEndpoint({ environmentId, input: { signal, url } });
    // A newer check for the same field replaces this one.
    setChecks((previous) => {
      if (previous[key]?.url !== url || previous[key].result !== null) return previous;
      const result = response._tag === "Success" ? response.value : "unavailable";
      return { ...previous, [key]: { url, result } };
    });
  };

  const checkEndpoint = (key: SignalKey, signal: OtlpSignal, url: string) => {
    if (!isHttpUrl(url)) return;
    setChecks((previous) => ({ ...previous, [key]: { url, result: null } }));
    void sendCheck(key, signal, url);
  };

  useEffect(() => {
    for (const { key, signal } of SIGNALS) {
      const check = checks[key];
      // oxlint-disable-next-line react/set-state-in-effect -- State changes only after the response arrives.
      if (check?.result === null) void sendCheck(key, signal, check.url);
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Runs once; the section remounts per environment.
  }, []);

  if (scope.kind !== "environment") {
    return (
      <SettingsSection title="OpenTelemetry export" id="telemetry-export">
        <SettingsScopeNotice target="environment">
          Choose one environment to configure its telemetry exports.
        </SettingsScopeNotice>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="OpenTelemetry export" id="telemetry-export">
      <form
        className="grid gap-4 px-4 py-4 sm:px-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!environment || saving) return;
          setSaving(true);
          setMessage(null);
          try {
            const result = await updateSettings({
              environmentId: environment.environmentId,
              input: {
                patch: {
                  observability: Object.fromEntries(
                    changedSignals.map(({ key }) => [key, values[key]]),
                  ),
                },
              },
            });
            if (result._tag === "Success") {
              setDraft({});
              setMessage("Saved. Restart the server to apply.");
            }
          } finally {
            setSaving(false);
          }
        }}
      >
        <p className="text-xs text-muted-foreground">
          Send traces, metrics, and logs to an OTLP HTTP receiver. Restart the server to apply.
          Environment variables override these settings.
        </p>
        {SIGNALS.map(({ key, label, signal }) => {
          const url = values[key].trim();
          const status = endpointStatus(url, checks[key]);
          return (
            <div key={key} className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <ConnectionStatusDot dotClassName={status.dot} />
                  <Label htmlFor={key}>{label} endpoint</Label>
                </div>
                <span className="text-xs text-muted-foreground">{status.label}</span>
              </div>
              <div className="flex gap-2">
                <Input
                  id={key}
                  size="sm"
                  type="url"
                  pattern="https?://.*"
                  title="Enter an HTTP or HTTPS endpoint, or leave empty to disable export."
                  placeholder={`http://localhost:4318/v1/${signal}`}
                  value={values[key]}
                  disabled={saving}
                  onChange={(event) => {
                    setDraft((previous) => ({ ...previous, [key]: event.target.value }));
                    setMessage(null);
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!isHttpUrl(url) || checks[key]?.result === null}
                  onClick={() => void checkEndpoint(key, signal, url)}
                >
                  Test
                </Button>
              </div>
              {saved[key] !== (running?.[key] ?? "") && (
                <p className="break-all text-xs text-muted-foreground">
                  Running: {running?.[key] || "Disabled"}
                </p>
              )}
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!changed || saving}
              onClick={() => {
                setDraft({});
                setMessage(null);
              }}
            >
              Discard
            </Button>
            <Button type="submit" size="xs" disabled={!changed || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </SettingsSection>
  );
}
