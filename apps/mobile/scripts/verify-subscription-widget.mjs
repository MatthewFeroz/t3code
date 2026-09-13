// Exercise the serialized widget with Expo's real extension JS runtime. This
// catches missing globals and unsupported native nodes; it does not run SwiftUI.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeVM from "node:vm";
import {
  subscriptionUsageProps,
  subscriptionUsageTimeline,
} from "../src/widgets/subscriptionUsageSnapshot.ts";

const mobile = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const require = NodeModule.createRequire(NodePath.join(mobile, "package.json"));
const widgets = NodePath.dirname(require.resolve("expo-widgets/package.json"));
const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-widget-runtime-"));
try {
  const bundle = NodePath.join(temp, "runtime.js");
  const build = NodeChildProcess.spawnSync(
    process.execPath,
    [
      require.resolve("expo/bin/cli"),
      "export:embed",
      "--platform",
      "ios",
      "--bundle-output",
      bundle,
      "--entry-file",
      NodePath.join(widgets, "bundle/index.ts"),
      "--dev",
      "false",
      "--skip-server",
    ],
    {
      cwd: mobile,
      stdio: "inherit",
      env: {
        ...process.env,
        EXPO_OVERRIDE_METRO_CONFIG: NodePath.join(widgets, "metro.config.js"),
      },
    },
  );
  NodeAssert.equal(build.status, 0, "Expo extension runtime must build");
  const presetRequire = NodeModule.createRequire(require.resolve("babel-preset-expo"));
  const babel = presetRequire("@babel/core");
  const compiled = babel.transformFileSync(
    NodePath.join(mobile, "src/widgets/SubscriptionUsage.tsx"),
    {
      cwd: mobile,
      caller: {
        name: "metro",
        bundler: "metro",
        platform: "ios",
        projectRoot: mobile,
        isDev: false,
        supportsStaticESM: true,
      },
    },
  );
  const ast = babel.parseSync(compiled.code, { configFile: false, babelrc: false });
  const layout = ast.program.body
    .flatMap((node) => node.declarations ?? [])
    .find((node) => node.id.name === "SubscriptionUsage")?.init;
  NodeAssert.equal(layout?.type, "TemplateLiteral", "Expo must serialize the widget function");
  const context = NodeVM.createContext({ console });
  NodeVM.runInContext(NodeFS.readFileSync(bundle, "utf8"), context, { timeout: 10_000 });
  NodeVM.runInContext(
    `globalThis.__expoWidgetLayout = (${layout.quasis[0].value.cooked})`,
    context,
  );
  // Match the native renderer that will consume this SDK version's output.
  const swift = NodeFS.readFileSync(
    NodePath.join(widgets, "ios/Widgets/DynamicView.swift"),
    "utf8",
  );
  const nativeTypes = new Set([...swift.matchAll(/case "([^"]+)":/g)].map((match) => match[1]));
  function inspect(node, texts = [], bars = []) {
    if (node == null || node === false) return texts;
    if (Array.isArray(node)) {
      for (const child of node) inspect(child, texts, bars);
      return texts;
    }
    NodeAssert.equal(typeof node, "object", "Widget children must be native view nodes");
    NodeAssert.ok(nativeTypes.has(node.type), `Unsupported SwiftUI node: ${node.type}`);
    if (typeof node.props?.text === "string") texts.push(node.props.text);
    if (node.type === "ProgressView") bars.push(node.props.value);
    inspect(node.props?.children, texts, bars);
    return texts;
  }
  const now = Date.parse("2026-09-12T12:00:00Z");
  const accounts = ["codex", "claudeAgent"].map((driver) => ({
    key: driver,
    driver,
    displayName: null,
    email: "private@example.com",
    environments: [],
    limits: {
      checkedAt: new Date(now).toISOString(),
      windows: [
        {
          id: "session",
          kind: "session",
          label: "Session",
          usedPercent: 20,
          resetsAt: new Date(now + 60_000).toISOString(),
        },
        { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 93 },
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `scoped-${i}`,
          kind: "weekly",
          label: `Weekly · Model with a long name ${i}`,
          usedPercent: 30,
        })),
      ],
    },
  }));
  const timeline = subscriptionUsageTimeline(subscriptionUsageProps(accounts, now), now);
  const cases = [
    { props: {}, timestamp: now, empty: true },
    { props: timeline[0].props, timestamp: now, renderedAt: now + 900_000, empty: true },
    ...timeline.map((entry) => ({
      props: { ...entry.props, url: "t3code-dev://settings/usage?tab=limits" },
      timestamp: entry.date.getTime(),
      empty: entry.date.getTime() > now,
    })),
  ];
  let checks = 0;
  for (const widgetFamily of [
    "systemSmall",
    "systemMedium",
    "systemLarge",
    "systemExtraLarge",
    "accessoryRectangular",
  ]) {
    for (const colorScheme of ["light", "dark"])
      for (const widgetRenderingMode of ["fullColor", "accented", "vibrant"]) {
        for (const isLuminanceReduced of [false, true])
          for (const levelOfDetail of ["default", "simplified"]) {
            for (const scenario of cases) {
              NodeVM.runInContext(
                `Date.now = () => ${scenario.renderedAt ?? scenario.timestamp}`,
                context,
              );
              const node = context.__expoWidgetRender(scenario.props, {
                timestamp: scenario.timestamp,
                widgetFamily,
                colorScheme,
                widgetRenderingMode,
                isLuminanceReduced,
                levelOfDetail,
              });
              const bars = [];
              const texts = inspect(node, [], bars);
              if (scenario.props.url) {
                NodeAssert.ok(
                  JSON.stringify(node).includes(scenario.props.url),
                  "Every family must open Limits in the publishing app variant",
                );
              } else {
                NodeAssert.ok(
                  !JSON.stringify(node).includes("t3code://"),
                  "Missing URLs must not redirect development widgets to the production app",
                );
              }
              NodeAssert.ok(
                texts.some((text) => text.startsWith("Codex")) &&
                  texts.some((text) => text.startsWith("Claude")),
              );
              NodeAssert.ok(
                !JSON.stringify(node).includes("private@example.com"),
                "Account identities must not reach the widget",
              );
              if (scenario.empty) {
                NodeAssert.equal(bars.length, 0, "Unknown/stale limits must not draw quota bars");
                NodeAssert.ok(
                  !texts.some((text) => text.includes("more in T3")),
                  "Expired readings must not advertise hidden fresh limits",
                );
                NodeAssert.ok(
                  !texts.some((text) => text.includes("% left")),
                  "No fabricated quota in unknown/stale states",
                );
              } else if (
                widgetFamily === "accessoryRectangular" ||
                levelOfDetail === "simplified"
              ) {
                NodeAssert.ok(
                  texts.includes("7% left"),
                  "Compact layout must surface the tightest limit",
                );
                NodeAssert.deepEqual(
                  bars,
                  [0.07, 0.07],
                  "Bars must show remaining, not used quota",
                );
              } else {
                const perProvider =
                  widgetFamily === "systemExtraLarge" ? 6 : widgetFamily === "systemLarge" ? 4 : 2;
                NodeAssert.deepEqual(
                  bars.slice(0, 2),
                  [0.8, 0.07],
                  "Both must retain Codex session and weekly limits ahead of scoped windows",
                );
                NodeAssert.deepEqual(
                  bars.slice(perProvider, perProvider + 2),
                  [0.8, 0.07],
                  "Both must retain Claude session and weekly limits ahead of scoped windows",
                );
              }
              checks++;
            }
          }
      }
  }
  for (const widgetFamily of ["systemSmall", "accessoryRectangular"]) {
    NodeVM.runInContext(`Date.now = () => ${now}`, context);
    const bars = [];
    inspect(
      context.__expoWidgetRender(timeline[0].props, {
        timestamp: now,
        widgetFamily,
        configuration: { codexPeriod: "session", claudePeriod: "weekly" },
      }),
      [],
      bars,
    );
    NodeAssert.deepEqual(bars, [0.8, 0.07], "Each provider must honor its own selected period");
    checks++;
  }
  console.log(
    `Passed ${checks} serialized widget runtime scenarios. Native layout/signing still require Xcode.`,
  );
} finally {
  NodeFS.rmSync(temp, { recursive: true, force: true });
}
