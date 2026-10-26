import { requireOptionalNativeModule } from "expo";
import { useEffect, useEffectEvent } from "react";

import { whenRootNavigationReady } from "../layout/root-navigation-ready";

// iOS-only: Android has no Action button and uses the "New task" launcher shortcut instead.
const AppIntents = requireOptionalNativeModule<{
  takePendingIntent(): string | null;
  addListener(event: "onIntent", listener: () => void): { remove(): void };
}>("T3AppIntents");

/** Runs when the "New Task" App Shortcut fires from the Action button, Siri, or Spotlight. */
export function useNewTaskAppIntent(onNewTask: () => void): void {
  const handlePendingIntent = useEffectEvent(() => {
    if (AppIntents?.takePendingIntent() === "newTask") {
      onNewTask();
    }
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- Drains intents queued natively before JS mounted, then listens for new ones.
  useEffect(() => {
    if (!AppIntents) return;
    let cancel = whenRootNavigationReady(handlePendingIntent);
    const subscription = AppIntents.addListener("onIntent", () => {
      cancel();
      cancel = whenRootNavigationReady(handlePendingIntent);
    });
    return () => {
      subscription.remove();
      cancel();
    };
  }, []);
}
