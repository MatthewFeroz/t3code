import { HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  minimumScaleFactor,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import type { SubscriptionUsageSnapshot as SubscriptionUsageProps } from "./subscriptionUsageSnapshot";

function SubscriptionUsage(props: SubscriptionUsageProps, environment: WidgetEnvironment) {
  "widget";
  // The extension evaluates this function without the app's module scope.
  const family = environment.widgetFamily;
  // Gallery snapshots can render an old timeline entry after it has expired.
  const now = Math.max(environment.date.getTime(), Date.now());
  const accessory = family === "accessoryRectangular";
  const compact =
    family === "systemSmall" || accessory || environment.levelOfDetail === "simplified";
  const limit = family === "systemExtraLarge" ? 6 : family === "systemLarge" ? 4 : 2;
  const monochrome =
    environment.widgetRenderingMode !== "fullColor" || environment.isLuminanceReduced;
  const providers = props.providers ?? [
    { name: "Codex", detail: "Open T3 to connect", windows: [], expiresAt: 0 },
    { name: "Claude", detail: "Open T3 to connect", windows: [], expiresAt: 0 },
  ];
  const columns = providers.map((provider) => {
    const stale = provider.windows.length > 0 && now >= provider.expiresAt;
    const windows = stale ? [] : provider.windows;
    // Small/Lock Screen widgets name the tightest reported limit, rather than
    // hiding an exhausted weekly or model-specific bucket behind a session value.
    const tightest = windows.reduce<(typeof windows)[number] | undefined>(
      (result, window) => (!result || window.remaining < result.remaining ? window : result),
      undefined,
    );
    const shown = compact ? (tightest ? [tightest] : []) : windows.slice(0, limit);
    const detail = stale ? "Open T3 to refresh" : provider.detail;
    if (accessory) {
      return (
        <HStack
          key={provider.name}
          spacing={4}
          modifiers={[
            accessibilityElement("ignore"),
            accessibilityLabel(
              tightest
                ? `${provider.name}, ${tightest.label}, ${tightest.remaining} percent remaining. ${tightest.reset}. ${provider.detail}.`
                : `${provider.name}. ${detail}.`,
            ),
          ]}
        >
          <Text
            modifiers={[
              font({ textStyle: "caption", weight: "semibold" }),
              lineLimit(1),
              minimumScaleFactor(0.75),
              foregroundStyle("primary"),
            ]}
          >
            {provider.name}
            {tightest ? ` · ${tightest.label}` : ""}
          </Text>
          <Spacer />
          <Text
            modifiers={[
              font({ textStyle: "caption", weight: "semibold" }),
              lineLimit(1),
              layoutPriority(1),
              foregroundStyle("primary"),
            ]}
          >
            {tightest ? `${tightest.remaining}% left` : "Open T3"}
          </Text>
        </HStack>
      );
    }
    return (
      <VStack
        key={provider.name}
        alignment="leading"
        spacing={compact ? 2 : 4}
        modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
      >
        <Text
          modifiers={[
            font({ textStyle: accessory ? "caption" : "headline", weight: "bold" }),
            lineLimit(1),
            minimumScaleFactor(0.75),
            foregroundStyle("primary"),
          ]}
        >
          {provider.name}
        </Text>
        {!compact || shown.length === 0 ? (
          <Text
            modifiers={[
              font({ textStyle: "caption2" }),
              foregroundStyle("secondary"),
              lineLimit(compact ? 1 : 2),
            ]}
          >
            {detail}
          </Text>
        ) : null}
        {shown.map((window) => (
          <VStack
            key={window.label}
            alignment="leading"
            spacing={2}
            modifiers={[
              accessibilityElement("ignore"),
              accessibilityLabel(
                `${provider.name}, ${window.label}, ${window.remaining} percent remaining. ${window.reset}. ${provider.detail}.`,
              ),
            ]}
          >
            <HStack spacing={4}>
              <Text
                modifiers={[
                  font({ textStyle: "caption" }),
                  foregroundStyle("secondary"),
                  lineLimit(1),
                  minimumScaleFactor(0.75),
                ]}
              >
                {window.label}
              </Text>
              <Spacer />
              <Text
                modifiers={[
                  font({ textStyle: "caption", weight: "semibold" }),
                  lineLimit(1),
                  minimumScaleFactor(0.75),
                  layoutPriority(1),
                  foregroundStyle(
                    window.remaining <= 10 && !monochrome
                      ? environment.colorScheme === "light"
                        ? "#dc2626"
                        : "#fca5a5"
                      : "primary",
                  ),
                ]}
              >
                {window.remaining}% left
              </Text>
            </HStack>
            {!compact ? (
              <Text
                modifiers={[
                  font({ textStyle: "caption2" }),
                  foregroundStyle("secondary"),
                  lineLimit(1),
                  minimumScaleFactor(0.75),
                ]}
              >
                {window.reset}
              </Text>
            ) : null}
          </VStack>
        ))}
        {!compact && !stale && (provider.totalWindows ?? windows.length) > limit ? (
          <Text modifiers={[font({ textStyle: "caption2" }), foregroundStyle("secondary")]}>
            {(provider.totalWindows ?? windows.length) - limit} more in T3
          </Text>
        ) : null}
      </VStack>
    );
  });
  return (
    <VStack
      alignment="leading"
      spacing={accessory ? 2 : 6}
      modifiers={[widgetURL(props.url ?? "t3code://settings/usage?tab=limits")]}
    >
      {compact ? (
        <VStack alignment="leading" spacing={accessory ? 4 : 8}>
          {columns}
        </VStack>
      ) : (
        <HStack alignment="top" spacing={16}>
          {columns}
        </HStack>
      )}
      {!accessory ? <Spacer /> : null}
      {!accessory ? (
        <Text
          modifiers={[
            font({ textStyle: "caption2" }),
            foregroundStyle("secondary"),
            lineLimit(1),
            minimumScaleFactor(0.75),
          ]}
        >
          {props.checkedAt
            ? `As of ${new Date(props.checkedAt).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}`
            : "Tap to connect in T3"}
        </Text>
      ) : null}
    </VStack>
  );
}

export default createWidget("SubscriptionUsage", SubscriptionUsage);
