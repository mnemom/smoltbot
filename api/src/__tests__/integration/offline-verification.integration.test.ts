/**
 * Offline verification integration tests.
 *
 * Validates that an integrity certificate can be fully verified using
 * only local crypto primitives (no API calls, no database), that the
 * signed payload is deterministic, and that the signing and certificate
 * modules produce compatible outputs.
 */

import { describe, it, expect } from 'vitest';

import {
  signCheckpoint,
  verifyCheckpointSignature,
  computeInputCommitment,
  uint8ToHex,
  type InputCommitmentData,
} from '../../analyze/signing';
import {
  buildSignedPayload,
  buildCertificate,
  type SignedPayloadInput,
  type CertificateInput,
} from '../../analyze/certificate';
import {
  computeChainHash,
  verifyChainLink,
  type ChainInput,
} from '../../analyze/chain';
import {
  computeLeafHash,
  generateInclusionProof,
  verifyInclusionProof,
  type LeafData,
} from '../../analyze/merkle';

import { generateTestKeypair } from './helpers';

// ============================================================================
// Tests
// ============================================================================

describe('offline verification integration', () => {
  it('full offline verification without any API calls', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();

    const checkpointId = `ic-offline-${Date.now()}`;
    const agentId = 'agent-offline-001';
    const verdict = 'review_needed';
    const timestamp = new Date().toISOString();
    const thinkingBlockHash = 'ff00ff00'.repeat(8);

    // Step 1: Input commitment
    const inputData: InputCommitmentData = {
      card: { card_id: 'card-offline-001', values: ['autonomy'] },
      conscienceValues: [{ type: 'boundary', content: 'No harm', id: 'b1' }],
      windowContext: [],
      modelVersion: 'claude-3-opus-20240229',
      promptTemplateVersion: '2.1.0',
    };
    const inputCommitment = await computeInputCommitment(inputData);

    // Step 2: Chain hash
    const chainInput: ChainInput = {
      prevChainHash: null,
      checkpointId,
      verdict,
      thinkingBlockHash,
      inputCommitment,
      timestamp,
    };
    const chainHash = await computeChainHash(chainInput);

    // Step 3: Signed payload + signature
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

    // Step 4: Merkle tree
    const leafData: LeafData = {
      checkpointId,
      verdict,
      thinkingBlockHash,
      chainHash,
      timestamp,
    };
    const leafHash = computeLeafHash(leafData);
    const proof = generateInclusionProof([leafHash], 0);

    // Step 5: Build certificate
    const keyId = `key-${uint8ToHex(publicKey).slice(0, 8)}`;
    const certInput: CertificateInput = {
      checkpointId,
      agentId,
      sessionId: 'session-offline-001',
      cardId: 'card-offline-001',
      verdict,
      concerns: [{ category: 'autonomy', severity: 'medium', description: 'Potential autonomy concern' }],
      confidence: 0.85,
      reasoningSummary: 'Offline verification test.',
      analysisModel: 'claude-3-opus-20240229',
      analysisDurationMs: 200,
      thinkingBlockHash,
      cardHash: '11110000'.repeat(8),
      valuesHash: '22220000'.repeat(8),
      contextHash: '33330000'.repeat(8),
      modelVersion: 'claude-3-opus-20240229',
      inputCommitment,
      signatureKeyId: keyId,
      signatureValue: signature,
      signedPayload,
      chainHash,
      prevChainHash: null,
      chainPosition: 0,
      merkleData: {
        leafHash: proof.leafHash,
        leafIndex: proof.leafIndex,
        root: proof.root,
        treeSize: proof.treeSize,
        inclusionProof: proof.siblings.map((s) => ({
          hash: s.hash,
          position: s.position,
        })),
      },
    };
    const cert = buildCertificate(certInput);

    // Override issued_at to match timestamp used in chain
    (cert as unknown as Record<string, unknown>).issued_at = timestamp;

    // === OFFLINE VERIFICATION (no API calls) ===

    // V1: Signature
    const sigValid = await verifyCheckpointSignature(
      cert.proofs.signature.value,
      cert.proofs.signature.signed_payload,
      publicKey,
    );
    expect(sigValid).toBe(true);

    // V2: Chain hash
    const reChainInput: ChainInput = {
      prevChainHash: cert.proofs.chain.prev_chain_hash,
      checkpointId: cert.subject.checkpoint_id,
      verdict: cert.claims.verdict,
      thinkingBlockHash: cert.input_commitments.thinking_block_hash,
      inputCommitment: cert.input_commitments.combined_commitment,
      timestamp: cert.issued_at,
    };
    const chainValid = await verifyChainLink(
      reChainInput,
      cert.proofs.chain.chain_hash,
    );
    expect(chainValid).toBe(true);

    // V3: Merkle inclusion
    expect(cert.proofs.merkle).not.toBeNull();
    const merkle = cert.proofs.merkle!;
    const merkleProof = {
      leafHash: merkle.leaf_hash,
      leafIndex: merkle.leaf_index,
      siblings: merkle.inclusion_proof.map((s) => ({
        hash: s.hash,
        position: s.position,
      })),
      root: merkle.root,
      treeSize: merkle.tree_size,
    };
    const merkleValid = verifyInclusionProof(
      merkleProof,
      merkle.leaf_hash,
      merkle.root,
    );
    expect(merkleValid).toBe(true);

    // V4: Input commitment is present and well-formed
    expect(cert.input_commitments.combined_commitment).toMatch(/^[0-9a-f]{64}$/);

    // V5: Certificate metadata is well-formed
    expect(cert['@context']).toBe('https://mnemom.ai/aip/v1');
    expect(cert.type).toBe('IntegrityCertificate');
    expect(cert.claims.verdict).toBe('review_needed');
    expect(cert.claims.concerns).toHaveLength(1);
    expect(cert.claims.confidence).toBe(0.85);
  });

  it('signed payload is deterministic', async () => {
    const payloadInput: SignedPayloadInput = {
      checkpointId: 'ic-determ-001',
      agentId: 'agent-determ-001',
      verdict: 'clear',
      thinkingBlockHash: 'abcd0000'.repeat(8),
      inputCommitment: 'ef010000'.repeat(8),
      chainHash: '12340000'.repeat(8),
      timestamp: '2025-01-15T10:00:00.000Z',
    };

    const payload1 = buildSignedPayload(payloadInput);
    const payload2 = buildSignedPayload(payloadInput);
    const payload3 = buildSignedPayload(payloadInput);

    // All calls produce identical output
    expect(payload1).toBe(payload2);
    expect(payload2).toBe(payload3);

    // Output is valid JSON
    const parsed = JSON.parse(payload1);
    expect(parsed.checkpoint_id).toBe('ic-determ-001');
    expect(parsed.verdict).toBe('clear');
    expect(parsed.agent_id).toBe('agent-determ-001');

    // Keys are sorted alphabetically in the JSON string
    const keys = Object.keys(parsed);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });

  it('cross-package consistency: signing and certificate modules produce compatible outputs', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();

    const checkpointId = 'ic-compat-001';
    const agentId = 'agent-compat-001';
    const verdict = 'clear';
    const timestamp = '2025-06-01T12:00:00.000Z';
    const thinkingBlockHash = '99990000'.repeat(8);
    const inputCommitment = '88880000'.repeat(8);
    const chainHash = '77770000'.repeat(8);

    // Build signed payload via certificate module
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

    // Sign via signing module
    const signature = await signCheckpoint(signedPayload, secretKey);

    // Verify via signing module using the payload from certificate module
    const valid = await verifyCheckpointSignature(
      signature,
      signedPayload,
      publicKey,
    );
    expect(valid).toBe(true);

    // Build certificate with these values
    const certInput: CertificateInput = {
      checkpointId,
      agentId,
      sessionId: 'session-compat-001',
      cardId: 'card-compat-001',
      verdict,
      concerns: [],
      confidence: 1.0,
      reasoningSummary: 'Compatibility test.',
      analysisModel: 'claude-3-opus-20240229',
      analysisDurationMs: 50,
      thinkingBlockHash,
      cardHash: 'aaaa0000'.repeat(8),
      valuesHash: 'bbbb0000'.repeat(8),
      contextHash: 'cccc0000'.repeat(8),
      modelVersion: 'claude-3-opus-20240229',
      inputCommitment,
      signatureKeyId: 'key-compat-001',
      signatureValue: signature,
      signedPayload,
      chainHash,
      prevChainHash: null,
      chainPosition: 0,
      merkleData: null,
    };
    const cert = buildCertificate(certInput);

    // Certificate's signed_payload matches what we built
    expect(cert.proofs.signature.signed_payload).toBe(signedPayload);

    // Certificate's signature matches what signing module produced
    expect(cert.proofs.signature.value).toBe(signature);

    // And the signature in the certificate is still verifiable
    const certSigValid = await verifyCheckpointSignature(
      cert.proofs.signature.value,
      cert.proofs.signature.signed_payload,
      publicKey,
    );
    expect(certSigValid).toBe(true);
  });
});
