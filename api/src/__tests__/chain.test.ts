/**
 * Tests for hash chain linking module.
 *
 * Validates that integrity checkpoints form a tamper-evident chain via
 * SHA-256 hash linking. Any modification to a checkpoint or reordering
 * of the chain must be detectable through hash verification.
 */

import { describe, it, expect } from 'vitest';
import {
  computeChainHash,
  verifyChainLink,
  verifyChainSequence,
  type ChainInput,
  type ChainCheckpoint,
} from '../analyze/chain';

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal ChainInput for testing. */
function makeChainInput(overrides: Partial<ChainInput> = {}): ChainInput {
  return {
    prevChainHash: null,
    checkpointId: 'ic-test-001',
    verdict: 'clear',
    thinkingBlockHash: 'abc123hash',
    inputCommitment: 'commitment456',
    timestamp: '2026-01-15T10:30:00.000Z',
    ...overrides,
  };
}

/**
 * Build a valid chain of N checkpoints. Each checkpoint's chainHash is
 * correctly computed and linked to its predecessor.
 */
async function buildValidChain(length: number): Promise<ChainCheckpoint[]> {
  const chain: ChainCheckpoint[] = [];

  for (let i = 0; i < length; i++) {
    const input: ChainInput = {
      prevChainHash: i === 0 ? null : chain[i - 1].chainHash,
      checkpointId: `ic-chain-${String(i).padStart(3, '0')}`,
      verdict: i % 3 === 0 ? 'clear' : i % 3 === 1 ? 'review_needed' : 'clear',
      thinkingBlockHash: `thinking-hash-${i}`,
      inputCommitment: `commitment-${i}`,
      timestamp: `2026-01-15T10:${String(i).padStart(2, '0')}:00.000Z`,
    };

    const chainHash = await computeChainHash(input);

    chain.push({
      checkpointId: input.checkpointId,
      verdict: input.verdict,
      thinkingBlockHash: input.thinkingBlockHash,
      inputCommitment: input.inputCommitment,
      timestamp: input.timestamp,
      chainHash,
      prevChainHash: input.prevChainHash,
    });
  }

  return chain;
}

// ============================================================================
// computeChainHash
// ============================================================================

describe('computeChainHash', () => {
  it('returns a 64-character hex string (SHA-256)', async () => {
    const hash = await computeChainHash(makeChainInput());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('first checkpoint (prevChainHash=null) uses genesis prefix', async () => {
    const input = makeChainInput({ prevChainHash: null });
    const hash = await computeChainHash(input);
    // Should produce a valid hash — the genesis substitution is internal,
    // but we can verify the output is deterministic and different from
    // a non-null prevChainHash.
    const inputWithPrev = makeChainInput({ prevChainHash: 'somehash' });
    const hashWithPrev = await computeChainHash(inputWithPrev);
    expect(hash).not.toBe(hashWithPrev);
    expect(hash.length).toBe(64);
  });

  it('is deterministic (same inputs produce same hash)', async () => {
    const input = makeChainInput();
    const h1 = await computeChainHash(input);
    const h2 = await computeChainHash(input);
    expect(h1).toBe(h2);
  });

  it('different checkpointId produces different hash', async () => {
    const h1 = await computeChainHash(makeChainInput({ checkpointId: 'ic-a' }));
    const h2 = await computeChainHash(makeChainInput({ checkpointId: 'ic-b' }));
    expect(h1).not.toBe(h2);
  });

  it('different verdict produces different hash', async () => {
    const h1 = await computeChainHash(makeChainInput({ verdict: 'clear' }));
    const h2 = await computeChainHash(makeChainInput({ verdict: 'boundary_violation' }));
    expect(h1).not.toBe(h2);
  });

  it('different thinkingBlockHash produces different hash', async () => {
    const h1 = await computeChainHash(makeChainInput({ thinkingBlockHash: 'hash-a' }));
    const h2 = await computeChainHash(makeChainInput({ thinkingBlockHash: 'hash-b' }));
    expect(h1).not.toBe(h2);
  });

  it('different inputCommitment produces different hash', async () => {
    const h1 = await computeChainHash(makeChainInput({ inputCommitment: 'commit-a' }));
    const h2 = await computeChainHash(makeChainInput({ inputCommitment: 'commit-b' }));
    expect(h1).not.toBe(h2);
  });

  it('different timestamp produces different hash', async () => {
    const h1 = await computeChainHash(makeChainInput({ timestamp: '2026-01-15T10:00:00Z' }));
    const h2 = await computeChainHash(makeChainInput({ timestamp: '2026-01-15T11:00:00Z' }));
    expect(h1).not.toBe(h2);
  });

  it('different prevChainHash produces different hash', async () => {
    const h1 = await computeChainHash(makeChainInput({ prevChainHash: 'aaa' }));
    const h2 = await computeChainHash(makeChainInput({ prevChainHash: 'bbb' }));
    expect(h1).not.toBe(h2);
  });
});

// ============================================================================
// verifyChainLink
// ============================================================================

describe('verifyChainLink', () => {
  it('returns true for a correctly computed hash', async () => {
    const input = makeChainInput();
    const hash = await computeChainHash(input);
    const valid = await verifyChainLink(input, hash);
    expect(valid).toBe(true);
  });

  it('returns false for an incorrect hash', async () => {
    const input = makeChainInput();
    const valid = await verifyChainLink(input, 'f'.repeat(64));
    expect(valid).toBe(false);
  });

  it('returns false when input has been tampered with', async () => {
    const input = makeChainInput();
    const hash = await computeChainHash(input);

    // Tamper with the verdict
    const tampered = { ...input, verdict: 'boundary_violation' };
    const valid = await verifyChainLink(tampered, hash);
    expect(valid).toBe(false);
  });

  it('verifies a genesis link (prevChainHash=null)', async () => {
    const input = makeChainInput({ prevChainHash: null });
    const hash = await computeChainHash(input);
    const valid = await verifyChainLink(input, hash);
    expect(valid).toBe(true);
  });

  it('verifies a linked checkpoint (prevChainHash is a real hash)', async () => {
    const genesisInput = makeChainInput({ prevChainHash: null });
    const genesisHash = await computeChainHash(genesisInput);

    const linkedInput = makeChainInput({
      prevChainHash: genesisHash,
      checkpointId: 'ic-test-002',
      timestamp: '2026-01-15T10:31:00.000Z',
    });
    const linkedHash = await computeChainHash(linkedInput);

    const valid = await verifyChainLink(linkedInput, linkedHash);
    expect(valid).toBe(true);
  });
});

// ============================================================================
// verifyChainSequence
// ============================================================================

describe('verifyChainSequence', () => {
  it('returns valid with 0 links for an empty chain', async () => {
    const result = await verifyChainSequence([]);
    expect(result.valid).toBe(true);
    expect(result.linksVerified).toBe(0);
    expect(result.details).toContain('Empty chain');
  });

  it('verifies a single-checkpoint chain', async () => {
    const chain = await buildValidChain(1);
    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(true);
    expect(result.linksVerified).toBe(1);
  });

  it('verifies a 5-checkpoint chain', async () => {
    const chain = await buildValidChain(5);
    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(true);
    expect(result.linksVerified).toBe(5);
    expect(result.details).toContain('5 links verified');
  });

  it('verifies a 10-checkpoint chain', async () => {
    const chain = await buildValidChain(10);
    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(true);
    expect(result.linksVerified).toBe(10);
  });

  it('fails when first checkpoint has non-null prevChainHash', async () => {
    const chain = await buildValidChain(3);
    // Tamper: set first checkpoint's prevChainHash to a non-null value
    chain[0] = { ...chain[0], prevChainHash: 'unexpected-hash' };

    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
    expect(result.details).toContain('prevChainHash === null');
  });

  it('fails when middle checkpoint verdict is tampered', async () => {
    const chain = await buildValidChain(5);
    // Tamper with checkpoint at index 2
    chain[2] = { ...chain[2], verdict: 'tampered_verdict' };

    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.details).toContain('recomputed chainHash');
  });

  it('fails when chain linkage is broken (wrong prevChainHash)', async () => {
    const chain = await buildValidChain(5);
    // Break linkage at index 3 by pointing to a different hash
    chain[3] = { ...chain[3], prevChainHash: 'wrong-prev-hash' };

    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(3);
    expect(result.details).toContain('prevChainHash does not match');
  });

  it('fails when checkpoint is deleted from the middle', async () => {
    const chain = await buildValidChain(5);
    // Remove checkpoint at index 2 — chain[3].prevChainHash now points to
    // chain[2].chainHash, but chain[1] is the new predecessor at index 2.
    chain.splice(2, 1);

    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(false);
    // The break should be detected at the former index 3 (now index 2)
    expect(result.brokenAt).toBe(2);
  });

  it('fails when checkpoints are reordered', async () => {
    const chain = await buildValidChain(4);
    // Swap indices 1 and 2
    const temp = chain[1];
    chain[1] = chain[2];
    chain[2] = temp;

    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(false);
  });

  it('fails when chainHash is replaced with a different valid hash', async () => {
    const chain = await buildValidChain(3);
    // Replace chainHash of checkpoint 1 with a valid-looking but wrong hash
    chain[1] = { ...chain[1], chainHash: 'a'.repeat(64) };

    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(false);
  });

  it('detects tampering at the last checkpoint', async () => {
    const chain = await buildValidChain(5);
    const lastIdx = chain.length - 1;
    chain[lastIdx] = { ...chain[lastIdx], thinkingBlockHash: 'tampered' };

    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(lastIdx);
  });

  it('reports correct linksVerified count before break', async () => {
    const chain = await buildValidChain(5);
    // Break at index 3 — indices 0, 1, 2 should pass before failure
    chain[3] = { ...chain[3], verdict: 'tampered' };

    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(false);
    expect(result.linksVerified).toBe(3);
    expect(result.brokenAt).toBe(3);
  });
});
