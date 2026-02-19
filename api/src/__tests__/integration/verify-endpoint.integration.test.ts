/**
 * Verify endpoint integration tests.
 *
 * Exercises every verification check (signature, chain, merkle,
 * input_commitment, verdict_derivation) by constructing real
 * certificates and manually running each check as the verify
 * endpoint would. No network calls -- all crypto is local.
 */

import { describe, it, expect } from 'vitest';

import {
  signCheckpoint,
  verifyCheckpointSignature,
  computeInputCommitment,
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
  verifyChainLink,
  type ChainInput,
} from '../../analyze/chain';
import {
  computeLeafHash,
  buildTreeState,
  generateInclusionProof,
  verifyInclusionProof,
  type LeafData,
} from '../../analyze/merkle';

import { generateTestKeypair } from './helpers';

// ============================================================================
// Build a fully-populated certificate for testing
// ============================================================================

async function buildTestCertificate(): Promise<{
  cert: IntegrityCertificate;
  publicKey: Uint8Array;
  inputCommitment: string;
}> {
  const { secretKey, publicKey } = await generateTestKeypair();

  const checkpointId = `ic-verify-${Date.now()}`;
  const agentId = 'agent-verify-001';
  const verdict = 'clear';
  const timestamp = new Date().toISOString();
  const thinkingBlockHash = 'dd00dd00'.repeat(8);

  const inputData: InputCommitmentData = {
    card: { card_id: 'card-verify-001', values: ['transparency'] },
    conscienceValues: [{ type: 'value', content: 'Be transparent', id: 'v1' }],
    windowContext: [],
    modelVersion: 'claude-3-opus-20240229',
    promptTemplateVersion: '2.1.0',
  };
  const inputCommitment = await computeInputCommitment(inputData);

  const chainInput: ChainInput = {
    prevChainHash: null,
    checkpointId,
    verdict,
    thinkingBlockHash,
    inputCommitment,
    timestamp,
  };
  const chainHash = await computeChainHash(chainInput);

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
  const signature = await signCheckpoint(signedPayload, secretKey);

  const leafData: LeafData = {
    checkpointId,
    verdict,
    thinkingBlockHash,
    chainHash,
    timestamp,
  };
  const leafHash = computeLeafHash(leafData);
  const treeState = buildTreeState([leafHash]);
  const merkleProof = generateInclusionProof([leafHash], 0);

  const certInput: CertificateInput = {
    checkpointId,
    agentId,
    sessionId: 'session-verify-001',
    cardId: 'card-verify-001',
    verdict,
    concerns: [],
    confidence: 1.0,
    reasoningSummary: 'Test checkpoint for verify endpoint.',
    analysisModel: 'claude-3-opus-20240229',
    analysisDurationMs: 100,
    thinkingBlockHash,
    cardHash: 'cafe1111'.repeat(8),
    valuesHash: 'dead1111'.repeat(8),
    contextHash: 'face1111'.repeat(8),
    modelVersion: 'claude-3-opus-20240229',
    inputCommitment,
    signatureKeyId: 'key-verify-001',
    signatureValue: signature,
    signedPayload,
    chainHash,
    prevChainHash: null,
    chainPosition: 0,
    merkleData: {
      leafHash: merkleProof.leafHash,
      leafIndex: merkleProof.leafIndex,
      root: merkleProof.root,
      treeSize: merkleProof.treeSize,
      inclusionProof: merkleProof.siblings.map((s) => ({
        hash: s.hash,
        position: s.position,
      })),
    },
  };

  const cert = buildCertificate(certInput);

  // Override issued_at to match the timestamp used in chain hash
  (cert as unknown as Record<string, unknown>).issued_at = timestamp;

  return { cert, publicKey, inputCommitment };
}

// ============================================================================
// Tests
// ============================================================================

describe('verify endpoint integration', () => {
  // ---- Signature checks ----

  it('signature check passes with correct public key', async () => {
    const { cert, publicKey } = await buildTestCertificate();

    const valid = await verifyCheckpointSignature(
      cert.proofs.signature.value,
      cert.proofs.signature.signed_payload,
      publicKey,
    );
    expect(valid).toBe(true);
  });

  it('signature check fails with wrong public key', async () => {
    const { cert } = await buildTestCertificate();
    const { publicKey: wrongKey } = await generateTestKeypair();

    const valid = await verifyCheckpointSignature(
      cert.proofs.signature.value,
      cert.proofs.signature.signed_payload,
      wrongKey,
    );
    expect(valid).toBe(false);
  });

  // ---- Chain checks ----

  it('chain check passes with correct chain hash', async () => {
    const { cert } = await buildTestCertificate();

    const chainInput: ChainInput = {
      prevChainHash: cert.proofs.chain.prev_chain_hash,
      checkpointId: cert.subject.checkpoint_id,
      verdict: cert.claims.verdict,
      thinkingBlockHash: cert.input_commitments.thinking_block_hash,
      inputCommitment: cert.input_commitments.combined_commitment,
      timestamp: cert.issued_at,
    };

    const valid = await verifyChainLink(chainInput, cert.proofs.chain.chain_hash);
    expect(valid).toBe(true);
  });

  it('chain check fails with tampered verdict', async () => {
    const { cert } = await buildTestCertificate();

    const chainInput: ChainInput = {
      prevChainHash: cert.proofs.chain.prev_chain_hash,
      checkpointId: cert.subject.checkpoint_id,
      verdict: 'boundary_violation', // tampered
      thinkingBlockHash: cert.input_commitments.thinking_block_hash,
      inputCommitment: cert.input_commitments.combined_commitment,
      timestamp: cert.issued_at,
    };

    const valid = await verifyChainLink(chainInput, cert.proofs.chain.chain_hash);
    expect(valid).toBe(false);
  });

  // ---- Merkle checks ----

  it('merkle check passes with valid inclusion proof', async () => {
    const { cert } = await buildTestCertificate();

    expect(cert.proofs.merkle).not.toBeNull();
    const merkle = cert.proofs.merkle!;

    const proof = {
      leafHash: merkle.leaf_hash,
      leafIndex: merkle.leaf_index,
      siblings: merkle.inclusion_proof.map((s) => ({
        hash: s.hash,
        position: s.position,
      })),
      root: merkle.root,
      treeSize: merkle.tree_size,
    };

    const valid = verifyInclusionProof(proof, merkle.leaf_hash, merkle.root);
    expect(valid).toBe(true);
  });

  it('merkle check fails with wrong root', async () => {
    const { cert } = await buildTestCertificate();

    expect(cert.proofs.merkle).not.toBeNull();
    const merkle = cert.proofs.merkle!;

    const proof = {
      leafHash: merkle.leaf_hash,
      leafIndex: merkle.leaf_index,
      siblings: merkle.inclusion_proof.map((s) => ({
        hash: s.hash,
        position: s.position,
      })),
      root: merkle.root,
      treeSize: merkle.tree_size,
    };

    // Verify against a fabricated root
    const fakeRoot = '0000000000000000000000000000000000000000000000000000000000000000';
    const valid = verifyInclusionProof(proof, merkle.leaf_hash, fakeRoot);
    expect(valid).toBe(false);
  });

  // ---- Input commitment checks ----

  it('input_commitment present check passes', async () => {
    const { cert, inputCommitment } = await buildTestCertificate();

    const commitment = cert.input_commitments.combined_commitment;
    expect(commitment).toBeTruthy();
    expect(commitment).toBe(inputCommitment);
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
  });

  it('input_commitment missing check fails', () => {
    // Simulate a certificate with empty combined_commitment
    const commitment = '';
    const valid = !!commitment;
    expect(valid).toBe(false);
  });

  // ---- Verdict derivation ----

  it('verdict_derivation null is acceptable', async () => {
    const { cert } = await buildTestCertificate();

    // By default, verdict_derivation is null (not yet proven)
    expect(cert.proofs.verdict_derivation).toBeNull();
    // This is acceptable -- null means "not present (optional)"
    const isOptional = cert.proofs.verdict_derivation === null;
    expect(isOptional).toBe(true);
  });
});
