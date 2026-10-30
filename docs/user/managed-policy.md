# Managed policy

A managed policy lets an administrator configure T3 Code for every user on a machine. Deploy it
with your usual device management tool (Jamf, Kandji, Intune, Group Policy, Ansible). The T3 Code
server on that machine follows it, whichever app connects: desktop, the browser, or mobile.

## Where the policy goes

Deploy the policy one way per machine:

| OS      | Native                                         | File                                              |
| ------- | ---------------------------------------------- | ------------------------------------------------- |
| macOS   | Configuration profile for `com.t3tools.t3code` | `/Library/Application Support/T3Code/policy.json` |
| Windows | Group Policy template                          | `C:\ProgramData\T3Code\policy.json`               |
| Linux   |                                                | `/etc/t3code/policy.json`                         |

Run `t3 policy templates <directory>` to write the Group Policy template and a configuration
profile. Add `--policy <file>` to put that policy in the profile instead of a sample.

- **macOS profile:** upload `macos/t3code.mobileconfig` to your device management tool, or build
  a custom settings payload for `com.t3tools.t3code` whose keys are the policy's top-level keys
  (`schemaVersion`, `organization`, `settings`, `limits`), with nested dictionaries for the rest.
  Install it as a device profile; user profiles are ignored.
- **Windows Group Policy:** copy `windows/t3code.admx` and `windows/en-US/t3code.adml` into your
  `PolicyDefinitions` folder or central store, or import them into Intune. The policies appear
  under Computer Configuration > Administrative Templates > T3 Code. Set **Organization** whenever
  you set any other T3 Code policy. Locks and provider fields go in the two JSON policies, as the
  same objects a policy file would hold.
- **File:** make it writable only by administrators.

T3 Code refuses to start if a machine has both a native policy and a file. It reads the policy when
the server starts, so restart the app after you deploy or change it. Without a policy, every
setting belongs to the user.

## Settings

```json
{
  "schemaVersion": 1,
  "organization": "Example Corp",
  "supportUrl": "https://it.example.com/t3",
  "settings": {
    "defaultRuntimeMode": { "value": "approval-required", "locked": false },
    "enableAgentBrowserAccess": { "value": false, "locked": true },
    "storageCleanup.logsAfterDays": { "value": 30, "locked": true }
  }
}
```

Each key under `settings` names a server setting by its path in the server's `settings.json`.

- `"locked": false` sets the default. Users start there and can change it.
- `"locked": true` sets the value and stops users and agents from changing it, including in
  per-project settings. Settings shows the control as **Managed by** your organization.

A default changes an existing setting but cannot add an entry, such as a provider instance, because
users could never remove it. Lock the entry, or set provider fields with
[`providers.instances`](#providers). A setting that can be empty, such as `defaultModelSelection`,
is managed as a whole rather than one field inside it.

T3 Code never writes policy values into the user's own settings. If you remove the policy, users
get back the settings they had chosen.

## Limits

`limits` restricts what T3 Code may do. Leave a key out to keep T3 Code's normal behavior.

```json
{
  "schemaVersion": 1,
  "organization": "Example Corp",
  "limits": {
    "maxRuntimeMode": "auto-accept-edits",
    "clients": ["desktop"],
    "connect": false,
    "webhookTasks": false,
    "browserCookieImport": false,
    "telemetry": false,
    "providers": {
      "allowedDrivers": ["claudeAgent", "codex"],
      "instances": {
        "claudeAgent": {
          "locked": true,
          "environment": [{ "name": "CLAUDE_CODE_USE_BEDROCK", "value": "1" }]
        }
      }
    },
    "updates": { "mode": "auto", "feedUrl": "https://updates.example.com/t3code/" }
  }
}
```

### Permission modes

`maxRuntimeMode` is the broadest [permission mode](./permission-modes.md) any thread may use:
`approval-required` (Supervised), `auto-accept-edits`, `auto`, or `full-access`. It applies to
threads users start, agents start, and scheduled tasks. A thread already above it cannot run
another turn until someone lowers its mode; its queued messages wait and send once it is lowered. A
user's default above the limit starts new threads at the limit instead.

With `maxRuntimeMode` set, each provider's launch settings belong to you: binary path, launch
arguments, config home, and every environment variable come from `providers.instances` or
T3 Code's defaults, and users cannot change them. Otherwise a wrapper script, a launch flag, or a
variable such as `NODE_OPTIONS` could turn off the provider's own approvals. Pin any variables
your users need, such as a gateway URL, in `providers.instances`.

Providers still read their own configuration from the user's home directory, for example
`~/.claude` and `~/.codex`. Restrict those with each provider's managed configuration; see
[What a policy does not cover](#what-a-policy-does-not-cover).

### Clients and T3 Connect

`clients` lists what may connect to the server:

- `desktop`: the desktop app on this machine.
- `local-browser`: a browser on this machine.
- `remote`: phones, other computers, app.t3.codes, and anything reached over the network.

Without `remote`, the server only listens on this machine, does not create pairing links, and
signs out devices that paired earlier. T3 Connect is a way for remote clients to reach the
machine, so it turns off too. To keep remote access but turn off only T3 Connect, set
`"connect": false`.

### Other capabilities

- `webhookTasks: false`: scheduled tasks cannot use webhook triggers. Existing webhook tasks are
  kept but do not run.
- `browserCookieImport: false`: users cannot import cookies from another browser into T3 Code's
  browser.
- `telemetry: false`: T3 Code sends no [product usage data](./telemetry.md) or relay connection
  traces, whatever the environment says. A policy cannot turn them on.

### Providers

`providers.allowedDrivers` lists the providers that may run: `codex`, `claudeAgent`, `cursor`,
`grok`, `opencode`, `antigravity`, `pi`, `muse`, and `acpRegistry`. Threads on other providers
stay, marked unavailable, and users can still turn those providers off.

`providers.instances` sets fields on every instance of a provider, such as an environment
variable that routes Claude through Amazon Bedrock or a base URL for a company gateway.
`binaryPath` and `launchArgs` apply to providers that have those settings. With `"locked": true`
users cannot change the fields you set; with `"locked": false` they fill only fields the user left
empty. A Codex pin that is locked, or set under `maxRuntimeMode`, also rules out
[Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), whose runtime would skip it.

The policy is readable by every user on the machine, so do not put credentials in it.

### Updates

- `mode`: `auto` keeps the normal update flow. `off` stops T3 Code from checking for updates, for
  machines that receive T3 Code through device management.
- `feedUrl`: the desktop app updates from your own mirror of the release feed instead of GitHub.
  Publish only the versions you have approved. The `t3` command-line server updates through npm,
  so pin it with your package tooling.
- `allowNightly: false`: the nightly channel is unavailable.

## Check a policy

Run `t3 policy check <file>` to validate a draft before you deploy it. Run `t3 policy show` on a
machine to see the policy that applies there.

T3 Code refuses to start with a policy it cannot fully apply: a policy it cannot read or parse, a
setting it does not know, a value of the wrong type, or a key that this version does not support.
`t3 policy check` reads a JSON file; for a profile or Group Policy, check the same JSON first.
A policy written for a newer version can carry keys an older one cannot enforce, so upgrade
T3 Code before you deploy the policy that uses them.

## What a policy does not cover

The policy controls what T3 Code does. Agents still run through each provider's own CLI, which a
user can also run outside T3 Code. To restrict those CLIs, use their own managed configuration, such
as Claude Code's managed settings. A user with administrator rights on the machine can edit or
remove the policy.
