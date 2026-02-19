/**
 * Hash chain integrity integration tests.
 *
 * Validates multi-checkpoint chain construction, tamper detection,
 * cross-session independence, and input-commitment sensitivity when
 * the chain and signing modules are composed together.
 */

import { describe, it, expect } from 'vitest';

import {
  computeInputCommitment,
  type InputCommitmentData,
} from '../../analyze/signing';
import {
  computeChainHash,
  verifyChainSequence,
  type ChainInput,
  type ChainCheckpoint,
} from '../../analyze/chain';

import { generateTestKeypair } from './helpers';

// ============================================================================
// Helpers
// ============================================================================

function makeInputData(overrides: Partial<InputCommitmentData> = {}): InputCommitmentData {
  return {
    card: { card_id: 'card-chain-001', values: ['honesty'] },
    conscienceValues: [{ type: 'value', content: 'Be honest', id: 'v1' }],
    windowContext: [],
    modelVersion: 'claude-3-opus-20240229',
    promptTemplateVersion: '2.1.0',
    ...overrides,
  };
}

async function buildChainCheckpoint(
  prevChainHash: string | null,
  index: number,
  verdict = 'clear',
): Promise<ChainCheckpoint> {
  const checkpointId = `ic-chain-${index}`;
  const timestamp = new Date(Date.now() + index * 1000).toISOString();
  const thinkingBlockHash = 'b0b0b0b0'.repeat(8);
  const inputCommitment = await computeInputCommitment(makeInputData());

  const chainInput: ChainInput = {
    prevChainHash,
    checkpointId,
    verdict,
    thinkingBlockHash,
    inputCommitment,
    timestamp,
  };

  const chainHash = await computeChainHash(chainInput);

  return {
    checkpointId,
    verdict,
    thinkingBlockHash,
    inputCommitment,
    timestamp,
    chainHash,
    prevChainHash,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('chain integrity integration', () => {
  it('5-checkpoint chain verifies end-to-end', async () => {
    const chain: ChainCheckpoint[] = [];

    for (let i = 0; i < 5; i++) {
      const prev = i === 0 ? null : chain[i - 1].chainHash;
      const cp = await buildChainCheckpoint(prev, i);
      chain.push(cp);
    }

    expect(chain.length).toBe(5);

    // First checkpoint must be genesis
    expect(chain[0].prevChainHash).toBeNull();

    // Each subsequent checkpoint links to the previous one
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].prevChainHash).toBe(chain[i - 1].chainHash);
    }

    // Full chain verification passes
    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(true);
    expect(result.linksVerified).toBe(5);
  });

  it('tampered checkpoint breaks chain', async () => {
    const chain: ChainCheckpoint[] = [];

    for (let i = 0; i < 5; i++) {
      const prev = i === 0 ? null : chain[i - 1].chainHash;
      const cp = await buildChainCheckpoint(prev, i);
      chain.push(cp);
    }

    // Tamper with checkpoint at index 2 by changing its verdict
    // but NOT recomputing its chainHash
    chain[2] = { ...chain[2], verdict: 'boundary_violation' };

    const result = await verifyChainSequence(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('cross-session chains are independent', async () => {
    // Session A: 3 checkpoints
    const chainA: ChainCheckpoint[] = [];
    for (let i = 0; i < 3; i++) {
      const prev = i === 0 ? null : chainA[i - 1].chainHash;
      const cp = await buildChainCheckpoint(prev, i, 'clear');
      chainA.push(cp);
    }

    // Session B: 3 checkpoints with different IDs
    const chainB: ChainCheckpoint[] = [];
    for (let i = 0; i < 3; i++) {
      const prev = i === 0 ? null : chainB[i - 1].chainHash;
      // Use different index range so checkpoint IDs differ
      const cp = await buildChainCheckpoint(prev, 100 + i, 'review_needed');
      chainB.push(cp);
    }

    // Both chains verify independently
    const resultA = await verifyChainSequence(chainA);
    const resultB = await verifyChainSequence(chainB);
    expect(resultA.valid).toBe(true);
    expect(resultB.valid).toBe(true);

    // The chain hashes must be different (different inputs)
    expect(chainA[0].chainHash).not.toBe(chainB[0].chainHash);

    // Mixing chains should fail: take B's first checkpoint and
    // append it after A's last
    const mixed: ChainCheckpoint[] = [
      ...chainA,
      { ...chainB[0], prevChainHash: chainA[2].chainHash },
    ];
    const mixedResult = await verifyChainSequence(mixed);
    expect(mixedResult.valid).toBe(false);
  });

  it('commitment sensitivity: changing one input field changes chain hash', async () => {
    const baseInput = makeInputData();
    const alteredInput = makeInputData({
      card: { card_id: 'card-different', values: ['safety'] },
    });

    const commitmentA = await computeInputCommitment(baseInput);
    const commitmentB = await computeInputCommitment(alteredInput);

    // Commitments must differ
    expect(commitmentA).not.toBe(commitmentB);

    const timestamp = new Date().toISOString();
    const thinkingBlockHash = 'c0c0c0c0'.repeat(8);

    const chainInputA: ChainInput = {
      prevChainHash: null,
      checkpointId: 'ic-sens-001',
      verdict: 'clear',
      thinkingBlockHash,
      inputCommitment: commitmentA,
      timestamp,
    };

    const chainInputB: ChainInput = {
      ...chainInputA,
      inputCommitment: commitmentB,
    };

    const hashA = await computeChainHash(chainInputA);
    const hashB = await computeChainHash(chainInputB);

    expect(hashA).not.toBe(hashB);
  });
});
