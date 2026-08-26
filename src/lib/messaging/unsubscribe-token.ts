import crypto from "node:crypto";

/**
 * Signed, stateless unsubscribe tokens for CAN-SPAM email footer links. The token
 * is `base64url(email).hmac` so a recipient can opt out via a plain GET without a
 * login and without us storing a per-email token. Signed so the link can't be
 * used to unsubscribe an arbitrary address.
 */

function secret(): string {
  // Reuse the app's auth secret; a fixed dev fallback keeps local email working.
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "dev-unsubscribe-secret"
  );
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url")
    .slice(0, 24);
}

export function makeUnsubToken(email: string): string {
  const payload = Buffer.from(email.trim().toLowerCase()).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the email if the token is valid, else null. */
export function verifyUnsubToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expect = sign(payload);
  if (
    sig.length !== expect.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))
  ) {
    return null;
  }
  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
