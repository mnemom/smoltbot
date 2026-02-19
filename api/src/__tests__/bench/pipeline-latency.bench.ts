/**
 * Full attestation pipeline latency benchmark (excludes I/O).
 *
 * Simulates the complete attestation flow:
 *   computeInputCommitment -> computeChainHash -> signCheckpoint
 *   -> computeLeafHash -> buildTreeState -> buildSignedPayload -> buildCertificate
 *
 * Threshold: <10ms total per pipeline invocation
 */

import { bench, describe } from 'vitest';
import * as ed from '@noble/ed25519';
import {
  signCheckpoint,
  computeInputCommitment,
  uint8ToHex,
  type InputCommitmentData,
} from '../../analyze/signing';
import { computeChainHash, type ChainInput } from '../../analyze/chain';
import { computeLeafHash, buildTreeState, type LeafData } from '../../analyze/merkle';
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

let secretKey: Uint8Array;
let publicKey: Uint8Array;
let publicKeyHex: string;

const commitmentData: InputCommitmentData = {
  card: {
    card_id: 'card-pipeline-001',
    values: [
      { type: 'honesty', content: 'Be truthful in all responses' },
      { type: 'safety', content: 'Never recommend harmful actions' },
    ],
  },
  conscienceValues: [
    { type: 'honesty', content: 'Be truthful in all responses', id: 'cv-1' },
    { type: 'safety', content: 'Never recommend harmful actions', id: 'cv-2' },
  ],
  windowContext: [
    {
      checkpoint_id: 'cp-prev-001',
      verdict: 'pass',
      reasoning_summary: 'Previous checkpoint passed all checks.',
    },
    {
      checkpoint_id: 'cp-prev-002',
      verdict: 'pass',
      reasoning_summary: 'No anomalies detected.',
    },
  ],
  modelVersion: 'claude-3-opus-20240229',
  promptTemplateVersion: '2.1.0',
};

const timestamp = '2026-01-15T12:00:00.000Z';
const checkpointId = 'cp-pipeline-bench-001';
const agentId = 'agent-pipeline-bench';
const sessionId = 'sess-pipeline-bench';
const prevChainHash = 'aabbccdd'.repeat(8); // 64-char hex

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function setup() {
  secretKey = new Uint8Array(32);
  crypto.getRandomValues(secretKey);
  publicKey = await ed.getPublicKeyAsync(secretKey);
  publicKeyHex = uint8ToHex(publicKey);
}

const ready = setup();

// ---------------------------------------------------------------------------
// Full pipeline benchmark
// ---------------------------------------------------------------------------

describe('Full attestation pipeline (no I/O)', () => {
  // Threshold: <10ms total
  bench('end-to-end pipeline', async () => {
    await ready;

    // Step 1: Compute input commitment (SHA-256)
    const inputCommitment = await computeInputCommitment(commitmentData);

    // Step 2: Compute chain hash (SHA-256 linking)
    const chainInput: ChainInput = {
      prevChainHash,
      checkpointId,
      verdict: 'pass',
      thinkingBlockHash: 'aaaa'.repeat(16),
      inputCommitment,
      timestamp,
    };
    const chainHash = await computeChainHash(chainInput);

    // Step 3: Build signed payload & sign
    const payloadInput: SignedPayloadInput = {
      checkpointId,
      agentId,
      verdict: 'pass',
      thinkingBlockHash: 'aaaa'.repeat(16),
      inputCommitment,
      chainHash,
      timestamp,
    };
    const signedPayloadStr = buildSignedPayload(payloadInput);
    const signatureValue = await signCheckpoint(signedPayloadStr, secretKey);

    // Step 4: Compute leaf hash
    const leafData: LeafData = {
      checkpointId,
      verdict: 'pass',
      thinkingBlockHash: 'aaaa'.repeat(16),
      chainHash,
      timestamp,
    };
    const leafHash = computeLeafHash(leafData);

    // Step 5: Build tree state (single leaf for pipeline benchmark)
    const treeState = buildTreeState([leafHash]);

    // Step 6: Assemble certificate
    const certInput: CertificateInput = {
      checkpointId,
      agentId,
      sessionId,
      cardId: 'card-pipeline-001',
      verdict: 'pass',
      concerns: [],
      confidence: 0.95,
      reasoningSummary: 'All checks passed with high confidence.',
      analysisModel: 'claude-3-opus-20240229',
      analysisDurationMs: 1200,
      thinkingBlockHash: 'aaaa'.repeat(16),
      cardHash: 'bbbb'.repeat(16),
      valuesHash: 'cccc'.repeat(16),
      contextHash: 'dddd'.repeat(16),
      modelVersion: 'claude-3-opus-20240229',
      inputCommitment,
      signatureKeyId: publicKeyHex,
      signatureValue,
      signedPayload: signedPayloadStr,
      chainHash,
      prevChainHash,
      chainPosition: 1,
      merkleData: {
        leafHash,
        leafIndex: 0,
        root: treeState.root,
        treeSize: treeState.leafCount,
        inclusionProof: [],
      },
    };
    const cert = buildCertificate(certInput);

    // Sanity check — ensure certificate was constructed
    if (!cert.certificate_id.startsWith('cert-')) {
      throw new Error('Pipeline produced invalid certificate');
    }
  });
});

// ---------------------------------------------------------------------------
// Individual stage benchmarks (for profiling bottlenecks)
// ---------------------------------------------------------------------------

describe('Pipeline stages (isolated)', () => {
  bench('1. computeInputCommitment', async () => {
    await ready;
    await computeInputCommitment(commitmentData);
  });

  bench('2. computeChainHash', async () => {
    await ready;
    await computeChainHash({
      prevChainHash,
      checkpointId,
      verdict: 'pass',
      thinkingBlockHash: 'aaaa'.repeat(16),
      inputCommitment: 'b'.repeat(64),
      timestamp,
    });
  });

  bench('3. signCheckpoint', async () => {
    await ready;
    const payload = buildSignedPayload({
      checkpointId,
      agentId,
      verdict: 'pass',
      thinkingBlockHash: 'aaaa'.repeat(16),
      inputCommitment: 'b'.repeat(64),
      chainHash: 'c'.repeat(64),
      timestamp,
    });
    await signCheckpoint(payload, secretKey);
  });

  bench('4. computeLeafHash', () => {
    computeLeafHash({
      checkpointId,
      verdict: 'pass',
      thinkingBlockHash: 'aaaa'.repeat(16),
      chainHash: 'c'.repeat(64),
      timestamp,
    });
  });

  bench('5. buildTreeState (100 leaves)', () => {
    const hashes: string[] = [];
    for (let i = 0; i < 100; i++) {
      hashes.push(`${'0'.repeat(60)}${i.toString(16).padStart(4, '0')}`);
    }
    buildTreeState(hashes);
  });

  bench('6. buildSignedPayload', () => {
    buildSignedPayload({
      checkpointId,
      agentId,
      verdict: 'pass',
      thinkingBlockHash: 'aaaa'.repeat(16),
      inputCommitment: 'b'.repeat(64),
      chainHash: 'c'.repeat(64),
      timestamp,
    });
  });

  bench('7. buildCertificate', () => {
    buildCertificate({
      checkpointId,
      agentId,
      sessionId,
      cardId: 'card-pipeline-001',
      verdict: 'pass',
      concerns: [],
      confidence: 0.95,
      reasoningSummary: 'All checks passed.',
      analysisModel: 'claude-3-opus-20240229',
      analysisDurationMs: 1200,
      thinkingBlockHash: 'aaaa'.repeat(16),
      cardHash: 'bbbb'.repeat(16),
      valuesHash: 'cccc'.repeat(16),
      contextHash: 'dddd'.repeat(16),
      modelVersion: 'claude-3-opus-20240229',
      inputCommitment: 'b'.repeat(64),
      signatureKeyId: 'key-bench-001',
      signatureValue: 'sig-placeholder',
      signedPayload: '{"placeholder":true}',
      chainHash: 'c'.repeat(64),
      prevChainHash,
      chainPosition: 1,
      merkleData: null,
    });
  });
});
