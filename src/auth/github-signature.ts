import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/* Checks GitHub's X-Hub-Signature-256 header: "sha256=" plus the hex HMAC-SHA256
   of the exact request bytes, keyed with the webhook secret. */
export function isValidGitHubSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader?.startsWith(SIGNATURE_PREFIX) || !secret) {
    return false;
  }

  const received = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();

  // timingSafeEqual throws on a length mismatch, and the length is not secret
  return received.length === expected.length && timingSafeEqual(received, expected);
}
