"use client";

import { useState } from "react";
import { useTracker } from "@/components/tracker-provider";
import { DispositionDialog } from "@/components/disposition-dialog";
import {
  SmsFollowupDialog,
  type SmsFollowupContext,
} from "@/components/sms-followup-dialog";
import { messageTemplateForDisposition } from "@/lib/config";

/**
 * Hosts the end-call disposition modal and both follow-up steps that can come
 * off it. Shared by the /console layout and the admin dock (each inside its own
 * TrackerProvider) so the wiring exists exactly once.
 *
 * Two follow-up paths, deliberately distinct, and a call can produce either:
 *  - **SMS** — opt-in per call, via the checkbox on the disposition dialog. The
 *    rep decides in the moment, because a text is the more intrusive channel.
 *  - **Email** — offered automatically when the outcome maps to a template
 *    (`messageTemplateForDisposition` skips wrong-number / not-interested).
 *
 * Both are dialer-only and need a real lead: solo-mode and bare manual dials
 * have no lead row, so there's no consent or timezone to check and nothing to
 * personalize from.
 */
export function DispositionHost() {
  const t = useTracker();
  const [smsCtx, setSmsCtx] = useState<SmsFollowupContext | null>(null);

  return (
    <>
      <DispositionDialog
        open={t.endCallOpen}
        onOpenChange={t.setEndCallOpen}
        error={t.saveError}
        smsOffered={!t.solo && !!t.incoming?.leadId}
        onSave={async (d, note, sendSms) => {
          // Snapshot before committing — a successful commit clears `incoming`.
          const inc = t.incoming;
          const res = await t.commitCall(d, note);
          // Only close once the call is actually saved — otherwise a failed
          // write would look identical to a successful one and the work lost.
          if (!res.ok) return;
          t.setEndCallOpen(false);
          if (!inc?.leadId || t.solo) return;

          if (sendSms && t.repId) {
            setSmsCtx({
              leadId: inc.leadId,
              callAttemptId: res.callAttemptId,
              phone: inc.phone,
              name: inc.name,
              company: inc.company,
              disposition: d,
              note,
              repId: t.repId,
            });
            return; // one follow-up per call — the rep already chose the channel
          }

          if (messageTemplateForDisposition(d)) {
            t.openSendFollowup({
              leadId: inc.leadId,
              callAttemptId: res.callAttemptId,
              name: inc.name,
              company: inc.company,
              dispositionId: d,
            });
          }
        }}
      />
      <SmsFollowupDialog context={smsCtx} onClose={() => setSmsCtx(null)} />
    </>
  );
}
