/**
 * Certificate assembly benchmark — buildSignedPayload, buildCertificate,
 * JSON round-trip, generateCertificateId, and serialized size check.
 *
 * Thresholds:
 *   - buildSignedPayload:   <0.5ms
 *   - buildCertificate:     <0.5ms
 *   - JSON round-trip:      <0.5ms
 *   - Certificate size:     <5KB
 */

import { bench, describe } from 'vitest';
import {
  buildSignedPayload,
  buildCertificate,
  generateCertificateId,
  type SignedPayloadInput,
  type CertificateInput,
} from '../../analyze/certificate';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const payloadInput: SignedPayloadInput = {
  checkpointId: 'cp-cert-bench-001',
  agentId: 'agent-cert-bench',
  verdict: 'pass',
  thinkingBlockHash: 'aa'.repeat(32),
  inputCommitment: 'bb'.repeat(32),
  chainHash: 'cc'.repeat(32),
  timestamp: '2026-01-15T12:00:00.000Z',
};

const baseCertInput: CertificateInput = {
  checkpointId: 'cp-cert-bench-001',
  agentId: 'agent-cert-bench',
  sessionId: 'sess-cert-bench',
  cardId: 'card-cert-bench-001',
  verdict: 'pass',
  concerns: [
    { category: 'bias', severity: 'low', description: 'Minor phrasing bias detected.' },
    { category: 'accuracy', severity: 'medium', description: 'Unverified factual claim present.' },
  ],
  confidence: 0.92,
  reasoningSummary: 'Analysis complete. Two minor concerns identified but overall alignment is strong.',
  analysisModel: 'claude-3-opus-20240229',
  analysisDurationMs: 1350,
  thinkingBlockHash: 'aa'.repeat(32),
  cardHash: 'bb'.repeat(32),
  valuesHash: 'cc'.repeat(32),
  contextHash: 'dd'.repeat(32),
  modelVersion: 'claude-3-opus-20240229',
  inputCommitment: 'ee'.repeat(32),
  signatureKeyId: 'ff'.repeat(32),
  signatureValue: 'sig-' + '11'.repeat(32),
  signedPayload: buildSignedPayload(payloadInput),
  chainHash: 'cc'.repeat(32),
  prevChainHash: '99'.repeat(32),
  chainPosition: 5,
  merkleData: {
    leafHash: '22'.repeat(32),
    leafIndex: 4,
    root: '33'.repeat(32),
    treeSize: 10,
    inclusionProof: [
      { hash: '44'.repeat(32), position: 'right' },
      { hash: '55'.repeat(32), position: 'left' },
      { hash: '66'.repeat(32), position: 'right' },
      { hash: '77'.repeat(32), position: 'left' },
    ],
  },
};

const certInputNoMerkle: CertificateInput = {
  ...baseCertInput,
  merkleData: null,
};

// Pre-build a certificate for JSON round-trip benchmarks
const prebuiltCert = buildCertificate(baseCertInput);
const prebuiltCertJson = JSON.stringify(prebuiltCert);

// ---------------------------------------------------------------------------
// Benchmarks — buildSignedPayload
// ---------------------------------------------------------------------------

describe('buildSignedPayload', () => {
  // Threshold: <0.5ms
  bench('canonical payload construction', () => {
    buildSignedPayload(payloadInput);
  });
});

// ---------------------------------------------------------------------------
// Benchmarks — generateCertificateId
// ---------------------------------------------------------------------------

describe('generateCertificateId', () => {
  bench('random ID generation', () => {
    const id = generateCertificateId();
    if (!id.startsWith('cert-')) {
      throw new Error('Invalid certificate ID format');
    }
  });
});

// ---------------------------------------------------------------------------
// Benchmarks — buildCertificate
// ---------------------------------------------------------------------------

describe('buildCertificate', () => {
  // Threshold: <0.5ms
  bench('with Merkle proof (4 siblings)', () => {
    buildCertificate(baseCertInput);
  });

  bench('without Merkle proof (null)', () => {
    buildCertificate(certInputNoMerkle);
  });
});

// ---------------------------------------------------------------------------
// Benchmarks — JSON round-trip
// ---------------------------------------------------------------------------

describe('JSON round-trip', () => {
  // Threshold: <0.5ms
  bench('JSON.stringify(certificate)', () => {
    JSON.stringify(prebuiltCert);
  });

  bench('JSON.parse(certificateJson)', () => {
    JSON.parse(prebuiltCertJson);
  });

  bench('full round-trip: stringify + parse', () => {
    const json = JSON.stringify(prebuiltCert);
    const parsed = JSON.parse(json);
    if (parsed.type !== 'IntegrityCertificate') {
      throw new Error('Round-trip produced invalid certificate');
    }
  });
});

// ---------------------------------------------------------------------------
// Benchmarks — certificate serialized size
// ---------------------------------------------------------------------------

describe('certificate size validation', () => {
  // Threshold: serialized size <5KB
  bench('serialize and check size <5KB', () => {
    const json = JSON.stringify(buildCertificate(baseCertInput));
    const sizeBytes = new TextEncoder().encode(json).byteLength;
    if (sizeBytes > 5120) {
      throw new Error(`Certificate too large: ${sizeBytes} bytes (limit 5120)`);
    }
  });
});
