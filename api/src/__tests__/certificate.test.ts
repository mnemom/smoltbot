/**
 * Tests for the integrity certificate format module.
 *
 * Validates certificate ID generation, signed payload construction, and
 * full certificate assembly. The certificate is the public-facing artifact
 * that bundles all cryptographic evidence for a checkpoint — its structure
 * must be stable and machine-verifiable.
 */

import { describe, it, expect } from 'vitest';
import {
  generateCertificateId,
  buildSignedPayload,
  buildCertificate,
  type CertificateInput,
  type SignedPayloadInput,
} from '../analyze/certificate';

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal valid SignedPayloadInput for testing. */
function makeSignedPayloadInput(
  overrides: Partial<SignedPayloadInput> = {},
): SignedPayloadInput {
  return {
    checkpointId: 'ic-test-001',
    agentId: 'agent-abc',
    verdict: 'clear',
    thinkingBlockHash: 'abc123def456',
    inputCommitment: 'commitment-789',
    chainHash: 'chainhash-xyz',
    timestamp: '2026-01-15T12:00:00.000Z',
    ...overrides,
  };
}

/** Build a minimal valid CertificateInput for testing. */
function makeCertificateInput(
  overrides: Partial<CertificateInput> = {},
): CertificateInput {
  return {
    checkpointId: 'ic-test-001',
    agentId: 'agent-abc',
    sessionId: 'session-xyz',
    cardId: 'card-123',
    verdict: 'clear',
    concerns: [],
    confidence: 0.95,
    reasoningSummary: 'No alignment concerns detected.',
    analysisModel: 'claude-3-opus-20240229',
    analysisDurationMs: 450,
    thinkingBlockHash: 'abc123def456',
    cardHash: 'cardhash-111',
    valuesHash: 'valueshash-222',
    contextHash: 'contexthash-333',
    modelVersion: 'claude-3-opus-20240229',
    inputCommitment: 'commitment-789',
    signatureKeyId: 'key-prod-001',
    signatureValue: 'c2lnbmF0dXJlLXZhbHVl',
    signedPayload: '{"agent_id":"agent-abc","verdict":"clear"}',
    chainHash: 'chainhash-xyz',
    prevChainHash: null,
    chainPosition: 0,
    merkleData: null,
    ...overrides,
  };
}

// ============================================================================
// generateCertificateId
// ============================================================================

describe('generateCertificateId', () => {
  it('returns a string matching format "cert-{8chars}"', () => {
    const id = generateCertificateId();
    expect(id).toMatch(/^cert-[a-z0-9]{8}$/);
  });

  it('prefix is always "cert-"', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCertificateId().startsWith('cert-')).toBe(true);
    }
  });

  it('random part is always exactly 8 characters', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateCertificateId();
      const randomPart = id.slice(5); // after "cert-"
      expect(randomPart.length).toBe(8);
    }
  });

  it('random part uses only lowercase alphanumeric characters', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateCertificateId();
      const randomPart = id.slice(5);
      expect(randomPart).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('produces unique IDs (100 generated, all distinct)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCertificateId());
    }
    expect(ids.size).toBe(100);
  });

  it('total length is 13 characters (5 prefix + 8 random)', () => {
    const id = generateCertificateId();
    expect(id.length).toBe(13);
  });
});

// ============================================================================
// buildSignedPayload
// ============================================================================

describe('buildSignedPayload', () => {
  it('returns a valid JSON string', () => {
    const payload = buildSignedPayload(makeSignedPayloadInput());
    expect(() => JSON.parse(payload)).not.toThrow();
  });

  it('is deterministic (same inputs produce same string)', () => {
    const input = makeSignedPayloadInput();
    const p1 = buildSignedPayload(input);
    const p2 = buildSignedPayload(input);
    expect(p1).toBe(p2);
  });

  it('produces JSON with keys in sorted order', () => {
    const payload = buildSignedPayload(makeSignedPayloadInput());
    const parsed = JSON.parse(payload);
    const keys = Object.keys(parsed);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });

  it('contains all expected fields', () => {
    const input = makeSignedPayloadInput();
    const payload = buildSignedPayload(input);
    const parsed = JSON.parse(payload);

    expect(parsed.agent_id).toBe(input.agentId);
    expect(parsed.chain_hash).toBe(input.chainHash);
    expect(parsed.checkpoint_id).toBe(input.checkpointId);
    expect(parsed.input_commitment).toBe(input.inputCommitment);
    expect(parsed.thinking_block_hash).toBe(input.thinkingBlockHash);
    expect(parsed.timestamp).toBe(input.timestamp);
    expect(parsed.verdict).toBe(input.verdict);
  });

  it('has exactly 7 fields', () => {
    const payload = buildSignedPayload(makeSignedPayloadInput());
    const parsed = JSON.parse(payload);
    expect(Object.keys(parsed)).toHaveLength(7);
  });

  it('different inputs produce different payloads', () => {
    const p1 = buildSignedPayload(makeSignedPayloadInput({ verdict: 'clear' }));
    const p2 = buildSignedPayload(
      makeSignedPayloadInput({ verdict: 'boundary_violation' }),
    );
    expect(p1).not.toBe(p2);
  });

  it('key order is: agent_id, chain_hash, checkpoint_id, input_commitment, thinking_block_hash, timestamp, verdict', () => {
    const payload = buildSignedPayload(makeSignedPayloadInput());
    const parsed = JSON.parse(payload);
    const keys = Object.keys(parsed);
    expect(keys).toEqual([
      'agent_id',
      'chain_hash',
      'checkpoint_id',
      'input_commitment',
      'thinking_block_hash',
      'timestamp',
      'verdict',
    ]);
  });

  it('changes when any single field changes', () => {
    const base = makeSignedPayloadInput();
    const basePayload = buildSignedPayload(base);

    const fields: Array<[keyof SignedPayloadInput, string]> = [
      ['checkpointId', 'ic-other'],
      ['agentId', 'agent-other'],
      ['verdict', 'review_needed'],
      ['thinkingBlockHash', 'other-hash'],
      ['inputCommitment', 'other-commitment'],
      ['chainHash', 'other-chain'],
      ['timestamp', '2026-02-01T00:00:00Z'],
    ];

    for (const [field, value] of fields) {
      const modified = buildSignedPayload({ ...base, [field]: value });
      expect(modified).not.toBe(basePayload);
    }
  });
});

// ============================================================================
// buildCertificate
// ============================================================================

describe('buildCertificate', () => {
  it('produces a valid structure with all required top-level fields', () => {
    const cert = buildCertificate(makeCertificateInput());

    expect(cert['@context']).toBeDefined();
    expect(cert.type).toBeDefined();
    expect(cert.version).toBeDefined();
    expect(cert.certificate_id).toBeDefined();
    expect(cert.issued_at).toBeDefined();
    expect(cert.subject).toBeDefined();
    expect(cert.claims).toBeDefined();
    expect(cert.input_commitments).toBeDefined();
    expect(cert.proofs).toBeDefined();
    expect(cert.verification).toBeDefined();
  });

  it('has correct @context', () => {
    const cert = buildCertificate(makeCertificateInput());
    expect(cert['@context']).toBe('https://mnemom.ai/aip/v1');
  });

  it('has correct type', () => {
    const cert = buildCertificate(makeCertificateInput());
    expect(cert.type).toBe('IntegrityCertificate');
  });

  it('has correct version', () => {
    const cert = buildCertificate(makeCertificateInput());
    expect(cert.version).toBe('1.0.0');
  });

  it('certificate_id matches cert-{8chars} format', () => {
    const cert = buildCertificate(makeCertificateInput());
    expect(cert.certificate_id).toMatch(/^cert-[a-z0-9]{8}$/);
  });

  it('issued_at is a valid ISO 8601 timestamp', () => {
    const cert = buildCertificate(makeCertificateInput());
    const date = new Date(cert.issued_at);
    expect(date.toISOString()).toBe(cert.issued_at);
  });

  it('subject fields map correctly from input', () => {
    const input = makeCertificateInput();
    const cert = buildCertificate(input);

    expect(cert.subject.checkpoint_id).toBe(input.checkpointId);
    expect(cert.subject.agent_id).toBe(input.agentId);
    expect(cert.subject.session_id).toBe(input.sessionId);
    expect(cert.subject.card_id).toBe(input.cardId);
  });

  it('claims fields map correctly from input', () => {
    const input = makeCertificateInput({
      concerns: [
        { category: 'deception', severity: 'medium', description: 'Misleading claim' },
      ],
    });
    const cert = buildCertificate(input);

    expect(cert.claims.verdict).toBe(input.verdict);
    expect(cert.claims.concerns).toEqual(input.concerns);
    expect(cert.claims.confidence).toBe(input.confidence);
    expect(cert.claims.reasoning_summary).toBe(input.reasoningSummary);
    expect(cert.claims.analysis_model).toBe(input.analysisModel);
    expect(cert.claims.analysis_duration_ms).toBe(input.analysisDurationMs);
  });

  it('input_commitments fields map correctly from input', () => {
    const input = makeCertificateInput();
    const cert = buildCertificate(input);

    expect(cert.input_commitments.thinking_block_hash).toBe(input.thinkingBlockHash);
    expect(cert.input_commitments.card_hash).toBe(input.cardHash);
    expect(cert.input_commitments.values_hash).toBe(input.valuesHash);
    expect(cert.input_commitments.context_hash).toBe(input.contextHash);
    expect(cert.input_commitments.model_version).toBe(input.modelVersion);
    expect(cert.input_commitments.combined_commitment).toBe(input.inputCommitment);
  });

  it('proofs.signature fields map correctly', () => {
    const input = makeCertificateInput();
    const cert = buildCertificate(input);

    expect(cert.proofs.signature.algorithm).toBe('Ed25519');
    expect(cert.proofs.signature.key_id).toBe(input.signatureKeyId);
    expect(cert.proofs.signature.value).toBe(input.signatureValue);
    expect(cert.proofs.signature.signed_payload).toBe(input.signedPayload);
  });

  it('proofs.chain fields map correctly', () => {
    const input = makeCertificateInput({
      chainHash: 'my-chain-hash',
      prevChainHash: 'prev-chain-hash',
      chainPosition: 5,
    });
    const cert = buildCertificate(input);

    expect(cert.proofs.chain.chain_hash).toBe('my-chain-hash');
    expect(cert.proofs.chain.prev_chain_hash).toBe('prev-chain-hash');
    expect(cert.proofs.chain.position).toBe(5);
  });

  it('proofs.chain.prev_chain_hash is null for first checkpoint', () => {
    const input = makeCertificateInput({ prevChainHash: null, chainPosition: 0 });
    const cert = buildCertificate(input);

    expect(cert.proofs.chain.prev_chain_hash).toBeNull();
    expect(cert.proofs.chain.position).toBe(0);
  });

  it('proofs.merkle is null when merkleData is null', () => {
    const input = makeCertificateInput({ merkleData: null });
    const cert = buildCertificate(input);

    expect(cert.proofs.merkle).toBeNull();
  });

  it('proofs.merkle is populated when merkleData is provided', () => {
    const merkleData = {
      leafHash: 'leaf-hash-abc',
      leafIndex: 3,
      root: 'root-hash-xyz',
      treeSize: 10,
      inclusionProof: [
        { hash: 'sibling-1', position: 'right' as const },
        { hash: 'sibling-2', position: 'left' as const },
      ],
    };
    const input = makeCertificateInput({ merkleData });
    const cert = buildCertificate(input);

    expect(cert.proofs.merkle).not.toBeNull();
    expect(cert.proofs.merkle!.leaf_hash).toBe('leaf-hash-abc');
    expect(cert.proofs.merkle!.leaf_index).toBe(3);
    expect(cert.proofs.merkle!.root).toBe('root-hash-xyz');
    expect(cert.proofs.merkle!.tree_size).toBe(10);
    expect(cert.proofs.merkle!.inclusion_proof).toEqual([
      { hash: 'sibling-1', position: 'right' },
      { hash: 'sibling-2', position: 'left' },
    ]);
  });

  it('proofs.verdict_derivation is always null', () => {
    const cert = buildCertificate(makeCertificateInput());
    expect(cert.proofs.verdict_derivation).toBeNull();
  });

  it('verification URLs point to api.mnemom.ai', () => {
    const cert = buildCertificate(makeCertificateInput());

    expect(cert.verification.keys_url).toBe('https://api.mnemom.ai/v1/keys');
    expect(cert.verification.verify_url).toBe('https://api.mnemom.ai/v1/verify');
  });

  it('verification.certificate_url includes the checkpoint ID', () => {
    const input = makeCertificateInput({ checkpointId: 'ic-my-checkpoint' });
    const cert = buildCertificate(input);

    expect(cert.verification.certificate_url).toBe(
      'https://api.mnemom.ai/v1/checkpoints/ic-my-checkpoint/certificate',
    );
  });

  it('each call generates a unique certificate_id', () => {
    const input = makeCertificateInput();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const cert = buildCertificate(input);
      ids.add(cert.certificate_id);
    }
    expect(ids.size).toBe(50);
  });

  it('handles empty concerns array', () => {
    const input = makeCertificateInput({ concerns: [] });
    const cert = buildCertificate(input);
    expect(cert.claims.concerns).toEqual([]);
  });

  it('handles multiple concerns', () => {
    const concerns = [
      { category: 'deception', severity: 'high', description: 'Misleading output' },
      { category: 'safety', severity: 'low', description: 'Minor safety note' },
      { category: 'bias', severity: 'medium', description: 'Potential bias detected' },
    ];
    const input = makeCertificateInput({ concerns });
    const cert = buildCertificate(input);
    expect(cert.claims.concerns).toHaveLength(3);
    expect(cert.claims.concerns).toEqual(concerns);
  });

  it('certificate is JSON-serializable', () => {
    const cert = buildCertificate(makeCertificateInput());
    const json = JSON.stringify(cert);
    const parsed = JSON.parse(json);
    // Verify round-trip preserves structure (ignoring issued_at and certificate_id)
    expect(parsed['@context']).toBe(cert['@context']);
    expect(parsed.type).toBe(cert.type);
    expect(parsed.version).toBe(cert.version);
    expect(parsed.subject).toEqual(cert.subject);
    expect(parsed.claims).toEqual(cert.claims);
    expect(parsed.proofs.signature).toEqual(cert.proofs.signature);
  });
});
