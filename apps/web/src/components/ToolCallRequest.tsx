import { ChevronRightIcon } from "lucide-react";
import * as Predicate from "effect/Predicate";
import { useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import {
  countRequestItemTypes,
  formatRequestSize,
  parseEmbeddedJson,
  previewRequestScalar,
  summarizeRequestValue,
} from "./ToolCallRequest.logic";

// Past this many, a list shows the first ones and a count of the rest.
const LIST_LIMIT = 100;

/**
 * A tool call's arguments, folded behind "Show request" and laid out as data:
 * each argument labeled from the tool's schema, JSON inside strings unpacked,
 * and every object or list closed until it is opened.
 */
export function ToolCallRequest(props: {
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly argumentDescriptions: Readonly<Record<string, string>>;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const entries = Object.entries(props.arguments);
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
              entries.map(([name, value]) => (
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
  const [open, setOpen] = useState(props.defaultOpen === true);

  if (!Array.isArray(value) && !Predicate.isObject(value)) {
    return (
      <div className="flex min-w-0 items-baseline gap-2 py-0.5 pl-4">
        {props.name === undefined ? null : (
          <span className="shrink-0 font-mono text-muted-foreground">{props.name}</span>
        )}
        <span className="min-w-0 truncate">{previewRequestScalar(value)}</span>
      </div>
    );
  }

  const items = Array.isArray(value) ? value : undefined;
  const types = items === undefined ? undefined : countRequestItemTypes(items);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full min-w-0 cursor-pointer items-baseline gap-2 py-0.5 text-left"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 self-center text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
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
      </button>
      {open ? (
        <div className="pl-4">
          {types === undefined ? null : <p className="py-0.5 text-muted-foreground">{types}</p>}
          {items === undefined
            ? Object.entries(value).map(([key, child]) => (
                <RequestValue key={key} name={key} value={child} />
              ))
            : items.slice(0, LIST_LIMIT).map((child, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- A request never reorders; items may be identical.
                <RequestValue key={index} value={child} />
              ))}
          {items !== undefined && items.length > LIST_LIMIT ? (
            <p className="py-0.5 text-muted-foreground">
              {(items.length - LIST_LIMIT).toLocaleString()} more
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
