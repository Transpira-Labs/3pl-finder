"use client";

import { ConsoleView } from "@/components/console-view";

/**
 * Full-page Call Console (rep view). The same UI is also available to admins as a
 * floating dock (`ConsoleDock`) so they don't have to switch tabs — both render
 * the shared `ConsoleView`. The `/console` layout provides the TrackerProvider.
 */
export default function ConsolePage() {
  return <ConsoleView />;
}
