// Use the /core API with metadata passed explicitly. The default
// `libphonenumber-js` entry bundles metadata via a wrapper that esbuild/tsx can
// resolve to `undefined` (the standalone telephony + ingest workers run under
// tsx), crashing with "Cannot read properties of undefined (reading
// 'hasOwnProperty')". Passing metadata directly works in every runtime.
import { parsePhoneNumberFromString } from "libphonenumber-js/core";
import type { CountryCode } from "libphonenumber-js/core";
import metadata from "libphonenumber-js/min/metadata";

export type PhoneParse =
  | { ok: true; e164: string; nationalNumber: string; countryAreaCode: string }
  | { ok: false; reason: string };

/**
 * Normalize a raw phone string to E.164. Defaults to US (NANP) region when the
 * number has no country code, since vendor lists are typically domestic and
 * bare 10-digit numbers are the common case.
 */
export function normalizePhone(
  raw: string,
  defaultCountry: CountryCode = "US",
): PhoneParse {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty phone" };

  const parsed = parsePhoneNumberFromString(trimmed, { defaultCountry }, metadata);
  if (!parsed) return { ok: false, reason: "unparseable phone" };
  if (!parsed.isValid()) return { ok: false, reason: "invalid phone number" };

  // For NANP numbers, the first 3 digits of the national number are the area code.
  const national = parsed.nationalNumber;
  const areaCode = parsed.countryCallingCode === "1" ? national.slice(0, 3) : "";

  return {
    ok: true,
    e164: parsed.number,
    nationalNumber: national,
    countryAreaCode: areaCode,
  };
}
