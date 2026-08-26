/**
 * Consent basis classification (Phase 2 ledger).
 *
 * Upgrades the earlier presence-only check: a raw consent string is mapped to an
 * enumerated basis type, and only some types are a lawful basis to cold-call.
 * `unrecognized` means text was supplied but doesn't map to a valid basis (e.g.
 * "purchased list") — present but NOT callable, so it quarantines.
 *
 * This encodes *well-formedness*, not legality. As the spec's legal note says,
 * the tool enforces that a basis is recorded and recognized; it cannot tell you
 * whether you truly have the legal right to call a given lead. Counsel owns that.
 */

export type ConsentBasisType =
  | "express_written"
  | "express_oral"
  | "existing_business_relationship"
  | "inbound_inquiry"
  | "unrecognized"
  // Business-to-business basis. Assigned explicitly by the B2B (Google-Sheet)
  // ingestion path — never inferred from free text (no PATTERNS entry below).
  | "b2b";

/** Which classified bases are treated as a valid basis to call. */
const CALLABLE_BASES = new Set<ConsentBasisType>([
  "express_written",
  "express_oral",
  "existing_business_relationship",
  "inbound_inquiry",
  "b2b",
]);

const PATTERNS: { type: ConsentBasisType; match: RegExp }[] = [
  {
    type: "express_written",
    match:
      /\b(written|writing|signed|e-?sign|web ?form|opt[\s-]?in form|checkbox|express written)\b/i,
  },
  {
    type: "express_oral",
    match: /\b(verbal|oral|phone consent|spoken|express (oral|verbal))\b/i,
  },
  {
    type: "existing_business_relationship",
    match:
      /\b(ebr|existing (business )?relationship|current customer|existing customer|prior purchase)\b/i,
  },
  {
    type: "inbound_inquiry",
    match:
      /\b(inbound|inquiry|enquiry|requested (info|contact|quote)|referral|lead form)\b/i,
  },
  // Generic "opt-in"/"consent"/"yes" with no qualifier → treat as express_written-ish
  // only if it clearly says opt-in; a bare "yes" is too weak → unrecognized.
  { type: "express_written", match: /\bopt[\s-]?in\b/i },
];

export type ConsentClassification = {
  type: ConsentBasisType;
  isCallableBasis: boolean;
};

/** Classify a raw consent string into a basis type + whether it permits calling. */
export function classifyConsent(raw: string | null): ConsentClassification {
  const text = (raw ?? "").trim();
  if (!text) return { type: "unrecognized", isCallableBasis: false };

  for (const { type, match } of PATTERNS) {
    if (match.test(text)) {
      return { type, isCallableBasis: CALLABLE_BASES.has(type) };
    }
  }
  return { type: "unrecognized", isCallableBasis: false };
}

export function isCallableBasisType(type: ConsentBasisType | null): boolean {
  return type != null && CALLABLE_BASES.has(type);
}

/**
 * Whether a consent basis permits an SMS follow-up. Deliberately a separate
 * predicate from `isCallableBasisType` even though the sets are identical
 * today: texting rules (TCPA) can be tightened independently of voice without
 * touching every call site.
 */
export function isTextableBasisType(type: ConsentBasisType | null): boolean {
  return type != null && CALLABLE_BASES.has(type);
}
