/**
 * License JWT utilities
 * Pure Web Crypto API — edge-compatible, no npm dependencies.
 * HMAC-SHA256 signing and verification.
 */

import type { LicenseJWTPayload } from './types';

function base64urlEncode(data: Uint8Array): string {
  const str = btoa(String.fromCharCode(...data));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + padding);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function encodeJSON(obj: unknown): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64urlEncode(new Uint8Array(signature));
}

async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sigBytes = base64urlDecode(signature);
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
}

/**
 * Sign a license JWT with HMAC-SHA256.
 */
export async function signLicenseJWT(
  payload: LicenseJWTPayload,
  secret: string,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT', kid: payload.kid };
  const headerB64 = encodeJSON(header);
  const payloadB64 = encodeJSON(payload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await hmacSign(signingInput, secret);
  return `${signingInput}.${signature}`;
}

/**
 * Verify a license JWT signature and check expiry.
 * Returns decoded payload or error string.
 */
export async function verifyLicenseJWT(
  token: string,
  secret: string,
): Promise<{ valid: true; payload: LicenseJWTPayload } | { valid: false; error: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid JWT format' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const isValid = await hmacVerify(signingInput, signatureB64, secret);
  if (!isValid) {
    return { valid: false, error: 'Invalid signature' };
  }

  let payload: LicenseJWTPayload;
  try {
    const decoded = new TextDecoder().decode(base64urlDecode(payloadB64));
    payload = JSON.parse(decoded) as LicenseJWTPayload;
  } catch {
    return { valid: false, error: 'Invalid payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    return { valid: false, error: 'Token expired' };
  }

  return { valid: true, payload };
}

/**
 * Decode a license JWT without verifying signature.
 * Useful for reading claims from expired or offline tokens.
 */
export function decodeLicenseJWT(
  token: string,
): { valid: true; payload: LicenseJWTPayload } | { valid: false; error: string } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid JWT format' };
  }

  try {
    const decoded = new TextDecoder().decode(base64urlDecode(parts[1]));
    const payload = JSON.parse(decoded) as LicenseJWTPayload;
    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'Invalid payload' };
  }
}
