/**
 * Webhook payload signing using HMAC-SHA256.
 * Follows the Stripe convention: signature input is `${timestamp}.${rawBody}`.
 */

/**
 * Sign a webhook payload with HMAC-SHA256.
 * Returns signature in format: v1={hex}
 */
export async function signPayload(
  payload: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const signatureInput = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signatureInput),
  );

  const hex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `v1=${hex}`;
}

/**
 * Check whether a timestamp is within the acceptable tolerance window.
 * Used for replay protection documentation examples.
 */
export function isTimestampValid(
  timestamp: number,
  toleranceSeconds = 300,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - timestamp) <= toleranceSeconds;
}
