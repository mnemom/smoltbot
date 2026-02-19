/**
 * Hash Chain Linking Module
 *
 * Creates tamper-evident chain links between integrity checkpoints.
 * Each checkpoint includes a SHA-256 hash of the previous checkpoint,
 * forming an immutable sequence per agent+session. A broken link
 * indicates the checkpoint history has been altered.
 *
 * Chain format:
 *   genesis | checkpointId | verdict | thinkingBlockHash | inputCommitment | timestamp
 *   prevHash | checkpointId | verdict | thinkingBlockHash | inputCommitment | timestamp
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ============================================
// Types
// ============================================

export interface ChainInput {
  prevChainHash: string | null; // null for first checkpoint in session
  checkpointId: string;
  verdict: string;
  thinkingBlockHash: string;
  inputCommitment: string;
  timestamp: string; // ISO 8601
}

export interface ChainCheckpoint {
  checkpointId: string;
  verdict: string;
  thinkingBlockHash: string;
  inputCommitment: string;
  timestamp: string;
  chainHash: string;
  prevChainHash: string | null;
}

export interface ChainVerificationResult {
  valid: boolean;
  linksVerified: number;
  brokenAt?: number;
  details: string;
}

// ============================================
// Chain hash computation
// ============================================

/**
 * Computes the SHA-256 chain hash for a single checkpoint link.
 *
 * Concatenates the fields with pipe delimiters, substituting 'genesis'
 * for a null prevChainHash (first link in a session chain).
 */
export async function computeChainHash(input: ChainInput): Promise<string> {
  const preimage =
    `${input.prevChainHash || 'genesis'}|` +
    `${input.checkpointId}|` +
    `${input.verdict}|` +
    `${input.thinkingBlockHash}|` +
    `${input.inputCommitment}|` +
    `${input.timestamp}`;

  const encoder = new TextEncoder();
  const hash = sha256(encoder.encode(preimage));
  return bytesToHex(hash);
}

// ============================================
// Single link verification
// ============================================

/**
 * Verifies a single chain link by recomputing the hash and comparing
 * it to the expected value.
 */
export async function verifyChainLink(
  current: ChainInput,
  expectedHash: string,
): Promise<boolean> {
  const computed = await computeChainHash(current);
  return computed === expectedHash;
}

// ============================================
// Full chain sequence verification
// ============================================

/**
 * Verifies an ordered sequence of checkpoints (oldest first).
 *
 * Checks that:
 *   1. The first checkpoint has prevChainHash === null.
 *   2. Each subsequent checkpoint's prevChainHash matches the
 *      chainHash of the preceding checkpoint.
 *   3. Each checkpoint's chainHash matches its recomputed hash.
 *
 * Returns early on the first broken link, reporting its index.
 */
export async function verifyChainSequence(
  checkpoints: ChainCheckpoint[],
): Promise<ChainVerificationResult> {
  if (checkpoints.length === 0) {
    return { valid: true, linksVerified: 0, details: 'Empty chain; nothing to verify.' };
  }

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];

    // Validate prevChainHash linkage
    if (i === 0) {
      if (cp.prevChainHash !== null) {
        return {
          valid: false,
          linksVerified: 0,
          brokenAt: 0,
          details: 'First checkpoint must have prevChainHash === null.',
        };
      }
    } else {
      const prev = checkpoints[i - 1];
      if (cp.prevChainHash !== prev.chainHash) {
        return {
          valid: false,
          linksVerified: i,
          brokenAt: i,
          details:
            `Chain broken at index ${i}: prevChainHash does not match ` +
            `previous checkpoint's chainHash.`,
        };
      }
    }

    // Recompute and verify the chainHash
    const input: ChainInput = {
      prevChainHash: cp.prevChainHash,
      checkpointId: cp.checkpointId,
      verdict: cp.verdict,
      thinkingBlockHash: cp.thinkingBlockHash,
      inputCommitment: cp.inputCommitment,
      timestamp: cp.timestamp,
    };

    const valid = await verifyChainLink(input, cp.chainHash);
    if (!valid) {
      return {
        valid: false,
        linksVerified: i,
        brokenAt: i,
        details:
          `Chain broken at index ${i}: recomputed chainHash does not match ` +
          `stored chainHash.`,
      };
    }
  }

  return {
    valid: true,
    linksVerified: checkpoints.length,
    details: `All ${checkpoints.length} links verified successfully.`,
  };
}
