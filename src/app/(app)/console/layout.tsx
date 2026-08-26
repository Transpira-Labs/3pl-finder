"use client";

import { TrackerProvider } from "@/components/tracker-provider";
import { DispositionHost } from "@/components/disposition-host";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <TrackerProvider>
      {children}
      <DispositionHost />
    </TrackerProvider>
  );
}
