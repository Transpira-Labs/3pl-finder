"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCallTracker } from "@/hooks/useCallTracker";
import { SoftphoneProvider, useSoftphone } from "@/components/softphone";
import {
  SendFollowupDialog,
  type SendFollowupTarget,
} from "@/components/send-followup";
import { BUCKETS } from "@/lib/config";

export type Rep = {
  id: string;
  name: string;
  phone: string;
  presence: "available" | "away";
  onCall: boolean;
  campaignId: string | null;
};

type TrackerCtx = ReturnType<typeof useCallTracker> & {
  reps: Rep[];
  repId: string | null;
  currentRep: Rep | null;
  setRepId: (id: string | null) => void;
  reloadReps: () => void;
  endCallOpen: boolean;
  setEndCallOpen: (v: boolean) => void;
  openEndCall: () => void;
  hint: string | null;
  /** Open the review-and-send follow-up dialog for a lead (SMS/email). */
  openSendFollowup: (target: SendFollowupTarget) => void;
};

const Ctx = createContext<TrackerCtx | null>(null);

export function useTracker(): TrackerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTracker must be used within TrackerProvider");
  return c;
}

const REP_KEY = "console.repId";

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  const [reps, setReps] = useState<Rep[]>([]);
  const [repId, setRepIdState] = useState<string | null>(null);
  const t = useCallTracker(repId);
  const [endCallOpen, setEndCallOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [followupTarget, setFollowupTarget] = useState<SendFollowupTarget | null>(
    null,
  );

  const currentRep = reps.find((r) => r.id === repId) ?? null;

  const openSendFollowup = useCallback((target: SendFollowupTarget) => {
    setFollowupTarget(target);
  }, []);

  const reloadReps = useCallback(async () => {
    try {
      const r = await fetch("/api/reps").then((x) => x.json());
      setReps(r.reps ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const setRepId = useCallback((id: string | null) => {
    if (id) localStorage.setItem(REP_KEY, id);
    else localStorage.removeItem(REP_KEY);
    setRepIdState(id);
  }, []);

  useEffect(() => {
    let active = true;
    const saved = localStorage.getItem(REP_KEY);
    if (saved) {
      // Honor a prior explicit choice (a specific rep, or solo mode).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRepIdState(saved);
      reloadReps();
    } else {
      // No prior choice → auto-select the logged-in user's OWN softphone rep so
      // it activates on login without picking from a list. (Solo stays an explicit
      // opt-in via the picker.)
      (async () => {
        try {
          const me = await fetch("/api/telephony/me").then((x) => x.json());
          if (active && me.repId) setRepId(me.repId);
        } catch {
          /* fall back to the picker */
        }
        reloadReps();
      })();
    }
    return () => {
      active = false;
    };
  }, [reloadReps, setRepId]);

  // No screen-pop subscription: the rep starts every call themselves from the
  // lead card (see components/lead-card.tsx), which calls `startIncoming`
  // directly. The old EventSource existed only because the predictive dialer
  // decided, server-side, which rep got which lead.

  const totalRef = useRef(0);
  useEffect(() => {
    // Guard on the real elapsed call time (falls back to tracked bucket time).
    totalRef.current = Math.max(t.elapsedMs, t.totalMs);
  }, [t.elapsedMs, t.totalMs]);

  const openEndCall = useCallback(() => {
    if (totalRef.current < 1000) {
      setHint("nothing tracked yet");
      setTimeout(() => setHint(null), 1000);
      return;
    }
    t.switchTo("idle");
    setEndCallOpen(true);
  }, [t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (endCallOpen) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      // Don't hijack keys while typing or when a focusable control is active
      // (the console shortcuts run app-wide via the admin dock, so a stray
      // Space/Enter must not steal button/link activation or form input).
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "A" ||
        el?.isContentEditable
      )
        return;
      if (e.repeat) return;
      const b = BUCKETS.find((x) => x.key === e.key);
      if (b) {
        e.preventDefault();
        t.toggleBucket(b.id);
        return;
      }
      if (e.key === " " || e.key === "0") {
        e.preventDefault();
        t.switchTo("idle");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        openEndCall();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [endCallOpen, t, openEndCall]);

  return (
    <Ctx.Provider
      value={{
        ...t,
        reps,
        repId,
        currentRep,
        setRepId,
        reloadReps,
        endCallOpen,
        setEndCallOpen,
        openEndCall,
        hint,
        openSendFollowup,
      }}
    >
      {/* One Twilio Device per console tree, so the lead card and the softphone
          panel drive the same connection. */}
      <SoftphoneProvider>
        <HangupWatcher />
        {children}
        {/* Review-and-send follow-up (SMS/email), opened after a disposition. */}
        <SendFollowupDialog
          open={!!followupTarget}
          onOpenChange={(v) => {
            if (!v) setFollowupTarget(null);
          }}
          target={followupTarget}
          repName={currentRep?.name ?? null}
        />
      </SoftphoneProvider>
    </Ctx.Provider>
  );
}

/**
 * Stop the stopwatch when the phone call actually ends.
 *
 * Without this the timer keeps banking time into whichever bucket was running
 * after the line has already dropped — a rep who hangs up and takes a moment
 * before pressing Enter silently inflates their "right person" time, and the
 * lead card stays pinned to a call that's over. The softphone's own disconnect
 * event is the accurate end signal, so use it.
 *
 * Lives inside SoftphoneProvider (and inside the tracker context) because it's
 * the one place both are readable.
 */
function HangupWatcher() {
  const t = useTracker();
  const phone = useSoftphone();
  const wasOnCall = useRef(false);

  // The tracker context object is rebuilt on every tick, so read it through a
  // ref — otherwise the hangup effect below would re-run ~60×/second instead of
  // once per hangup. Declared first so it refreshes before that effect runs.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const ended = wasOnCall.current && !phone.onCall;
    wasOnCall.current = phone.onCall;
    if (!ended) return;

    const tracker = tRef.current;
    if (tracker.solo) return;

    // Nothing worth keeping (instant failure, or the rep never tracked anything)
    // → drop it, so the lead card isn't left pinned to a dead call.
    if (Math.max(tracker.elapsedMs, tracker.totalMs) < 1000) {
      tracker.discardCurrent();
      return;
    }
    tracker.openEndCall();
  }, [phone.onCall]);

  return null;
}
