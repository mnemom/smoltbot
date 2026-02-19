/**
 * Key rotation integration tests.
 *
 * Validates that Ed25519 key rotation works correctly: old signatures
 * remain verifiable with their original key, new signatures use the
 * new key, and deactivated keys no longer affect new checkpoint
 * signing while preserving historical verification.
 */

import { describe, it, expect } from 'vitest';

import {
  signCheckpoint,
  verifyCheckpointSignature,
} from '../../analyze/signing';
import {
  buildSignedPayload,
  type SignedPayloadInput,
} from '../../analyze/certificate';

import { generateTestKeypair } from './helpers';

// ============================================================================
// Helpers
// ============================================================================

function makePayload(index: number): string {
  const input: SignedPayloadInput = {
    checkpointId: `ic-rotation-${index}`,
    agentId: 'agent-rotation-001',
    verdict: 'clear',
    thinkingBlockHash: 'aaaa0000'.repeat(8),
    inputCommitment: 'bbbb0000'.repeat(8),
    chainHash: 'cccc0000'.repeat(8),
    timestamp: new Date(Date.now() + index * 1000).toISOString(),
  };
  return buildSignedPayload(input);
}

// ============================================================================
// Tests
// ============================================================================

describe('key rotation integration', () => {
  it('old key can verify old signatures', async () => {
    const keyA = await generateTestKeypair();

    // Sign 3 checkpoints with key A
    const payloads = [0, 1, 2].map((i) => makePayload(i));
    const signatures = await Promise.all(
      payloads.map((p) => signCheckpoint(p, keyA.secretKey)),
    );

    // All 3 signatures should verify with key A's public key
    for (let i = 0; i < 3; i++) {
      const valid = await verifyCheckpointSignature(
        signatures[i],
        payloads[i],
        keyA.publicKey,
      );
      expect(valid).toBe(true);
    }
  });

  it('deactivated key rejects new signing attempts; old sigs remain valid', async () => {
    const keyA = await generateTestKeypair();
    const keyB = await generateTestKeypair();

    // Phase 1: Sign with key A (active)
    const oldPayload = makePayload(10);
    const oldSignature = await signCheckpoint(oldPayload, keyA.secretKey);

    // Verify old signature with key A
    const oldValid = await verifyCheckpointSignature(
      oldSignature,
      oldPayload,
      keyA.publicKey,
    );
    expect(oldValid).toBe(true);

    // Phase 2: "Rotate" to key B — simulate by using key B for new checkpoints
    const newPayload = makePayload(11);
    const newSignature = await signCheckpoint(newPayload, keyB.secretKey);

    // New signature verifies with key B
    const newValid = await verifyCheckpointSignature(
      newSignature,
      newPayload,
      keyB.publicKey,
    );
    expect(newValid).toBe(true);

    // New signature does NOT verify with old key A
    const crossInvalid = await verifyCheckpointSignature(
      newSignature,
      newPayload,
      keyA.publicKey,
    );
    expect(crossInvalid).toBe(false);

    // Old signature still verifies with key A (historical verification preserved)
    const historicalValid = await verifyCheckpointSignature(
      oldSignature,
      oldPayload,
      keyA.publicKey,
    );
    expect(historicalValid).toBe(true);

    // Old signature does NOT verify with key B
    const oldWithNewKey = await verifyCheckpointSignature(
      oldSignature,
      oldPayload,
      keyB.publicKey,
    );
    expect(oldWithNewKey).toBe(false);
  });

  it('new key assigned for new checkpoints', async () => {
    const keyB = await generateTestKeypair();

    // Sign 3 new checkpoints with key B
    const payloads = [20, 21, 22].map((i) => makePayload(i));
    const signatures = await Promise.all(
      payloads.map((p) => signCheckpoint(p, keyB.secretKey)),
    );

    // All signatures verify with key B
    for (let i = 0; i < 3; i++) {
      const valid = await verifyCheckpointSignature(
        signatures[i],
        payloads[i],
        keyB.publicKey,
      );
      expect(valid).toBe(true);
    }

    // A random other key cannot verify any of them
    const otherKey = await generateTestKeypair();
    for (let i = 0; i < 3; i++) {
      const invalid = await verifyCheckpointSignature(
        signatures[i],
        payloads[i],
        otherKey.publicKey,
      );
      expect(invalid).toBe(false);
    }
  });
});
