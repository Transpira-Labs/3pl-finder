"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Call } from "@/lib/types";
import { loadSyncUrl, saveSyncUrl } from "@/lib/storage";
import { pingSheet, syncCalls } from "@/lib/sheets";

type Tone = "muted" | "ok" | "warn" | "err";

/** Google Sheets live sync settings + status. */
export function SyncPanel({
  calls,
  hydrated,
  onMarkSynced,
}: {
  calls: Call[];
  hydrated: boolean;
  onMarkSynced: (ids: string[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<{ text: string; tone: Tone }>({
    text: "Not connected. Paste your Google Sheet link to auto-log calls. One-time setup is in SHEETS_SETUP.md.",
    tone: "muted",
  });
  const syncingRef = useRef(false);
  const pending = calls.filter((c) => !c.synced).length;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(loadSyncUrl());
  }, []);

  const doSync = useCallback(async () => {
    const u = loadSyncUrl();
    if (!u || syncingRef.current) return;
    const toSync = calls.filter((c) => !c.synced);
    if (toSync.length === 0) return;
    syncingRef.current = true;
    setStatus({ text: `Syncing ${toSync.length}…`, tone: "muted" });
    try {
      const done = await syncCalls(u, toSync);
      if (done.length) onMarkSynced(done);
      setStatus(
        done.length === toSync.length
          ? { text: "All calls synced.", tone: "ok" }
          : { text: `Synced ${done.length}/${toSync.length}. Retry the rest.`, tone: "warn" },
      );
    } catch (e) {
      setStatus({ text: "Sync failed: " + (e as Error).message, tone: "err" });
    } finally {
      syncingRef.current = false;
    }
  }, [calls, onMarkSynced]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hydrated && loadSyncUrl() && pending > 0) doSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, hydrated]);

  const save = () => {
    saveSyncUrl(url.trim());
    if (url.trim()) {
      setStatus({ text: "Saved. Syncing…", tone: "muted" });
      doSync();
    } else {
      setStatus({ text: "Cleared. Sync disabled.", tone: "muted" });
    }
  };

  const test = async () => {
    const u = url.trim();
    if (!u) return setStatus({ text: "Paste your Google Sheet link first.", tone: "warn" });
    setStatus({ text: "Testing connection…", tone: "muted" });
    try {
      const r = await pingSheet(u);
      if (r.ok) {
        setStatus({
          text: "Connected — click Save and finished calls append automatically.",
          tone: "ok",
        });
      } else {
        const share = r.email
          ? ` Make sure the Sheet is shared with ${r.email} (Editor).`
          : "";
        setStatus({ text: (r.error ?? "Could not connect.") + share, tone: "err" });
      }
    } catch (e) {
      setStatus({ text: "Could not reach the server: " + (e as Error).message, tone: "err" });
    }
  };

  const toneClass: Record<Tone, string> = {
    muted: "text-muted-foreground",
    ok: "text-green-700",
    warn: "text-amber-700",
    err: "text-red-700",
  };

  return (
    <div className="space-y-3">
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste your Google Sheet link…"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={save}>Save</Button>
        <Button size="sm" variant="outline" onClick={test}>Test</Button>
        <Button size="sm" variant="ghost" onClick={doSync}>Sync now</Button>
      </div>
      <p className={`text-xs ${toneClass[status.tone]}`}>
        {url && pending > 0 ? `${pending} pending — ` : ""}
        {status.text}
      </p>
    </div>
  );
}
