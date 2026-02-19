/**
 * Shared test utilities for integration tests.
 *
 * Provides keypair generation, mock environment construction, and a
 * full-pipeline helper that runs every attestation step in order and
 * returns all intermediate artefacts for assertion.
 */

import * as ed from '@noble/ed25519';
import { randomBytes } from 'node:crypto';

import {
  signCheckpoint,
  computeInputCommitment,
  uint8ToHex,
  type InputCommitmentData,
} from '../../analyze/signing';
import {
  buildSignedPayload,
  buildCertificate,
  type SignedPayloadInput,
  type CertificateInput,
  type IntegrityCertificate,
} from '../../analyze/certificate';
import {
  computeChainHash,
  type ChainInput,
} from '../../analyze/chain';
import {
  computeLeafHash,
  buildTreeState,
  generateInclusionProof,
  type LeafData,
  type MerkleTreeState,
  type MerkleProof,
} from '../../analyze/merkle';

// ============================================================================
// Keypair generation
// ============================================================================

/**
 * Generate a fresh Ed25519 keypair for testing.
 */
export async function generateTestKeypair(): Promise<{
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  const secretKey = randomBytes(32);
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  return { secretKey: new Uint8Array(secretKey), publicKey };
}

// ============================================================================
// Mock environment
// ============================================================================

/**
 * Returns a mock BillingEnv-like object with placeholder config values.
 */
export function createMockEnv(): Record<string, unknown> {
  return {
    SUPABASE_URL: 'https://mock-supabase.example.com',
    SUPABASE_KEY: 'mock-supabase-key-abc123',
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_mock',
    SIGNING_KEY_HEX: 'a'.repeat(64),
    SIGNING_KEY_ID: 'key-test-001',
    PROVER_URL: '',
    PROVER_API_KEY: '',
  };
}

// ============================================================================
// Full pipeline helper
// ============================================================================

export interface FullAttestationResult {
  inputCommitment: string;
  chainHash: string;
  signedPayload: string;
  signature: string;
  leafHash: string;
  leafData: LeafData;
  treeState: MerkleTreeState;
  merkleProof: MerkleProof | null;
  certificate: IntegrityCertificate;
  certificateInput: CertificateInput;
  timestamp: string;
}

/**
 * Runs the full attestation pipeline:
 *   1. computeInputCommitment
 *   2. computeChainHash
 *   3. buildSignedPayload
 *   4. signCheckpoint
 *   5. computeLeafHash
 *   6. buildTreeState (with optional pre-existing leaves)
 *   7. generateInclusionProof (if tree has leaves)
 *   8. buildCertificate
 *
 * Returns every intermediate artefact for fine-grained assertions.
 */
export async function buildFullCheckpointWithAttestation(
  secretKey: Uint8Array,
  publicKey: Uint8Array,
  prevChainHash: string | null,
  chainPosition: number,
  existingLeafHashes: string[] = [],
): Promise<FullAttestationResult> {
  const checkpointId = `ic-integ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const agentId = 'agent-integ-001';
  const sessionId = 'session-integ-001';
  const cardId = 'card-integ-001';
  const verdict = 'clear';
  const timestamp = new Date().toISOString();

  // 1. Input commitment
  const inputData: InputCommitmentData = {
    card: { card_id: cardId, values: ['honesty', 'safety'] },
    conscienceValues: [{ type: 'value', content: 'Be honest', id: 'v1' }],
    windowContext: [],
    modelVersion: 'claude-3-opus-20240229',
    promptTemplateVersion: '2.1.0',
  };
  const inputCommitment = await computeInputCommitment(inputData);

  // 2. Chain hash
  const thinkingBlockHash = 'a1b2c3d4'.repeat(8); // 64-char hex placeholder
  const chainInput: ChainInput = {
    prevChainHash,
    checkpointId,
    verdict,
    thinkingBlockHash,
    inputCommitment,
    timestamp,
  };
  const chainHash = await computeChainHash(chainInput);

  // 3. Signed payload
  const payloadInput: SignedPayloadInput = {
    checkpointId,
    agentId,
    verdict,
    thinkingBlockHash,
    inputCommitment,
    chainHash,
    timestamp,
  };
  const signedPayload = buildSignedPayload(payloadInput);

  // 4. Sign
  const signature = await signCheckpoint(signedPayload, secretKey);

  // 5. Leaf hash
  const leafData: LeafData = {
    checkpointId,
    verdict,
    thinkingBlockHash,
    chainHash,
    timestamp,
  };
  const leafHash = computeLeafHash(leafData);

  // 6. Tree state
  const allLeafHashes = [...existingLeafHashes, leafHash];
  const treeState = buildTreeState(allLeafHashes);

  // 7. Merkle proof
  const leafIndex = allLeafHashes.length - 1;
  let merkleProof: MerkleProof | null = null;
  if (allLeafHashes.length > 0) {
    merkleProof = generateInclusionProof(allLeafHashes, leafIndex);
  }

  // 8. Certificate
  const keyId = `key-${uint8ToHex(publicKey).slice(0, 8)}`;
  const certInput: CertificateInput = {
    checkpointId,
    agentId,
    sessionId,
    cardId,
    verdict,
    concerns: [],
    confidence: 1.0,
    reasoningSummary: 'Integration test checkpoint.',
    analysisModel: 'claude-3-opus-20240229',
    analysisDurationMs: 150,
    thinkingBlockHash,
    cardHash: 'cafe0000'.repeat(8),
    valuesHash: 'dead0000'.repeat(8),
    contextHash: 'face0000'.repeat(8),
    modelVersion: 'claude-3-opus-20240229',
    inputCommitment,
    signatureKeyId: keyId,
    signatureValue: signature,
    signedPayload,
    chainHash,
    prevChainHash,
    chainPosition,
    merkleData: merkleProof
      ? {
          leafHash: merkleProof.leafHash,
          leafIndex: merkleProof.leafIndex,
          root: merkleProof.root,
          treeSize: merkleProof.treeSize,
          inclusionProof: merkleProof.siblings.map((s) => ({
            hash: s.hash,
            position: s.position,
          })),
        }
      : null,
  };

  const certificate = buildCertificate(certInput);

  return {
    inputCommitment,
    chainHash,
    signedPayload,
    signature,
    leafHash,
    leafData,
    treeState,
    merkleProof,
    certificate,
    certificateInput: certInput,
    timestamp,
  };
}
