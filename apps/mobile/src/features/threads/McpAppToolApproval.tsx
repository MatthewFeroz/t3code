import {
  mcpAppToolCallHighlights,
  summarizeMcpAppToolCall,
} from "@t3tools/client-runtime/mcp-apps/tool-call";
import {
  countRequestItemTypes,
  formatRequestSize,
  parseEmbeddedJson,
  previewRequestScalar,
  summarizeRequestValue,
} from "@t3tools/client-runtime/mcp-apps/request";
import * as Predicate from "effect/Predicate";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";

type Approval = {
  readonly summary: ReturnType<typeof summarizeMcpAppToolCall>;
  readonly args: Record<string, unknown>;
  readonly resolve: (approved: boolean) => void;
};

/** An app's approval stays inspectable without putting its payload in a native alert. */
export function useMcpAppToolApproval() {
  const [request, setRequest] = useState<Approval | null>(null);
  const pending = useRef<Approval | null>(null);
  const mounted = useRef(true);
  const cancelToolCall = useCallback(() => {
    pending.current?.resolve(false);
    pending.current = null;
    setRequest(null);
  }, []);
  const respond = useCallback((approval: Approval, approved: boolean) => {
    if (pending.current !== approval) return;
    pending.current = null;
    setRequest(null);
    approval.resolve(approved);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, []);

  const confirmToolCall = useCallback(
    (
      server: string,
      name: string,
      info: { readonly title?: string; readonly tool?: unknown },
      args: Record<string, unknown>,
    ) =>
      new Promise<boolean>((resolve) => {
        if (!mounted.current) {
          resolve(false);
          return;
        }
        // Like native alerts, a replacement declines the previous request.
        pending.current?.resolve(false);
        const approval = {
          summary: summarizeMcpAppToolCall({ server, name, title: info.title, tool: info.tool }),
          args,
          resolve,
        };
        pending.current = approval;
        setRequest(approval);
      }),
    [],
  );

  return {
    confirmToolCall,
    cancelToolCall,
    approvalDialog: request ? (
      <McpAppToolApproval request={request} onRespond={(approved) => respond(request, approved)} />
    ) : null,
  };
}

function McpAppToolApproval(props: {
  readonly request: Approval;
  readonly onRespond: (approved: boolean) => void;
}) {
  const { request, onRespond } = props;
  const insets = useSafeAreaInsets();
  const [showRequest, setShowRequest] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [previous, setPrevious] = useState(request);
  if (previous !== request) {
    setPrevious(request);
    setShowRequest(false);
    setShowDescription(false);
  }
  const { question, identifier, description } = request.summary;
  const descriptionIsLong = description !== undefined && description.length > 300;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onRespond(false)}>
      <View
        className="flex-1 justify-center bg-backdrop px-6"
        style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
      >
        <View className="max-h-full rounded-3xl bg-card">
          <View className="shrink-0 gap-2 border-b border-border px-6 py-4">
            <Text accessibilityRole="header" className="text-lg font-t3-medium">
              {question}
            </Text>
            <Text selectable className="text-xs text-foreground-muted">
              {identifier}
            </Text>
          </View>
          <ScrollView className="shrink" contentContainerClassName="gap-3 p-6">
            {description ? (
              <View className="gap-1">
                <Text className="text-xs text-foreground-muted">Server description</Text>
                <Text selectable className="text-sm text-foreground-secondary">
                  {descriptionIsLong && !showDescription
                    ? `${description.slice(0, 300)}…`
                    : description}
                </Text>
                {descriptionIsLong ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setShowDescription((value) => !value)}
                  >
                    <Text className="text-sm text-primary-text">
                      {showDescription ? "Less" : "More"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {mcpAppToolCallHighlights(request.args).map(({ name, value }) => (
              <Text key={name} selectable className="text-sm">
                {name}: {value}
              </Text>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showRequest }}
              onPress={() => setShowRequest((value) => !value)}
            >
              <Text className="text-sm text-primary-text">
                {showRequest ? "Hide request" : "Show request"} · {formatRequestSize(request.args)}
              </Text>
            </Pressable>
            {showRequest ? (
              <View className="rounded-xl border border-border p-3">
                <RequestEntries entries={Object.entries(request.args)} />
              </View>
            ) : null}
          </ScrollView>
          <View className="shrink-0 flex-row justify-end gap-3 border-t border-border px-6 py-4">
            <Pressable
              accessibilityRole="button"
              className="min-h-10 justify-center px-3"
              onPress={() => onRespond(false)}
            >
              <Text className="text-base font-t3-medium">Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="min-h-10 justify-center px-3"
              onPress={() => onRespond(true)}
            >
              <Text className="text-base font-t3-medium text-primary-text">Allow</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RequestArgument({ name, value: raw }: { readonly name: string; readonly value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const value = parseEmbeddedJson(raw);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Predicate.isObject(value)
      ? Object.entries(value)
      : undefined;
  const text =
    entries !== undefined
      ? ""
      : typeof value === "string"
        ? value
        : (JSON.stringify(value) ?? String(value));
  const canExpand = entries !== undefined || previewRequestScalar(value) !== text;
  const summary =
    entries === undefined
      ? previewRequestScalar(value)
      : previewRequestScalar(summarizeRequestValue(value));
  const types = Array.isArray(value) ? countRequestItemTypes(value) : undefined;
  const row = (
    <View className="min-h-11 flex-row items-center gap-2 py-2">
      {canExpand ? (
        <SymbolView
          name={expanded ? "chevron.down" : "chevron.right"}
          size={12}
          tintColorClassName="accent-icon-muted"
        />
      ) : null}
      <View className="flex-1 gap-1">
        <Text className="text-xs font-t3-medium">{name}</Text>
        <Text selectable={!canExpand} className="text-xs text-foreground-secondary">
          {summary}
        </Text>
        {raw !== value ? <Text className="text-xs text-foreground-muted">JSON</Text> : null}
      </View>
    </View>
  );
  return (
    <View>
      {canExpand ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${name}, ${summary}`}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((current) => !current)}
        >
          {row}
        </Pressable>
      ) : (
        row
      )}
      {expanded ? (
        <View className="border-l border-border pl-3">
          {types ? <Text className="text-xs text-foreground-muted">{types}</Text> : null}
          {entries ? (
            <RequestEntries entries={entries} />
          ) : (
            <Text selectable className="text-xs text-foreground-secondary">
              {text}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function RequestEntries({
  entries,
}: {
  readonly entries: ReadonlyArray<readonly [string, unknown]>;
}) {
  const [shown, setShown] = useState(100);
  return (
    <View>
      {entries.length === 0 ? <Text className="text-xs text-foreground-muted">Empty</Text> : null}
      {entries.slice(0, shown).map(([name, value]) => (
        <RequestArgument key={name} name={name} value={value} />
      ))}
      {entries.length > shown ? (
        <Pressable
          accessibilityRole="button"
          className="min-h-11 justify-center"
          onPress={() => setShown((count) => count + 100)}
        >
          <Text className="text-sm text-primary-text">
            Show {Math.min(100, entries.length - shown)} more of {entries.length - shown}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
