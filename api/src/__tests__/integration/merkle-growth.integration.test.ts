/**
 * Merkle tree growth integration tests.
 *
 * Validates incremental tree growth with proof generation and
 * verification, root uniqueness, stale proof rejection, and
 * deletion detection across the merkle module.
 */

import { describe, it, expect } from 'vitest';

import {
  computeLeafHash,
  computeMerkleRoot,
  generateInclusionProof,
  verifyInclusionProof,
  buildTreeState,
  type LeafData,
} from '../../analyze/merkle';

// ============================================================================
// Helpers
// ============================================================================

function makeLeafData(index: number): LeafData {
  return {
    checkpointId: `ic-merkle-${index.toString().padStart(4, '0')}`,
    verdict: index % 3 === 0 ? 'review_needed' : 'clear',
    thinkingBlockHash: `${index.toString(16).padStart(8, '0')}`.repeat(8),
    chainHash: `chain${index.toString(16).padStart(12, '0')}`.repeat(4),
    timestamp: new Date(Date.now() + index * 1000).toISOString(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('merkle growth integration', () => {
  it('20-leaf growth with valid proofs', () => {
    const leafHashes: string[] = [];

    for (let i = 0; i < 20; i++) {
      const data = makeLeafData(i);
      const hash = computeLeafHash(data);
      leafHashes.push(hash);

      // Build tree state after each addition
      const state = buildTreeState(leafHashes);
      expect(state.leafCount).toBe(i + 1);
      expect(state.root).toBeTruthy();

      // Generate and verify proof for the newly-added leaf
      const proof = generateInclusionProof(leafHashes, i);
      expect(proof.leafHash).toBe(hash);
      expect(proof.leafIndex).toBe(i);
      expect(proof.treeSize).toBe(i + 1);

      const valid = verifyInclusionProof(proof, hash, state.root);
      expect(valid).toBe(true);
    }

    // Final tree state
    const finalState = buildTreeState(leafHashes);
    expect(finalState.leafCount).toBe(20);
    expect(finalState.depth).toBe(Math.ceil(Math.log2(20)));

    // Verify proofs for all 20 leaves against the final root
    for (let i = 0; i < 20; i++) {
      const proof = generateInclusionProof(leafHashes, i);
      const valid = verifyInclusionProof(proof, leafHashes[i], finalState.root);
      expect(valid).toBe(true);
    }
  });

  it('root uniqueness: different leaf sets produce different roots', () => {
    const setA = [0, 1, 2].map((i) => computeLeafHash(makeLeafData(i)));
    const setB = [3, 4, 5].map((i) => computeLeafHash(makeLeafData(i)));
    const setC = [0, 1, 2, 3].map((i) => computeLeafHash(makeLeafData(i)));

    const rootA = computeMerkleRoot(setA);
    const rootB = computeMerkleRoot(setB);
    const rootC = computeMerkleRoot(setC);

    // All roots should be unique
    const roots = new Set([rootA, rootB, rootC]);
    expect(roots.size).toBe(3);

    // Each root should be a valid 64-char hex SHA-256
    for (const root of roots) {
      expect(root).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('old proof rejection after tree growth', () => {
    // Build initial tree with 5 leaves
    const initialLeaves = [0, 1, 2, 3, 4].map((i) =>
      computeLeafHash(makeLeafData(i)),
    );
    const initialState = buildTreeState(initialLeaves);

    // Generate proof for leaf 2 in the initial tree
    const oldProof = generateInclusionProof(initialLeaves, 2);
    const oldValid = verifyInclusionProof(
      oldProof,
      initialLeaves[2],
      initialState.root,
    );
    expect(oldValid).toBe(true);

    // Grow tree with 5 more leaves
    const grownLeaves = [...initialLeaves];
    for (let i = 5; i < 10; i++) {
      grownLeaves.push(computeLeafHash(makeLeafData(i)));
    }
    const grownState = buildTreeState(grownLeaves);

    // The root has changed
    expect(grownState.root).not.toBe(initialState.root);

    // Old proof should NOT verify against the new root
    const staleValid = verifyInclusionProof(
      oldProof,
      initialLeaves[2],
      grownState.root,
    );
    expect(staleValid).toBe(false);

    // A fresh proof for the same leaf SHOULD verify against the new root
    const freshProof = generateInclusionProof(grownLeaves, 2);
    const freshValid = verifyInclusionProof(
      freshProof,
      grownLeaves[2],
      grownState.root,
    );
    expect(freshValid).toBe(true);
  });

  it('deletion detection: removing a leaf invalidates proof', () => {
    // Build tree with 6 leaves
    const leaves = [0, 1, 2, 3, 4, 5].map((i) =>
      computeLeafHash(makeLeafData(i)),
    );
    const originalState = buildTreeState(leaves);

    // Generate proof for leaf 3
    const proof = generateInclusionProof(leaves, 3);
    const valid = verifyInclusionProof(proof, leaves[3], originalState.root);
    expect(valid).toBe(true);

    // "Delete" leaf 3 by removing it from the array
    const withDeletion = [...leaves.slice(0, 3), ...leaves.slice(4)];
    const deletedState = buildTreeState(withDeletion);

    // Root has changed
    expect(deletedState.root).not.toBe(originalState.root);
    expect(deletedState.leafCount).toBe(5);

    // Original proof for leaf 3 fails against the new root
    const deletedValid = verifyInclusionProof(
      proof,
      leaves[3],
      deletedState.root,
    );
    expect(deletedValid).toBe(false);
  });
});
