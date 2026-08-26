import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * The SMS drafter: turns a just-finished call's context into one short,
 * human-sounding follow-up text the rep edits and approves before sending.
 *
 * The model only proposes copy — it never sends anything, and the rep's edited
 * text is what actually goes out (both are stored, so edits are auditable).
 * A draft is a one-sentence-or-two generation, fast enough to run inside the
 * request, unlike the long-form analytics reports that had to move out-of-band.
 */

export const MODEL = "claude-opus-5";

export const SmsDraftSchema = z.object({
  body: z
    .string()
    .describe(
      "The SMS text, ready to send. Aim for under 300 characters (1–2 segments). Plain text; no links unless one was provided in the context.",
    ),
});

/** A refusal or schema failure, surfaced to the caller rather than thrown blind. */
export class DraftUnavailable extends Error {}

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type SmsDraftInput = {
  leadName: string | null;
  company: string | null;
  leadNotes: string | null;
  disposition: string | null;
  repNote: string | null;
  repName: string | null;
  campaignName: string | null;
};

/**
 * Static so it sits before the prompt-cache breakpoint. Likely under the
 * model's 512-token cache minimum, so the marker is style-consistency with the
 * rest of the codebase more than a guaranteed hit.
 */
const SYSTEM = `You write the follow-up text message a sales rep sends right after a phone call (or attempted call) with a prospect.

Rules:
- First person, from the rep, signed with the rep's first name when one is given (e.g. "— Alex").
- Sound like a person texting, not a marketing blast. No greetings like "Dear", no corporate boilerplate, no emoji unless the context clearly calls for one.
- Ground the message in what actually happened: the call outcome and the rep's note. A booked meeting gets a confirmation; a voicemail gets a brief "just tried you"; a conversation gets a thank-you plus the agreed next step.
- Never invent facts, offers, times, or links that are not in the provided context.
- Keep it under 300 characters. One or two sentences is ideal.
- Do not include opt-out language; carrier-level opt-out handling exists separately.`;

function buildPrompt(input: SmsDraftInput): string {
  const lines = [
    "Write the follow-up text for this call.",
    "",
    `Lead: ${input.leadName ?? "unknown name"}${input.company ? ` at ${input.company}` : ""}`,
    input.leadNotes ? `Lead background: ${input.leadNotes}` : null,
    `Call outcome: ${input.disposition ?? "not recorded"}`,
    input.repNote ? `Rep's note about the call: ${input.repNote}` : null,
    `Rep: ${input.repName ?? "the rep"}`,
    input.campaignName ? `Campaign: ${input.campaignName}` : null,
  ];
  return lines.filter((l): l is string => l != null).join("\n");
}

export async function draftSms(input: SmsDraftInput): Promise<{ body: string }> {
  if (!anthropicConfigured()) {
    throw new DraftUnavailable(
      "ANTHROPIC_API_KEY is not set — add it to your environment to draft texts.",
    );
  }

  const client = new Anthropic();

  const response = await client.messages.parse({
    model: MODEL,
    // Thinking is on by default and counts against max_tokens; the draft
    // itself is tiny but the budget must cover both.
    max_tokens: 16000,
    // No temperature — the model rejects it with a 400. Tone is prompted.
    output_config: {
      // A two-sentence text is routine work; low effort keeps it snappy.
      effort: "low",
      format: zodOutputFormat(SmsDraftSchema),
    },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildPrompt(input) }],
  });

  // Safety classifiers can decline a request; that arrives as a 200 with an
  // empty content array, so it must be checked before reading the output.
  if (response.stop_reason === "refusal") {
    throw new DraftUnavailable("The model declined to draft this message.");
  }
  if (!response.parsed_output) {
    throw new DraftUnavailable(
      `The model returned an unusable response (stop_reason: ${response.stop_reason}).`,
    );
  }

  return { body: response.parsed_output.body.trim() };
}
