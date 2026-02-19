/**
 * Merkle Accumulator Module
 *
 * Implements a per-agent append-only binary Merkle tree over integrity
 * checkpoints. Enables inclusion proofs (proving a specific checkpoint
 * exists in the tree) and completeness proofs (no checkpoints have been
 * deleted from the log).
 *
 * The tree is built from SHA-256 leaf hashes computed from checkpoint
 * fields. If the number of leaves at any level is odd, the last leaf
 * is duplicated before pairing. Inclusion proofs contain O(log N)
 * sibling hashes sufficient to recompute the root.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ============================================
// Types
// ============================================

export interface LeafData {
  checkpointId: string;
  verdict: string;
  thinkingBlockHash: string;
  chainHash: string;
  timestamp: string;
}

export interface MerkleProof {
  leafHash: string;
  leafIndex: number;
  siblings: MerkleProofSibling[];
  root: string;
  treeSize: number;
}

export interface MerkleProofSibling {
  hash: string;
  position: 'left' | 'right'; // position of the sibling relative to the computed hash
}

export interface MerkleTreeState {
  root: string;
  depth: number;
  leafCount: number;
  leafHashes: string[];
}

// ============================================
// Hash helpers
// ============================================

const encoder = new TextEncoder();

/**
 * Computes the SHA-256 leaf hash for a checkpoint.
 *
 * Preimage: checkpointId | verdict | thinkingBlockHash | chainHash | timestamp
 * (fields joined by pipe delimiter).
 */
export function computeLeafHash(data: LeafData): string {
  const preimage =
    `${data.checkpointId}|` +
    `${data.verdict}|` +
    `${data.thinkingBlockHash}|` +
    `${data.chainHash}|` +
    `${data.timestamp}`;

  const hash = sha256(encoder.encode(preimage));
  return bytesToHex(hash);
}

/**
 * Computes the SHA-256 hash of an internal Merkle tree node.
 *
 * Preimage: left || right (hex strings concatenated directly).
 */
export function computeNodeHash(left: string, right: string): string {
  const preimage = left + right;
  const hash = sha256(encoder.encode(preimage));
  return bytesToHex(hash);
}

// ============================================
// Merkle root computation
// ============================================

/**
 * Builds a binary Merkle tree from leaf hashes and returns the root.
 *
 * If the number of nodes at any level is odd, the last node is
 * duplicated before pairing. Returns an empty string for an empty
 * array.
 */
export function computeMerkleRoot(leafHashes: string[]): string {
  if (leafHashes.length === 0) {
    return '';
  }

  let level = [...leafHashes];

  while (level.length > 1) {
    // Duplicate last element when odd
    if (level.length % 2 !== 0) {
      level.push(level[level.length - 1]);
    }

    const nextLevel: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      nextLevel.push(computeNodeHash(level[i], level[i + 1]));
    }
    level = nextLevel;
  }

  return level[0];
}

// ============================================
// Inclusion proof generation
// ============================================

/**
 * Generates a Merkle inclusion proof for the leaf at `leafIndex`.
 *
 * The proof contains O(log N) sibling hashes. Each sibling's `position`
 * field indicates whether it sits to the left or right of the path node
 * at that level. The verifier walks the path from the leaf to the root,
 * combining the running hash with each sibling.
 *
 * @throws {Error} If leafIndex is out of bounds.
 */
export function generateInclusionProof(
  leafHashes: string[],
  leafIndex: number,
): MerkleProof {
  if (leafHashes.length === 0) {
    throw new Error('Cannot generate proof for empty tree.');
  }
  if (leafIndex < 0 || leafIndex >= leafHashes.length) {
    throw new Error(
      `leafIndex ${leafIndex} out of bounds (tree has ${leafHashes.length} leaves).`,
    );
  }

  const siblings: MerkleProofSibling[] = [];
  let level = [...leafHashes];
  let idx = leafIndex;

  while (level.length > 1) {
    // Duplicate last element when odd
    if (level.length % 2 !== 0) {
      level.push(level[level.length - 1]);
    }

    // Determine sibling index and position
    if (idx % 2 === 0) {
      // Current node is on the left; sibling is on the right
      siblings.push({ hash: level[idx + 1], position: 'right' });
    } else {
      // Current node is on the right; sibling is on the left
      siblings.push({ hash: level[idx - 1], position: 'left' });
    }

    // Build next level
    const nextLevel: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      nextLevel.push(computeNodeHash(level[i], level[i + 1]));
    }
    level = nextLevel;
    idx = Math.floor(idx / 2);
  }

  return {
    leafHash: leafHashes[leafIndex],
    leafIndex,
    siblings,
    root: level[0],
    treeSize: leafHashes.length,
  };
}

// ============================================
// Inclusion proof verification
// ============================================

/**
 * Verifies a Merkle inclusion proof by recomputing the root from the
 * leaf hash and the proof siblings.
 *
 * Returns true if the computed root matches `expectedRoot`.
 */
export function verifyInclusionProof(
  proof: MerkleProof,
  leafHash: string,
  expectedRoot: string,
): boolean {
  let current = leafHash;

  for (const sibling of proof.siblings) {
    if (sibling.position === 'left') {
      current = computeNodeHash(sibling.hash, current);
    } else {
      current = computeNodeHash(current, sibling.hash);
    }
  }

  return current === expectedRoot;
}

// ============================================
// Tree state builder
// ============================================

/**
 * Builds a complete `MerkleTreeState` from a list of leaf hashes.
 *
 * Computes the root, tree depth (ceil(log2(n))), and preserves the
 * original leaf hashes for later proof generation.
 */
export function buildTreeState(leafHashes: string[]): MerkleTreeState {
  const leafCount = leafHashes.length;
  const root = computeMerkleRoot(leafHashes);
  const depth = leafCount <= 1 ? 0 : Math.ceil(Math.log2(leafCount));

  return {
    root,
    depth,
    leafCount,
    leafHashes: [...leafHashes],
  };
}
