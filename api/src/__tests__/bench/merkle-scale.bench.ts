/**
 * Merkle tree scaling benchmark — root, proof, verify at various leaf counts.
 *
 * Thresholds:
 *   - verifyInclusionProof:  <0.5ms at 10K leaves
 *   - computeMerkleRoot:     <500ms at 10K leaves
 */

import { bench, describe } from 'vitest';
import {
  computeLeafHash,
  computeMerkleRoot,
  generateInclusionProof,
  verifyInclusionProof,
  buildTreeState,
  type LeafData,
} from '../../analyze/merkle';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLeafData(index: number): LeafData {
  return {
    checkpointId: `cp-${String(index).padStart(6, '0')}`,
    verdict: index % 5 === 0 ? 'flag' : 'pass',
    thinkingBlockHash: `th-${index.toString(16).padStart(64, '0')}`,
    chainHash: `ch-${index.toString(16).padStart(64, '0')}`,
    timestamp: `2026-01-15T${String(Math.floor(index / 3600) % 24).padStart(2, '0')}:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
  };
}

function generateLeafHashes(count: number): string[] {
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    hashes.push(computeLeafHash(makeLeafData(i)));
  }
  return hashes;
}

// ---------------------------------------------------------------------------
// Pre-computed leaf hash arrays for each scale tier
// ---------------------------------------------------------------------------

const SIZES = [10, 100, 1_000, 10_000] as const;

const leafHashesBySize: Record<number, string[]> = {};
for (const size of SIZES) {
  leafHashesBySize[size] = generateLeafHashes(size);
}

// ---------------------------------------------------------------------------
// Benchmarks — computeMerkleRoot
// ---------------------------------------------------------------------------

describe('computeMerkleRoot', () => {
  for (const size of SIZES) {
    // Threshold at 10K: <500ms
    bench(`${size.toLocaleString()} leaves`, () => {
      computeMerkleRoot(leafHashesBySize[size]);
    });
  }
});

// ---------------------------------------------------------------------------
// Benchmarks — generateInclusionProof
// ---------------------------------------------------------------------------

describe('generateInclusionProof', () => {
  for (const size of SIZES) {
    const midIndex = Math.floor(size / 2);
    bench(`${size.toLocaleString()} leaves (mid-index)`, () => {
      generateInclusionProof(leafHashesBySize[size], midIndex);
    });
  }
});

// ---------------------------------------------------------------------------
// Benchmarks — verifyInclusionProof
// ---------------------------------------------------------------------------

describe('verifyInclusionProof', () => {
  // Pre-generate proofs so verify benchmarks only measure verification time
  const proofsBySize: Record<number, { proof: ReturnType<typeof generateInclusionProof>; root: string; leafHash: string }> = {};
  for (const size of SIZES) {
    const hashes = leafHashesBySize[size];
    const midIndex = Math.floor(size / 2);
    const proof = generateInclusionProof(hashes, midIndex);
    const root = computeMerkleRoot(hashes);
    proofsBySize[size] = { proof, root, leafHash: hashes[midIndex] };
  }

  for (const size of SIZES) {
    const { proof, root, leafHash } = proofsBySize[size];
    // Threshold at 10K: <0.5ms
    bench(`${size.toLocaleString()} leaves`, () => {
      const valid = verifyInclusionProof(proof, leafHash, root);
      if (!valid) throw new Error('Proof verification failed in benchmark');
    });
  }
});

// ---------------------------------------------------------------------------
// Benchmarks — buildTreeState
// ---------------------------------------------------------------------------

describe('buildTreeState', () => {
  for (const size of SIZES) {
    bench(`${size.toLocaleString()} leaves`, () => {
      buildTreeState(leafHashesBySize[size]);
    });
  }
});

// ---------------------------------------------------------------------------
// Benchmarks — append-and-rebuild
// ---------------------------------------------------------------------------

describe('append-and-rebuild', () => {
  for (const size of SIZES) {
    bench(`append 1 leaf to ${size.toLocaleString()} then rebuild root`, () => {
      const extended = [...leafHashesBySize[size], computeLeafHash(makeLeafData(size))];
      computeMerkleRoot(extended);
    });
  }
});
