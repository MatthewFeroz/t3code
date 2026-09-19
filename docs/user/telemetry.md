# Product usage data

The T3 Code server sends product usage events to PostHog, associated with a hashed account or
installation identifier. Events include the provider, model, reasoning effort, permission mode,
turn result, duration, and main-agent token totals when available.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, or child-agent output. Child-agent token use is excluded from the totals.

To disable collection, set `T3CODE_TELEMETRY_ENABLED=false` in the server's environment before
starting it. This stops product events from being recorded or sent.

## Export diagnostics to your own receiver

To collect traces, metrics, or logs in an OpenTelemetry-compatible service, open
**Settings > General > Diagnostics** on web or desktop and select the environment
you want to monitor. Under **OpenTelemetry export**, enter each signal's full
OTLP HTTP endpoint, save, and restart that environment's server. For example,
a local receiver commonly uses `http://localhost:4318/v1/traces`, `/v1/metrics`,
and `/v1/logs` as its three endpoints.

The receiver must be reachable from the server's machine. For a remote server,
`localhost` means that remote machine. These settings apply to the environment,
including when you use it from mobile.

Clear a field and save to disable that signal after restarting. Server environment
variables and desktop startup configuration take precedence over saved endpoints;
remove those overrides too if they are configured. The running configuration is
shown separately so you can compare it with your saved settings. Confirm delivery
in your receiver by checking for recent records.

Diagnostic exports go to the receiver you configure and are controlled separately
from product usage collection. Update older servers if log export is unavailable.
