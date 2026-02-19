/**
 * Tests for the Merkle accumulator module.
 *
 * Validates binary Merkle tree construction, inclusion proof generation and
 * verification, and tree state reporting. The Merkle tree provides append-only
 * completeness guarantees: any deleted or reordered checkpoint is detectable
 * through root hash divergence or failed inclusion proofs.
 */

import { describe, it, expect } from 'vitest';
import {
  computeLeafHash,
  computeNodeHash,
  computeMerkleRoot,
  generateInclusionProof,
  verifyInclusionProof,
  buildTreeState,
  type LeafData,
} from '../analyze/merkle';

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal LeafData for testing. */
function makeLeafData(overrides: Partial<LeafData> = {}): LeafData {
  return {
    checkpointId: 'ic-leaf-001',
    verdict: 'clear',
    thinkingBlockHash: 'thinking-abc',
    chainHash: 'chain-def',
    timestamp: '2026-01-15T12:00:00.000Z',
    ...overrides,
  };
}

/** Generate N distinct leaf hashes for tree construction. */
function generateLeafHashes(n: number): string[] {
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) {
    hashes.push(
      computeLeafHash(
        makeLeafData({
          checkpointId: `ic-leaf-${String(i).padStart(3, '0')}`,
          timestamp: `2026-01-15T12:${String(i).padStart(2, '0')}:00.000Z`,
        }),
      ),
    );
  }
  return hashes;
}

// ============================================================================
// computeLeafHash
// ============================================================================

describe('computeLeafHash', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = computeLeafHash(makeLeafData());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic (same inputs produce same hash)', () => {
    const data = makeLeafData();
    const h1 = computeLeafHash(data);
    const h2 = computeLeafHash(data);
    expect(h1).toBe(h2);
  });

  it('changes when checkpointId changes', () => {
    const h1 = computeLeafHash(makeLeafData({ checkpointId: 'ic-a' }));
    const h2 = computeLeafHash(makeLeafData({ checkpointId: 'ic-b' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when verdict changes', () => {
    const h1 = computeLeafHash(makeLeafData({ verdict: 'clear' }));
    const h2 = computeLeafHash(makeLeafData({ verdict: 'boundary_violation' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when thinkingBlockHash changes', () => {
    const h1 = computeLeafHash(makeLeafData({ thinkingBlockHash: 'hash-a' }));
    const h2 = computeLeafHash(makeLeafData({ thinkingBlockHash: 'hash-b' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when chainHash changes', () => {
    const h1 = computeLeafHash(makeLeafData({ chainHash: 'chain-a' }));
    const h2 = computeLeafHash(makeLeafData({ chainHash: 'chain-b' }));
    expect(h1).not.toBe(h2);
  });

  it('changes when timestamp changes', () => {
    const h1 = computeLeafHash(makeLeafData({ timestamp: '2026-01-15T12:00:00Z' }));
    const h2 = computeLeafHash(makeLeafData({ timestamp: '2026-01-15T13:00:00Z' }));
    expect(h1).not.toBe(h2);
  });
});

// ============================================================================
// computeNodeHash
// ============================================================================

describe('computeNodeHash', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = computeNodeHash('a'.repeat(64), 'b'.repeat(64));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const left = 'a'.repeat(64);
    const right = 'b'.repeat(64);
    const h1 = computeNodeHash(left, right);
    const h2 = computeNodeHash(left, right);
    expect(h1).toBe(h2);
  });

  it('order matters: hash(a,b) !== hash(b,a)', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const hab = computeNodeHash(a, b);
    const hba = computeNodeHash(b, a);
    expect(hab).not.toBe(hba);
  });

  it('different inputs produce different hashes', () => {
    const h1 = computeNodeHash('x'.repeat(64), 'y'.repeat(64));
    const h2 = computeNodeHash('x'.repeat(64), 'z'.repeat(64));
    expect(h1).not.toBe(h2);
  });
});

// ============================================================================
// computeMerkleRoot
// ============================================================================

describe('computeMerkleRoot', () => {
  it('returns empty string for empty array', () => {
    expect(computeMerkleRoot([])).toBe('');
  });

  it('single leaf: root equals the leaf hash itself', () => {
    const leaf = computeLeafHash(makeLeafData());
    const root = computeMerkleRoot([leaf]);
    expect(root).toBe(leaf);
  });

  it('two leaves: root = hash(leaf0 + leaf1)', () => {
    const leaves = generateLeafHashes(2);
    const root = computeMerkleRoot(leaves);
    const expected = computeNodeHash(leaves[0], leaves[1]);
    expect(root).toBe(expected);
  });

  it('three leaves: last leaf is duplicated (odd count)', () => {
    const leaves = generateLeafHashes(3);
    const root = computeMerkleRoot(leaves);

    // Manually compute: level 1 has 4 nodes (leaf[2] duplicated)
    const n01 = computeNodeHash(leaves[0], leaves[1]);
    const n23 = computeNodeHash(leaves[2], leaves[2]); // duplicated
    const expected = computeNodeHash(n01, n23);
    expect(root).toBe(expected);
  });

  it('four leaves: perfect binary tree', () => {
    const leaves = generateLeafHashes(4);
    const root = computeMerkleRoot(leaves);

    const n01 = computeNodeHash(leaves[0], leaves[1]);
    const n23 = computeNodeHash(leaves[2], leaves[3]);
    const expected = computeNodeHash(n01, n23);
    expect(root).toBe(expected);
  });

  it('five leaves: correct tree with duplication at first level', () => {
    const leaves = generateLeafHashes(5);
    const root = computeMerkleRoot(leaves);

    // Level 0: 5 leaves -> duplicate last -> 6
    const n01 = computeNodeHash(leaves[0], leaves[1]);
    const n23 = computeNodeHash(leaves[2], leaves[3]);
    const n45 = computeNodeHash(leaves[4], leaves[4]); // duplicated
    // Level 1: 3 nodes -> duplicate last -> 4
    const n0123 = computeNodeHash(n01, n23);
    const n4545 = computeNodeHash(n45, n45); // duplicated
    const expected = computeNodeHash(n0123, n4545);
    expect(root).toBe(expected);
  });

  it('seven leaves: correct tree with duplication', () => {
    const leaves = generateLeafHashes(7);
    const root = computeMerkleRoot(leaves);

    // Level 0: 7 leaves -> duplicate last -> 8
    const n01 = computeNodeHash(leaves[0], leaves[1]);
    const n23 = computeNodeHash(leaves[2], leaves[3]);
    const n45 = computeNodeHash(leaves[4], leaves[5]);
    const n67 = computeNodeHash(leaves[6], leaves[6]); // duplicated
    // Level 1: 4 nodes (even)
    const n0123 = computeNodeHash(n01, n23);
    const n4567 = computeNodeHash(n45, n67);
    const expected = computeNodeHash(n0123, n4567);
    expect(root).toBe(expected);
  });

  it('eight leaves: perfect binary tree (power of 2)', () => {
    const leaves = generateLeafHashes(8);
    const root = computeMerkleRoot(leaves);

    const n01 = computeNodeHash(leaves[0], leaves[1]);
    const n23 = computeNodeHash(leaves[2], leaves[3]);
    const n45 = computeNodeHash(leaves[4], leaves[5]);
    const n67 = computeNodeHash(leaves[6], leaves[7]);
    const n0123 = computeNodeHash(n01, n23);
    const n4567 = computeNodeHash(n45, n67);
    const expected = computeNodeHash(n0123, n4567);
    expect(root).toBe(expected);
  });

  it('is deterministic', () => {
    const leaves = generateLeafHashes(6);
    const r1 = computeMerkleRoot(leaves);
    const r2 = computeMerkleRoot(leaves);
    expect(r1).toBe(r2);
  });

  it('different leaf sets produce different roots', () => {
    const leaves1 = generateLeafHashes(4);
    const leaves2 = generateLeafHashes(4).map((h) =>
      h.replace(/^./, 'f'),
    );
    // Ensure we actually have different inputs (guard against accidental match)
    expect(leaves1[0]).not.toBe(leaves2[0]);
    const r1 = computeMerkleRoot(leaves1);
    const r2 = computeMerkleRoot(leaves2);
    expect(r1).not.toBe(r2);
  });
});

// ============================================================================
// generateInclusionProof / verifyInclusionProof
// ============================================================================

describe('generateInclusionProof', () => {
  it('throws on empty tree', () => {
    expect(() => generateInclusionProof([], 0)).toThrow('empty tree');
  });

  it('throws on negative index', () => {
    const leaves = generateLeafHashes(3);
    expect(() => generateInclusionProof(leaves, -1)).toThrow('out of bounds');
  });

  it('throws on index equal to tree size', () => {
    const leaves = generateLeafHashes(3);
    expect(() => generateInclusionProof(leaves, 3)).toThrow('out of bounds');
  });

  it('throws on index greater than tree size', () => {
    const leaves = generateLeafHashes(3);
    expect(() => generateInclusionProof(leaves, 100)).toThrow('out of bounds');
  });

  it('single leaf: proof has 0 siblings', () => {
    const leaves = generateLeafHashes(1);
    const proof = generateInclusionProof(leaves, 0);
    expect(proof.siblings).toHaveLength(0);
    expect(proof.root).toBe(leaves[0]);
    expect(proof.leafHash).toBe(leaves[0]);
    expect(proof.leafIndex).toBe(0);
    expect(proof.treeSize).toBe(1);
  });

  it('two leaves: proof has 1 sibling', () => {
    const leaves = generateLeafHashes(2);
    const proof = generateInclusionProof(leaves, 0);
    expect(proof.siblings).toHaveLength(1);
    expect(proof.siblings[0].hash).toBe(leaves[1]);
    expect(proof.siblings[0].position).toBe('right');
  });

  it('proof for last leaf in 2-leaf tree', () => {
    const leaves = generateLeafHashes(2);
    const proof = generateInclusionProof(leaves, 1);
    expect(proof.siblings).toHaveLength(1);
    expect(proof.siblings[0].hash).toBe(leaves[0]);
    expect(proof.siblings[0].position).toBe('left');
  });

  it('proof root matches computeMerkleRoot', () => {
    const leaves = generateLeafHashes(7);
    for (let i = 0; i < leaves.length; i++) {
      const proof = generateInclusionProof(leaves, i);
      expect(proof.root).toBe(computeMerkleRoot(leaves));
    }
  });

  it('proof treeSize matches leaf count', () => {
    const leaves = generateLeafHashes(5);
    const proof = generateInclusionProof(leaves, 2);
    expect(proof.treeSize).toBe(5);
  });
});

describe('verifyInclusionProof', () => {
  describe('4-leaf tree: every leaf verifies', () => {
    const leaves = generateLeafHashes(4);
    const root = computeMerkleRoot(leaves);

    for (let i = 0; i < 4; i++) {
      it(`leaf ${i} inclusion proof verifies`, () => {
        const proof = generateInclusionProof(leaves, i);
        const valid = verifyInclusionProof(proof, leaves[i], root);
        expect(valid).toBe(true);
      });
    }
  });

  describe('7-leaf tree: every leaf verifies', () => {
    const leaves = generateLeafHashes(7);
    const root = computeMerkleRoot(leaves);

    for (let i = 0; i < 7; i++) {
      it(`leaf ${i} inclusion proof verifies`, () => {
        const proof = generateInclusionProof(leaves, i);
        const valid = verifyInclusionProof(proof, leaves[i], root);
        expect(valid).toBe(true);
      });
    }
  });

  describe('8-leaf tree (power of 2): every leaf verifies', () => {
    const leaves = generateLeafHashes(8);
    const root = computeMerkleRoot(leaves);

    for (let i = 0; i < 8; i++) {
      it(`leaf ${i} inclusion proof verifies`, () => {
        const proof = generateInclusionProof(leaves, i);
        const valid = verifyInclusionProof(proof, leaves[i], root);
        expect(valid).toBe(true);
      });
    }
  });

  it('single leaf tree: proof verifies', () => {
    const leaves = generateLeafHashes(1);
    const root = computeMerkleRoot(leaves);
    const proof = generateInclusionProof(leaves, 0);
    const valid = verifyInclusionProof(proof, leaves[0], root);
    expect(valid).toBe(true);
  });

  it('fails with wrong leaf hash', () => {
    const leaves = generateLeafHashes(4);
    const root = computeMerkleRoot(leaves);
    const proof = generateInclusionProof(leaves, 1);

    const wrongLeaf = 'f'.repeat(64);
    const valid = verifyInclusionProof(proof, wrongLeaf, root);
    expect(valid).toBe(false);
  });

  it('fails with wrong root', () => {
    const leaves = generateLeafHashes(4);
    const proof = generateInclusionProof(leaves, 2);

    const wrongRoot = 'e'.repeat(64);
    const valid = verifyInclusionProof(proof, leaves[2], wrongRoot);
    expect(valid).toBe(false);
  });

  it('fails when proof siblings are tampered', () => {
    const leaves = generateLeafHashes(4);
    const root = computeMerkleRoot(leaves);
    const proof = generateInclusionProof(leaves, 0);

    // Tamper with the first sibling hash
    const tamperedProof = {
      ...proof,
      siblings: proof.siblings.map((s, i) =>
        i === 0 ? { ...s, hash: 'd'.repeat(64) } : s,
      ),
    };
    const valid = verifyInclusionProof(tamperedProof, leaves[0], root);
    expect(valid).toBe(false);
  });

  it('fails when proof sibling position is swapped', () => {
    const leaves = generateLeafHashes(4);
    const root = computeMerkleRoot(leaves);
    const proof = generateInclusionProof(leaves, 0);

    // Swap position of first sibling
    const tamperedProof = {
      ...proof,
      siblings: proof.siblings.map((s, i) =>
        i === 0
          ? { ...s, position: s.position === 'left' ? 'right' as const : 'left' as const }
          : s,
      ),
    };
    const valid = verifyInclusionProof(tamperedProof, leaves[0], root);
    expect(valid).toBe(false);
  });

  it('proof from one tree does not verify against different tree root', () => {
    const leaves1 = generateLeafHashes(4);
    const leaves2 = [
      ...leaves1.slice(0, 3),
      computeLeafHash(makeLeafData({ checkpointId: 'ic-different' })),
    ];
    const root2 = computeMerkleRoot(leaves2);
    const proof1 = generateInclusionProof(leaves1, 0);

    // The leaf hash is the same, but the root differs due to different leaf[3]
    const valid = verifyInclusionProof(proof1, leaves1[0], root2);
    expect(valid).toBe(false);
  });
});

// ============================================================================
// buildTreeState
// ============================================================================

describe('buildTreeState', () => {
  it('returns correct state for empty tree', () => {
    const state = buildTreeState([]);
    expect(state.root).toBe('');
    expect(state.depth).toBe(0);
    expect(state.leafCount).toBe(0);
    expect(state.leafHashes).toEqual([]);
  });

  it('1 leaf: depth 0', () => {
    const leaves = generateLeafHashes(1);
    const state = buildTreeState(leaves);
    expect(state.depth).toBe(0);
    expect(state.leafCount).toBe(1);
    expect(state.root).toBe(leaves[0]);
  });

  it('2 leaves: depth 1', () => {
    const leaves = generateLeafHashes(2);
    const state = buildTreeState(leaves);
    expect(state.depth).toBe(1);
    expect(state.leafCount).toBe(2);
  });

  it('3 leaves: depth 2', () => {
    const leaves = generateLeafHashes(3);
    const state = buildTreeState(leaves);
    expect(state.depth).toBe(2);
    expect(state.leafCount).toBe(3);
  });

  it('4 leaves: depth 2', () => {
    const leaves = generateLeafHashes(4);
    const state = buildTreeState(leaves);
    expect(state.depth).toBe(2);
    expect(state.leafCount).toBe(4);
  });

  it('5 leaves: depth 3', () => {
    const leaves = generateLeafHashes(5);
    const state = buildTreeState(leaves);
    expect(state.depth).toBe(3);
    expect(state.leafCount).toBe(5);
  });

  it('8 leaves: depth 3', () => {
    const leaves = generateLeafHashes(8);
    const state = buildTreeState(leaves);
    expect(state.depth).toBe(3);
    expect(state.leafCount).toBe(8);
  });

  it('root matches computeMerkleRoot', () => {
    const leaves = generateLeafHashes(6);
    const state = buildTreeState(leaves);
    expect(state.root).toBe(computeMerkleRoot(leaves));
  });

  it('preserves leaf hashes (defensive copy)', () => {
    const leaves = generateLeafHashes(3);
    const state = buildTreeState(leaves);
    expect(state.leafHashes).toEqual(leaves);
    // Mutating the original should not affect the state
    leaves[0] = 'mutated';
    expect(state.leafHashes[0]).not.toBe('mutated');
  });

  it('adding a leaf changes the root', () => {
    const leaves3 = generateLeafHashes(3);
    const state3 = buildTreeState(leaves3);

    const leaves4 = [
      ...leaves3,
      computeLeafHash(makeLeafData({ checkpointId: 'ic-new-leaf' })),
    ];
    const state4 = buildTreeState(leaves4);

    expect(state4.root).not.toBe(state3.root);
    expect(state4.leafCount).toBe(state3.leafCount + 1);
  });

  it('removing a leaf changes the root', () => {
    const leaves4 = generateLeafHashes(4);
    const state4 = buildTreeState(leaves4);

    const leaves3 = leaves4.slice(0, 3);
    const state3 = buildTreeState(leaves3);

    expect(state3.root).not.toBe(state4.root);
  });
});
