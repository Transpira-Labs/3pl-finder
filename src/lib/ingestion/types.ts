import type { ColumnMapping } from "@/db/schema";
import type { ConsentBasisType } from "./consent";

export type { ColumnMapping };

/** The lead-schema fields a source column can be mapped to. */
export const MAPPABLE_FIELDS = [
  "phone",
  "name",
  "company",
  "website",
  "timezone",
  "source",
  "consentBasis",
  "notes",
] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

export const REQUIRED_FIELDS: MappableField[] = ["phone", "consentBasis"];

export type ValidationStatus =
  | "eligible"
  | "quarantined"
  | "blocked"
  | "invalid"
  | "duplicate";

/** Result of running one source row through the shared gate. */
export type RowResult = {
  rowIndex: number;
  raw: Record<string, string>;
  // normalized/derived fields
  phoneE164: string | null;
  name: string | null;
  company: string | null;
  website: string | null;
  timezone: string | null;
  source: string | null;
  consentBasis: string | null;
  consentBasisType: ConsentBasisType;
  notes: string | null;
  dncStatus: "clear" | "listed" | "unknown";
  status: ValidationStatus;
  reason: string | null;
};

export type BatchSummary = {
  rowCount: number;
  eligible: number;
  quarantined: number;
  blocked: number;
  invalid: number;
  duplicates: number;
};

export type ValidatedBatch = {
  rows: RowResult[];
  summary: BatchSummary;
};
