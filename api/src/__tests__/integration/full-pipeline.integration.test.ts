/**
 * Full pipeline integration tests.
 *
 * Validates that the entire attestation pipeline (input commitment,
 * chain hash, signed payload, Ed25519 signature, Merkle leaf,
 * certificate) produces internally-consistent, verifiable output
 * when the modules are composed end-to-end.
 */

import { describe, it, expect } from 'vitest';

import {
  verifyCheckpointSignature,
} from '../../analyze/signing';
import {
  verifyChainLink,
  type ChainInput,
} from '../../analyze/chain';
import {
  verifyInclusionProof,
} from '../../analyze/merkle';

import {
  generateTestKeypair,
  buildFullCheckpointWithAttestation,
} from './helpers';

describe('full-pipeline integration', () => {
  it('analysis produces valid attestation', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();
    const result = await buildFullCheckpointWithAttestation(
      secretKey,
      publicKey,
      null, // genesis
      0,
    );

    // Signature is present and non-empty
    expect(result.signature.length).toBeGreaterThan(0);

    // Chain hash is a 64-char hex SHA-256
    expect(result.chainHash).toMatch(/^[0-9a-f]{64}$/);

    // Certificate has expected structure
    const cert = result.certificate;
    expect(cert['@context']).toBe('https://mnemom.ai/aip/v1');
    expect(cert.type).toBe('IntegrityCertificate');
    expect(cert.version).toBe('1.0.0');
    expect(cert.certificate_id).toMatch(/^cert-[a-z0-9]{8}$/);
    expect(cert.proofs.signature.algorithm).toBe('Ed25519');
    expect(cert.proofs.signature.value).toBe(result.signature);
    expect(cert.proofs.chain.chain_hash).toBe(result.chainHash);
    expect(cert.proofs.chain.prev_chain_hash).toBeNull();
    expect(cert.proofs.chain.position).toBe(0);

    // Merkle proof is populated
    expect(cert.proofs.merkle).not.toBeNull();
    expect(cert.proofs.merkle!.leaf_hash).toBe(result.leafHash);
    expect(cert.proofs.merkle!.tree_size).toBe(1);

    // Input commitments are populated
    expect(cert.input_commitments.combined_commitment).toBe(result.inputCommitment);
    expect(cert.input_commitments.combined_commitment).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signature is verifiable with public key', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();
    const result = await buildFullCheckpointWithAttestation(
      secretKey,
      publicKey,
      null,
      0,
    );

    // Verify with the correct public key
    const valid = await verifyCheckpointSignature(
      result.signature,
      result.signedPayload,
      publicKey,
    );
    expect(valid).toBe(true);

    // Verify with a different key should fail
    const { publicKey: wrongKey } = await generateTestKeypair();
    const invalid = await verifyCheckpointSignature(
      result.signature,
      result.signedPayload,
      wrongKey,
    );
    expect(invalid).toBe(false);
  });

  it('certificate is verifiable via verify logic', async () => {
    const { secretKey, publicKey } = await generateTestKeypair();
    const result = await buildFullCheckpointWithAttestation(
      secretKey,
      publicKey,
      null,
      0,
    );

    const cert = result.certificate;

    // 1. Signature verification
    const sigValid = await verifyCheckpointSignature(
      cert.proofs.signature.value,
      cert.proofs.signature.signed_payload,
      publicKey,
    );
    expect(sigValid).toBe(true);

    // 2. Chain hash verification
    //    The chain hash was computed using the pipeline timestamp, not the
    //    certificate's issued_at (which is set independently by buildCertificate).
    const chainInput: ChainInput = {
      prevChainHash: cert.proofs.chain.prev_chain_hash,
      checkpointId: cert.subject.checkpoint_id,
      verdict: cert.claims.verdict,
      thinkingBlockHash: cert.input_commitments.thinking_block_hash,
      inputCommitment: cert.input_commitments.combined_commitment,
      timestamp: result.timestamp,
    };
    const chainValid = await verifyChainLink(chainInput, cert.proofs.chain.chain_hash);
    expect(chainValid).toBe(true);

    // 3. Merkle proof verification
    expect(cert.proofs.merkle).not.toBeNull();
    const merkleProof = {
      leafHash: cert.proofs.merkle!.leaf_hash,
      leafIndex: cert.proofs.merkle!.leaf_index,
      siblings: cert.proofs.merkle!.inclusion_proof.map((s) => ({
        hash: s.hash,
        position: s.position,
      })),
      root: cert.proofs.merkle!.root,
      treeSize: cert.proofs.merkle!.tree_size,
    };
    const merkleValid = verifyInclusionProof(
      merkleProof,
      cert.proofs.merkle!.leaf_hash,
      cert.proofs.merkle!.root,
    );
    expect(merkleValid).toBe(true);
  });
});
