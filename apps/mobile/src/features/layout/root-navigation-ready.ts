import { rootNavigationRef } from "../../lib/rootNavigation";

// Root-layout effects run before the root navigator registers, so a navigation sent from one is dropped.
const waiting = new Set<() => void>();

export function whenRootNavigationReady(run: () => void): () => void {
  if (rootNavigationRef.isReady()) {
    run();
    return () => {};
  }
  waiting.add(run);
  return () => {
    waiting.delete(run);
  };
}

/** The navigation container's `onReady`. */
export function flushRootNavigationReady(): void {
  const runs = [...waiting];
  waiting.clear();
  for (const run of runs) run();
}
