/**
 * Tests for Ed25519 checkpoint signing module.
 *
 * Validates key generation, signing/verification round-trips, input commitment
 * determinism, and encoding helper correctness. These are the foundation of the
 * cryptographic attestation layer — any regression here undermines the entire
 * integrity protocol.
 */

import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { randomBytes } from 'node:crypto';
import {
  signCheckpoint,
  verifyCheckpointSignature,
  computeInputCommitment,
  loadSigningKeyFromHex,
  getPublicKeyFromSecret,
  uint8ToBase64,
  base64ToUint8,
  uint8ToHex,
  type InputCommitmentData,
} from '../analyze/signing';

// ============================================================================
// Helpers
// ============================================================================

/** Generate a fresh Ed25519 keypair for testing. */
async function generateTestKeypair() {
  const secretKey = randomBytes(32);
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  return { secretKey: new Uint8Array(secretKey), publicKey };
}

/** Build a minimal valid InputCommitmentData for testing. */
function makeInputCommitmentData(
  overrides: Partial<InputCommitmentData> = {},
): InputCommitmentData {
  return {
    card: {
      card_id: 'card-abc123',
      values: ['honesty', 'transparency'],
      title: 'Test Card',
    },
    conscienceValues: [
      { type: 'value', content: 'Be honest', id: 'v1' },
      { type: 'boundary', content: 'No deception', id: 'v2' },
    ],
    windowContext: [
      {
        checkpoint_id: 'ic-prev-001',
        verdict: 'clear',
        reasoning_summary: 'All good',
      },
    ],
    modelVersion: 'claude-3-opus-20240229',
    promptTemplateVersion: '2.1.0',
    ...overrides,
  };
}

// ============================================================================
// Encoding helpers
// ============================================================================

describe('uint8ToBase64 / base64ToUint8', () => {
  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const b64 = uint8ToBase64(original);
    const recovered = base64ToUint8(b64);
    expect(recovered).toEqual(original);
  });

  it('round-trips an empty array', () => {
    const original = new Uint8Array([]);
    const b64 = uint8ToBase64(original);
    const recovered = base64ToUint8(b64);
    expect(recovered).toEqual(original);
  });

  it('round-trips a single byte', () => {
    const original = new Uint8Array([42]);
    const b64 = uint8ToBase64(original);
    const recovered = base64ToUint8(b64);
    expect(recovered).toEqual(original);
  });

  it('round-trips 32 random bytes (Ed25519 key size)', () => {
    const original = new Uint8Array(randomBytes(32));
    const b64 = uint8ToBase64(original);
    const recovered = base64ToUint8(b64);
    expect(recovered).toEqual(original);
  });

  it('round-trips 64 random bytes (Ed25519 signature size)', () => {
    const original = new Uint8Array(randomBytes(64));
    const b64 = uint8ToBase64(original);
    const recovered = base64ToUint8(b64);
    expect(recovered).toEqual(original);
  });

  it('produces valid base64 characters', () => {
    const bytes = new Uint8Array(randomBytes(48));
    const b64 = uint8ToBase64(bytes);
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe('uint8ToHex', () => {
  it('encodes known bytes to hex', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x0a, 0xbc]);
    expect(uint8ToHex(bytes)).toBe('00ff0abc');
  });

  it('returns empty string for empty array', () => {
    expect(uint8ToHex(new Uint8Array([]))).toBe('');
  });

  it('produces lowercase hex', () => {
    const bytes = new Uint8Array([0xAB, 0xCD, 0xEF]);
    const hex = uint8ToHex(bytes);
    expect(hex).toBe(hex.toLowerCase());
  });
});

// ============================================================================
// Key utilities
// ============================================================================

describe('loadSigningKeyFromHex', () => {
  it('produces a 32-byte Uint8Array from a 64-char hex string', () => {
    const hex = 'a'.repeat(64);
    const key = loadSigningKeyFromHex(hex);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('correctly decodes known hex values', () => {
    const hex = '00ff0a0b' + '0'.repeat(56);
    const key = loadSigningKeyFromHex(hex);
    expect(key[0]).toBe(0x00);
    expect(key[1]).toBe(0xff);
    expect(key[2]).toBe(0x0a);
    expect(key[3]).toBe(0x0b);
  });

  it('round-trips with uint8ToHex', () => {
    const hex = uint8ToHex(new Uint8Array(randomBytes(32)));
    const key = loadSigningKeyFromHex(hex);
    expect(uint8ToHex(key)).toBe(hex);
  });
});

describe('getPublicKeyFromSecret', () => {
  it('derives a 32-byte public key from a 32-byte secret key', async () => {
    const secretKey = new Uint8Array(randomBytes(32));
    const publicKey = await getPublicKeyFromSecret(secretKey);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(32);
  });

  it('is deterministic (same secret produces same public key)', async () => {
    const secretKey = new Uint8Array(randomBytes(32));
    const pk1 = await getPublicKeyFromSecret(secretKey);
    const pk2 = await getPublicKeyFromSecret(secretKey);
    expect(pk1).toEqual(pk2);
  });

  it('different secrets produce different public keys', async () => {
    const sk1 = new Uint8Array(randomBytes(32));
    const sk2 = new Uint8Array(randomBytes(32));
    const pk1 = await getPublicKeyFromSecret(sk1);
    const pk2 = await getPublicKeyFromSecret(sk2);
    expect(uint8ToHex(pk1)).not.toBe(uint8ToHex(pk2));
  });
});

// ============================================================================
// Signing & verification
// ============================================================================

describe('signCheckpoint / verifyCheckpointSignature', () => {
  it('sign then verify succeeds with correct keypair', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();
    const payload = '{"checkpoint_id":"ic-001","verdict":"clear"}';

    const signature = await signCheckpoint(payload, secretKey);
    const valid = await verifyCheckpointSignature(signature, payload, publicKey);
    expect(valid).toBe(true);
  });

  it('returns a non-empty base64 string as signature', async () => {
    const { secretKey } = await generateTestKeypair();
    const signature = await signCheckpoint('test payload', secretKey);
    expect(signature.length).toBeGreaterThan(0);
    expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('signature decodes to 64 bytes (Ed25519 signature length)', async () => {
    const { secretKey } = await generateTestKeypair();
    const signature = await signCheckpoint('test payload', secretKey);
    const sigBytes = base64ToUint8(signature);
    expect(sigBytes.length).toBe(64);
  });

  it('verify with wrong public key fails', async () => {
    const { secretKey } = await generateTestKeypair();
    const { publicKey: wrongKey } = await generateTestKeypair();
    const payload = 'some payload';

    const signature = await signCheckpoint(payload, secretKey);
    const valid = await verifyCheckpointSignature(signature, payload, wrongKey);
    expect(valid).toBe(false);
  });

  it('verify with tampered payload fails', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();
    const payload = 'original payload';

    const signature = await signCheckpoint(payload, secretKey);
    const valid = await verifyCheckpointSignature(
      signature,
      'tampered payload',
      publicKey,
    );
    expect(valid).toBe(false);
  });

  it('verify with tampered signature fails', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();
    const payload = 'payload to sign';

    const signature = await signCheckpoint(payload, secretKey);
    // Flip one byte in the signature
    const sigBytes = base64ToUint8(signature);
    sigBytes[0] ^= 0xff;
    const tamperedSignature = uint8ToBase64(sigBytes);

    // Tampered signature should either return false or throw (depending on
    // whether the tampered bytes form a valid Ed25519 point). We accept either.
    let valid: boolean;
    try {
      valid = await verifyCheckpointSignature(
        tamperedSignature,
        payload,
        publicKey,
      );
    } catch {
      valid = false;
    }
    expect(valid).toBe(false);
  });

  it('same payload and key produce the same signature (Ed25519 is deterministic)', async () => {
    const { secretKey } = await generateTestKeypair();
    const payload = 'deterministic test';

    const sig1 = await signCheckpoint(payload, secretKey);
    const sig2 = await signCheckpoint(payload, secretKey);
    expect(sig1).toBe(sig2);
  });

  it('different payloads produce different signatures', async () => {
    const { secretKey } = await generateTestKeypair();
    const sig1 = await signCheckpoint('payload A', secretKey);
    const sig2 = await signCheckpoint('payload B', secretKey);
    expect(sig1).not.toBe(sig2);
  });

  it('handles empty string payload', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();
    const signature = await signCheckpoint('', secretKey);
    const valid = await verifyCheckpointSignature(signature, '', publicKey);
    expect(valid).toBe(true);
  });

  it('handles long payload (10 KB)', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();
    const payload = 'x'.repeat(10_000);
    const signature = await signCheckpoint(payload, secretKey);
    const valid = await verifyCheckpointSignature(signature, payload, publicKey);
    expect(valid).toBe(true);
  });

  it('handles unicode payload', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();
    const payload = 'Unicode test: \u00e9\u00e0\u00fc\u00f1 \u4f60\u597d \ud83d\ude80';
    const signature = await signCheckpoint(payload, secretKey);
    const valid = await verifyCheckpointSignature(signature, payload, publicKey);
    expect(valid).toBe(true);
  });
});

// ============================================================================
// Input commitment
// ============================================================================

describe('computeInputCommitment', () => {
  it('returns a 64-character hex string (SHA-256)', async () => {
    const data = makeInputCommitmentData();
    const commitment = await computeInputCommitment(data);
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic (same inputs produce same commitment)', async () => {
    const data = makeInputCommitmentData();
    const c1 = await computeInputCommitment(data);
    const c2 = await computeInputCommitment(data);
    expect(c1).toBe(c2);
  });

  it('changes when card_id changes', async () => {
    const data1 = makeInputCommitmentData();
    const data2 = makeInputCommitmentData({
      card: { ...data1.card, card_id: 'card-different' },
    });
    const c1 = await computeInputCommitment(data1);
    const c2 = await computeInputCommitment(data2);
    expect(c1).not.toBe(c2);
  });

  it('changes when conscienceValues changes', async () => {
    const data1 = makeInputCommitmentData();
    const data2 = makeInputCommitmentData({
      conscienceValues: [{ type: 'value', content: 'Different value' }],
    });
    const c1 = await computeInputCommitment(data1);
    const c2 = await computeInputCommitment(data2);
    expect(c1).not.toBe(c2);
  });

  it('changes when windowContext changes', async () => {
    const data1 = makeInputCommitmentData();
    const data2 = makeInputCommitmentData({
      windowContext: [],
    });
    const c1 = await computeInputCommitment(data1);
    const c2 = await computeInputCommitment(data2);
    expect(c1).not.toBe(c2);
  });

  it('changes when modelVersion changes', async () => {
    const data1 = makeInputCommitmentData();
    const data2 = makeInputCommitmentData({
      modelVersion: 'claude-3-sonnet-20240229',
    });
    const c1 = await computeInputCommitment(data1);
    const c2 = await computeInputCommitment(data2);
    expect(c1).not.toBe(c2);
  });

  it('changes when promptTemplateVersion changes', async () => {
    const data1 = makeInputCommitmentData();
    const data2 = makeInputCommitmentData({
      promptTemplateVersion: '3.0.0',
    });
    const c1 = await computeInputCommitment(data1);
    const c2 = await computeInputCommitment(data2);
    expect(c1).not.toBe(c2);
  });

  it('key ordering does not matter (sorted keys ensure determinism)', async () => {
    // Create two objects with the same data but different key insertion order
    const card1 = { card_id: 'card-x', values: [1, 2], title: 'Test' };
    const card2 = { title: 'Test', values: [1, 2], card_id: 'card-x' };

    const data1 = makeInputCommitmentData({ card: card1 });
    const data2 = makeInputCommitmentData({ card: card2 });

    const c1 = await computeInputCommitment(data1);
    const c2 = await computeInputCommitment(data2);
    expect(c1).toBe(c2);
  });

  it('nested object key ordering does not matter', async () => {
    const cv1 = [{ type: 'value', content: 'Be honest', id: 'v1' }];
    const cv2 = [{ id: 'v1', content: 'Be honest', type: 'value' }];

    const data1 = makeInputCommitmentData({ conscienceValues: cv1 });
    const data2 = makeInputCommitmentData({ conscienceValues: cv2 });

    const c1 = await computeInputCommitment(data1);
    const c2 = await computeInputCommitment(data2);
    expect(c1).toBe(c2);
  });
});
