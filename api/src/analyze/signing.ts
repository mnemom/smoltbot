/**
 * Ed25519 checkpoint signing module.
 *
 * Provides cryptographic signing and verification for integrity checkpoints
 * using @noble/ed25519 v3 (async API, no node:crypto dependency).
 * Designed for Cloudflare Workers — all I/O is Uint8Array.
 *
 * Functions:
 * - signCheckpoint / verifyCheckpointSignature — Ed25519 sign & verify
 * - computeInputCommitment — deterministic SHA-256 of analysis inputs
 * - loadSigningKeyFromHex / getPublicKeyFromSecret — key utilities
 * - uint8ToBase64 / base64ToUint8 / uint8ToHex — encoding helpers
 */

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// ============================================
// Types
// ============================================

export interface InputCommitmentData {
  card: { card_id: string; values: unknown[]; [key: string]: unknown };
  conscienceValues: Array<{ type: string; content: string; id?: string }>;
  windowContext: Array<{ checkpoint_id: string; verdict: string; reasoning_summary: string }>;
  modelVersion: string;
  promptTemplateVersion: string;
}

// ============================================
// Encoding helpers
// ============================================

/**
 * Encode a Uint8Array to a base64 string.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string to a Uint8Array.
 */
export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode a Uint8Array to a lowercase hex string.
 */
export function uint8ToHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

// ============================================
// Key utilities
// ============================================

/**
 * Convert a hex-encoded secret key string to a Uint8Array.
 */
export function loadSigningKeyFromHex(hexKey: string): Uint8Array {
  return hexToBytes(hexKey);
}

/**
 * Derive the Ed25519 public key from a secret key.
 */
export async function getPublicKeyFromSecret(secretKey: Uint8Array): Promise<Uint8Array> {
  return ed.getPublicKeyAsync(secretKey);
}

// ============================================
// Signing & verification
// ============================================

/**
 * Sign a payload string with an Ed25519 secret key.
 * Returns the signature as a base64-encoded string.
 */
export async function signCheckpoint(payload: string, secretKey: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const message = encoder.encode(payload);
  const signature = await ed.signAsync(message, secretKey);
  return uint8ToBase64(signature);
}

/**
 * Verify a base64-encoded Ed25519 signature against a payload string.
 * Returns true if the signature is valid, false otherwise.
 */
export async function verifyCheckpointSignature(
  signature: string,
  payload: string,
  publicKey: Uint8Array,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const message = encoder.encode(payload);
  const signatureBytes = base64ToUint8(signature);
  return ed.verifyAsync(signatureBytes, message, publicKey);
}

// ============================================
// Input commitment
// ============================================

/**
 * Deterministic sort-aware JSON stringifier.
 * Ensures consistent key ordering for commitment hashing.
 */
function deterministicStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/**
 * Compute a deterministic SHA-256 commitment over all analysis inputs.
 *
 * Each field is JSON-stringified with sorted keys, then concatenated
 * with a "|" separator. The resulting string is SHA-256 hashed and
 * returned as a hex string.
 */
export async function computeInputCommitment(inputs: InputCommitmentData): Promise<string> {
  const parts = [
    deterministicStringify(inputs.card),
    deterministicStringify(inputs.conscienceValues),
    deterministicStringify(inputs.windowContext),
    deterministicStringify(inputs.modelVersion),
    deterministicStringify(inputs.promptTemplateVersion),
  ];

  const concatenated = parts.join('|');
  const encoder = new TextEncoder();
  const data = encoder.encode(concatenated);
  const hash = sha256(data);
  return bytesToHex(hash);
}
