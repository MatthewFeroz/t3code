import { ChevronRightIcon } from "lucide-react";
import * as Predicate from "effect/Predicate";
import { useLayoutEffect, useRef, useState } from "react";

import type { ConfirmDialogToolCall } from "~/confirmDialog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { observeResize } from "~/lib/observeResize";
import { AlertDialogDescription } from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import {
  countRequestItemTypes,
  formatRequestSize,
  parseEmbeddedJson,
  previewRequestScalar,
  summarizeRequestValue,
} from "@t3tools/client-runtime/mcp-apps/request";

// A list shows this many items at a time; the rest are a click away.
const LIST_PAGE = 100;

/**
 * The body of an approval for a tool call: the exact tool, the server's
 * description of it, the short arguments the call acts on, and the full
 * request folded. The description is the server's claim, so the exact tool
 * and the arguments stay on screen with it.
 */
export function ToolCallDetails(props: { readonly toolCall: ConfirmDialogToolCall }) {
  const { toolCall } = props;
  return (
    <>
      <p className="font-mono text-muted-foreground text-xs wrap-anywhere">{toolCall.identifier}</p>
      {toolCall.description ? (
        <AlertDialogDescription render={<div />}>
          <p className="text-xs">Server description</p>
          <ClampedText text={toolCall.description} />
        </AlertDialogDescription>
      ) : null}
      {toolCall.highlights.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {toolCall.highlights.map((highlight) => (
            <div key={highlight.name} className="contents">
              <dt className="font-mono text-muted-foreground text-xs leading-5">
                {highlight.name}
              </dt>
              <dd className="wrap-anywhere">{highlight.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ToolCallRequest
        arguments={toolCall.arguments}
        argumentDescriptions={toolCall.argumentDescriptions}
      />
    </>
  );
}

/** Three lines of a server's description, with the rest one click away. */
function ClampedText(props: { readonly text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    return observeResize(element, measure);
  }, [expanded]);

  return (
    <div>
      <p ref={ref} className={cn("whitespace-pre-line", !expanded && "line-clamp-3")}>
        {props.text}
      </p>
      {clamped || expanded ? (
        <Button variant="link" size="xs" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Less" : "More"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A tool call's arguments, folded behind "Show request" and laid out as data:
 * each argument labeled from the tool's schema, JSON inside strings unpacked,
 * and every value reachable without leaving the dialog.
 */
function ToolCallRequest(props: {
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly argumentDescriptions: Readonly<Record<string, string>>;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const entries = Object.entries(props.arguments);
  const [shown, setShown] = useState(LIST_PAGE);
  const size = formatRequestSize(props.arguments);

  return (
    <Collapsible className="text-left">
      <CollapsibleTrigger className="group/request flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open/request:rotate-90" />
        Show request · {size}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="mt-2 rounded-lg border bg-muted/72">
          <div className="max-h-[min(16rem,40dvh)] overflow-y-auto overscroll-contain p-3 text-xs">
            {entries.length === 0 ? (
              <p className="text-muted-foreground">No arguments.</p>
            ) : (
              entries.slice(0, shown).map(([name, value]) => (
                <div key={name} className="not-first:mt-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono">{name}</span>
                    {props.argumentDescriptions[name] ? (
                      <span className="text-muted-foreground">
                        {props.argumentDescriptions[name]}
                      </span>
                    ) : null}
                  </div>
                  <RequestValue value={value} defaultOpen />
                </div>
              ))
            )}
            <MoreRequestItems
              count={entries.length}
              shown={shown}
              onShowMore={() => setShown((current) => current + LIST_PAGE)}
            />
          </div>
          <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-muted-foreground text-xs">
            <span>
              {entries.length === 1 ? "1 argument" : `${entries.length} arguments`} · {size}
            </span>
            <Button
              variant="link"
              size="xs"
              onClick={() => copyToClipboard(JSON.stringify(props.arguments, null, 2))}
            >
              {isCopied ? "Copied" : "Copy raw JSON"}
            </Button>
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function RequestValue(props: {
  readonly name?: string;
  readonly value: unknown;
  readonly defaultOpen?: boolean;
}) {
  const value = parseEmbeddedJson(props.value);
  const unpacked = value !== props.value;
  const container = Array.isArray(value) || Predicate.isObject(value);
  const [open, setOpen] = useState(props.defaultOpen === true && container);
  const [shown, setShown] = useState(LIST_PAGE);

  if (!Array.isArray(value) && !Predicate.isObject(value)) {
    const preview = previewRequestScalar(value);
    const full = typeof value === "string" ? value : preview;
    // A value cut short opens in full, so no part of the request is out of reach.
    if (preview === full) {
      return (
        <div className="flex min-w-0 items-baseline gap-2 py-0.5 pl-4">
          {props.name === undefined ? null : (
            <span className="shrink-0 font-mono text-muted-foreground">{props.name}</span>
          )}
          <span className="min-w-0 wrap-anywhere">{preview}</span>
        </div>
      );
    }
    return (
      <div className="min-w-0">
        <RowToggle open={open} onToggle={() => setOpen((current) => !current)}>
          {props.name === undefined ? null : (
            <span className="shrink-0 font-mono text-muted-foreground">{props.name}</span>
          )}
          <span className="min-w-0 truncate">{preview}</span>
        </RowToggle>
        {open ? (
          <p className="whitespace-pre-wrap py-0.5 pl-4 font-mono wrap-anywhere">{full}</p>
        ) : null}
      </div>
    );
  }

  const items = Array.isArray(value) ? value : undefined;
  const types = items === undefined ? undefined : countRequestItemTypes(items);
  const entries = items === undefined ? Object.entries(value) : undefined;
  const count = items?.length ?? entries?.length ?? 0;
  return (
    <div className="min-w-0">
      <RowToggle open={open} onToggle={() => setOpen((current) => !current)}>
        {props.name === undefined ? null : (
          <span className="shrink-0 font-mono text-muted-foreground">{props.name}</span>
        )}
        <span className="min-w-0 truncate text-muted-foreground">
          {summarizeRequestValue(value)}
        </span>
        {unpacked ? (
          <span className="shrink-0 rounded border px-1 font-mono text-3xs text-muted-foreground">
            JSON
          </span>
        ) : null}
      </RowToggle>
      {open ? (
        <div className="pl-4">
          {types === undefined ? null : <p className="py-0.5 text-muted-foreground">{types}</p>}
          {items === undefined
            ? entries
                ?.slice(0, shown)
                .map(([key, child]) => <RequestValue key={key} name={key} value={child} />)
            : items.slice(0, shown).map((child, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- A request never reorders; items may be identical.
                <RequestValue key={index} value={child} />
              ))}
          <MoreRequestItems
            count={count}
            shown={shown}
            onShowMore={() => setShown((current) => current + LIST_PAGE)}
          />
        </div>
      ) : null}
    </div>
  );
}

function MoreRequestItems(props: {
  readonly count: number;
  readonly shown: number;
  readonly onShowMore: () => void;
}) {
  const remaining = props.count - props.shown;
  if (remaining <= 0) return null;
  return (
    <Button variant="link" size="xs" onClick={props.onShowMore}>
      Show {Math.min(LIST_PAGE, remaining).toLocaleString()} more of {remaining.toLocaleString()}
    </Button>
  );
}

function RowToggle(props: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={props.open}
      className="flex w-full min-w-0 cursor-pointer items-baseline gap-2 py-0.5 text-left"
      onClick={props.onToggle}
    >
      <ChevronRightIcon
        className={cn(
          "size-3 shrink-0 self-center text-muted-foreground transition-transform",
          props.open && "rotate-90",
        )}
      />
      {props.children}
    </button>
  );
}
