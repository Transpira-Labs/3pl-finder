"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Call, Device as TDevice } from "@twilio/voice-sdk";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Phone, PhoneOff, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "connecting" | "online" | "offline" | "error";

type SoftphoneCtx = {
  status: Status;
  error: string;
  /**
   * A non-fatal audio problem that doesn't stop registration but will make a
   * call silent — mainly a blocked/missing microphone. Shown even while online,
   * because the device can be registered and still have no working mic (common
   * on Windows Chrome, where OS-level mic privacy blocks capture).
   */
  warning: string;
  /** True when the device is registered and a call can be placed. */
  ready: boolean;
  /** A call is in progress. */
  onCall: boolean;
  muted: boolean;
  /**
   * Place the call authorized by `attemptId` (from /api/queue/call-start). The
   * number is never passed from here — Twilio asks /api/voice/outbound, which
   * resolves the attempt to the lead's stored number server-side.
   */
  dial: (attemptId: string) => Promise<void>;
  hangup: () => void;
  toggleMute: () => void;
  reconnect: () => void;
};

const Ctx = createContext<SoftphoneCtx | null>(null);

export function useSoftphone(): SoftphoneCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSoftphone must be used within SoftphoneProvider");
  return c;
}

/**
 * In-browser softphone for a logged-in rep (Twilio Voice SDK).
 *
 * Registers with a token from /api/telephony/token and heartbeats presence. The
 * rep places every call themselves: `dial(attemptId)` connects through the TwiML
 * App, which hits /api/voice/outbound for the number to dial. Nothing is ever
 * routed to a rep who didn't ask for it, so there is no auto-answer path.
 */
export function SoftphoneProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [active, setActive] = useState<Call | null>(null);
  const [muted, setMuted] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to force a reconnect
  const deviceRef = useRef<TDevice | null>(null);

  const heartbeat = useCallback((online: boolean) => {
    fetch("/api/telephony/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ online }),
      keepalive: !online,
    }).catch(() => {});
  }, []);

  /**
   * Confirm the browser can actually capture the microphone, and turn a failure
   * into an actionable message instead of a silent call.
   *
   * Twilio's `device.connect()` does NOT reject when the mic is blocked — it
   * establishes the WebRTC session with a silent input track, so the UI flips to
   * "on a call" while nothing crosses the line. That's the classic "works on my
   * Mac, dead on the reps' Windows machines" report: the Mac granted mic access
   * once, while Windows Chrome is blocked by OS-level mic privacy or a dismissed
   * prompt. Requesting getUserMedia ourselves surfaces the real error, and doing
   * it up front makes Chrome show its permission prompt before the first dial.
   *
   * We immediately stop the tracks — we only wanted the grant + a device check.
   * Returns true when a mic is usable.
   */
  const ensureMic = useCallback(async (): Promise<boolean> => {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setWarning(
        "This browser can't access a microphone. Use an up-to-date Chrome or Edge, over the https:// link.",
      );
      return false;
    }
    try {
      const stream = await md.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
      setWarning("");
      return true;
    } catch (e) {
      const name = (e as { name?: string })?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setWarning(
          "Microphone blocked. Click the camera/mic icon in Chrome's address bar → Allow, then Reconnect. " +
            "On Windows also open Settings → Privacy & security → Microphone and turn on “Let desktop apps access your microphone”.",
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setWarning(
          "No microphone found. Plug in a mic or headset (and pick it as Windows' default input), then Reconnect.",
        );
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setWarning(
          "Your microphone is being held by another app (Zoom, Teams, etc.). Close it, then Reconnect.",
        );
      } else {
        setWarning(
          "Couldn't access the microphone. Check Chrome's mic permission and Windows' mic privacy settings, then Reconnect.",
        );
      }
      return false;
    }
  }, []);

  useEffect(() => {
    let device: TDevice | null = null;
    let hb: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    // Warm up the browser's audio stack on the first user gesture. Call audio is
    // blocked until a page has had one; the rep's click on "Call" would satisfy
    // it anyway, but doing it early avoids a first-call hiccup.
    const unlockAudio = () => {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (Ctor) {
          const ctx = new Ctor();
          void ctx.resume().finally(() => {
            try {
              void ctx.close();
            } catch {}
          });
        }
      } catch {}
    };
    const gestureEvents = ["pointerdown", "keydown", "touchstart"] as const;
    for (const ev of gestureEvents)
      window.addEventListener(ev, unlockAudio, { once: true, passive: true });

    (async () => {
      try {
        setStatus("connecting");
        setError("");
        const r = await fetch("/api/telephony/token").then((x) => x.json());
        if (disposed) return;
        if (r.error) {
          setStatus("error");
          setError(r.error);
          return;
        }
        const { Device } = await import("@twilio/voice-sdk");
        if (disposed) return;
        // Use the default "roaming" edge (auto-selects the nearest signaling
        // endpoint). An explicit edge pin can raise ConnectionError 53000 if that
        // specific edge is unreachable from the rep's network.
        device = new Device(r.token, { logLevel: "error" });
        deviceRef.current = device;

        device.on("registered", () => {
          if (disposed) return;
          setStatus("online");
          setError("");
          heartbeat(true);
          if (!hb) hb = setInterval(() => heartbeat(true), 15000);
        });
        device.on("unregistered", () => {
          if (!disposed) setStatus("offline");
        });
        device.on("error", (e: { code?: number; message?: string }) => {
          if (disposed) return;
          // Show the code; the SDK auto-reconnects signaling on transient blips.
          console.error("[softphone] device error", e);
          const detail = `${e?.code ?? ""} ${e?.message ?? ""}`.trim();
          setError(detail || "Softphone connection error");
          // Only hard-fail on token/auth errors that won't self-heal. Signaling
          // errors (53000/31005/31009) are usually transient — the SDK
          // reconnects and re-emits "registered", so keep showing the last state.
          if (e?.code === 20101 || e?.code === 20104) setStatus("error");
        });
        device.on("tokenWillExpire", async () => {
          const rr = await fetch("/api/telephony/token").then((x) => x.json());
          if (rr.token) device?.updateToken(rr.token);
        });

        // Register with a few retries so a transient signaling blip (53000) at
        // startup self-heals instead of leaving the rep offline. The periodic
        // heartbeat is started by the "registered" handler once we're online.
        for (let attempt = 1; attempt <= 3 && !disposed; attempt++) {
          try {
            await device.register();
            break;
          } catch (e) {
            console.error(`[softphone] register attempt ${attempt} failed`, e);
            if (attempt === 3 || disposed) throw e;
            await new Promise((res) => setTimeout(res, 1500 * attempt));
          }
        }

        // Prime the mic permission now that we're a live rep console, so a
        // blocked/missing mic surfaces as a message here instead of a silent
        // call. Non-blocking: registration already succeeded above.
        if (!disposed) void ensureMic();
      } catch (e) {
        if (!disposed) {
          setStatus("error");
          console.error("[softphone] register failed", e);
          // Twilio SDK rejections aren't always Error instances (some are plain
          // objects, some undefined) — extract defensively so a connect failure
          // never crashes the console page.
          const m =
            e instanceof Error
              ? e.message
              : e && typeof e === "object" && "message" in e
                ? String((e as { message?: unknown }).message)
                : String(e ?? "");
          setError(
            m || "Couldn't connect the softphone. Check Twilio Voice config.",
          );
        }
      }
    })();

    const onHide = () => heartbeat(false);
    window.addEventListener("pagehide", onHide);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", onHide);
      for (const ev of gestureEvents) window.removeEventListener(ev, unlockAudio);
      if (hb) clearInterval(hb);
      heartbeat(false);
      device?.destroy();
      deviceRef.current = null;
    };
  }, [heartbeat, nonce, ensureMic]);

  const dial = useCallback(
    async (attemptId: string) => {
      const device = deviceRef.current;
      if (!device) throw new Error("Softphone isn't connected yet.");

      // Block the dial if the mic can't be captured — connecting anyway would
      // place a live but silent call. ensureMic() has already set an actionable
      // warning in the panel; surface a short reason to the lead card too.
      const micOk = await ensureMic();
      if (!micOk)
        throw new Error(
          "Microphone unavailable — see the softphone panel for how to enable it.",
        );

      const call = await device.connect({ params: { attemptId } });
      call.on("disconnect", () => {
        setActive(null);
        setMuted(false);
      });
      call.on("cancel", () => setActive(null));
      call.on("error", (e: { code?: number; message?: string }) => {
        console.error("[softphone] call error", e);
        setWarning(
          `Call error ${e?.code ?? ""} ${e?.message ?? ""}`.trim() ||
            "The call dropped unexpectedly.",
        );
        setActive(null);
      });
      // Twilio fires this warning when the input audio level is flat — i.e. the
      // mic is sending silence (muted at the OS, wrong device, or blocked). It's
      // the clearest "connected but no audio" signal we get mid-call.
      call.on("warning", (name: string) => {
        if (name === "constant-audio-input-level")
          setWarning(
            "No sound is coming from your microphone. Check it's not muted, the right input is selected, and Windows mic access is on.",
          );
      });
      call.on("warning-cleared", (name: string) => {
        if (name === "constant-audio-input-level") setWarning("");
      });
      setActive(call);
    },
    [ensureMic],
  );

  const hangup = useCallback(() => {
    active?.disconnect();
    setActive(null);
  }, [active]);

  const toggleMute = useCallback(() => {
    if (!active) return;
    const m = !muted;
    active.mute(m);
    setMuted(m);
  }, [active, muted]);

  const reconnect = useCallback(() => setNonce((n) => n + 1), []);

  return (
    <Ctx.Provider
      value={{
        status,
        error,
        warning,
        ready: status === "online",
        onCall: !!active,
        muted,
        dial,
        hangup,
        toggleMute,
        reconnect,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

/** The softphone status panel + in-call controls. */
export function Softphone() {
  const s = useSoftphone();

  const dot =
    s.status === "online"
      ? "bg-emerald-500"
      : s.status === "error"
        ? "bg-red-500"
        : "bg-muted-foreground/40";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("h-2.5 w-2.5 rounded-full", dot, s.onCall && "animate-pulse")} />
          <span className="font-medium">
            Softphone —{" "}
            {s.status === "online"
              ? s.onCall
                ? "On a call"
                : "Ready to call"
              : s.status === "connecting"
                ? "Connecting…"
                : s.status === "error"
                  ? "Not connected"
                  : "Offline"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(s.status === "error" || s.status === "offline") && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={s.reconnect}>
              <RotateCw className="h-3.5 w-3.5" /> Reconnect
            </Button>
          )}
        </div>
      </div>

      {s.error && s.status !== "online" && (
        <p className="mt-2 text-xs text-red-600">{s.error}</p>
      )}

      {/* Audio/mic problems can happen while the device is online — show them
          regardless of status, since they're the difference between a real call
          and a silent one. */}
      {s.warning && (
        <p className="mt-2 text-xs text-amber-600">{s.warning}</p>
      )}

      {/* Active call controls */}
      {s.onCall && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={s.toggleMute}>
            {s.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {s.muted ? "Unmute" : "Mute"}
          </Button>
          <Button size="sm" variant="destructive" className="gap-1.5" onClick={s.hangup}>
            <PhoneOff className="h-3.5 w-3.5" /> Hang up
          </Button>
        </div>
      )}

      <TestCall />
    </div>
  );
}

/**
 * Admin-only: dial a number you type, to check the softphone end-to-end without
 * burning a lead.
 *
 * The number goes to `/api/queue/test-call`, never to `device.connect` — that
 * route validates it, checks the suppression list, writes an audit entry and
 * hands back an `attemptId`, which is all the browser ever passes to Twilio. So
 * the rule this feature bends ("the browser never supplies a phone number")
 * still holds where it counts: the number that gets dialed is always resolved
 * server-side, and only an admin can put one there.
 *
 * Hidden for non-admins purely as an affordance; the route re-checks the
 * session, so hiding it is not what makes it safe.
 */
function TestCall() {
  const s = useSoftphone();
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialed, setDialed] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/telephony/me")
      .then((r) => r.json())
      .then((d) => {
        if (active && d?.role === "admin") setIsAdmin(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function placeTestCall() {
    setBusy(true);
    setError("");
    setDialed("");
    try {
      const r = await fetch("/api/queue/test-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: number }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "Couldn't authorize that call.");
        return;
      }
      await s.dial(d.attemptId);
      setDialed(d.phone);
    } catch (e) {
      setError((e as Error)?.message ?? "The softphone refused the call.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Test the softphone with a specific number →
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && number && s.ready && !s.onCall && !busy) {
                  void placeTestCall();
                }
              }}
              placeholder="+1 555 010 1234"
              inputMode="tel"
              className="flex-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!number.trim() || busy || !s.ready || s.onCall}
              onClick={() => void placeTestCall()}
            >
              <Phone className="h-3.5 w-3.5" />
              {busy ? "Calling…" : "Call"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {dialed && !error && (
            <p className="text-xs text-muted-foreground">
              Dialing <span className="font-mono">{dialed}</span> — this is a real call, billed
              like any other. It is excluded from Call Analytics.
            </p>
          )}
          {!s.ready && (
            <p className="text-xs text-muted-foreground">
              The softphone has to be connected before it can place a call.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
