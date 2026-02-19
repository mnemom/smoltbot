/**
 * Crypto operations benchmark — Ed25519 sign/verify, SHA-256 commitment, chain hash.
 *
 * Thresholds (per operation):
 *   - Ed25519 sign:           <2ms
 *   - Ed25519 verify:         <3ms
 *   - SHA-256 commitment:     <1ms
 *   - Chain hash:             <0.5ms
 */

import { bench, describe } from 'vitest';
import * as ed from '@noble/ed25519';
import {
  signCheckpoint,
  verifyCheckpointSignature,
  computeInputCommitment,
  type InputCommitmentData,
} from '../../analyze/signing';
import { computeChainHash, type ChainInput } from '../../analyze/chain';

// ---------------------------------------------------------------------------
// Fixtures — resolved once before benchmarks run
// ---------------------------------------------------------------------------

let secretKey: Uint8Array;
let publicKey: Uint8Array;

const samplePayload = JSON.stringify({
  checkpoint_id: 'cp-bench-001',
  agent_id: 'agent-bench',
  verdict: 'pass',
  thinking_block_hash: 'a'.repeat(64),
  input_commitment: 'b'.repeat(64),
  chain_hash: 'c'.repeat(64),
  timestamp: '2026-01-15T12:00:00.000Z',
});

let precomputedSignature: string;

const sampleCommitmentData: InputCommitmentData = {
  card: {
    card_id: 'card-bench-001',
    values: [
      { type: 'honesty', content: 'Be truthful' },
      { type: 'safety', content: 'Avoid harm' },
    ],
  },
  conscienceValues: [
    { type: 'honesty', content: 'Be truthful', id: 'v1' },
    { type: 'safety', content: 'Avoid harm', id: 'v2' },
  ],
  windowContext: [
    {
      checkpoint_id: 'cp-prev-001',
      verdict: 'pass',
      reasoning_summary: 'No concerns found in previous analysis.',
    },
  ],
  modelVersion: 'claude-3-opus-20240229',
  promptTemplateVersion: '2.1.0',
};

const sampleChainInput: ChainInput = {
  prevChainHash: 'd'.repeat(64),
  checkpointId: 'cp-bench-001',
  verdict: 'pass',
  thinkingBlockHash: 'a'.repeat(64),
  inputCommitment: 'b'.repeat(64),
  timestamp: '2026-01-15T12:00:00.000Z',
};

const genesisChainInput: ChainInput = {
  prevChainHash: null,
  checkpointId: 'cp-genesis',
  verdict: 'pass',
  thinkingBlockHash: 'e'.repeat(64),
  inputCommitment: 'f'.repeat(64),
  timestamp: '2026-01-15T11:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Setup — generate keypair and a pre-signed signature for verify benchmarks
// ---------------------------------------------------------------------------

async function setup() {
  secretKey = new Uint8Array(32);
  crypto.getRandomValues(secretKey);
  publicKey = await ed.getPublicKeyAsync(secretKey);
  precomputedSignature = await signCheckpoint(samplePayload, secretKey);
}

const ready = setup();

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('Ed25519 signing', () => {
  // Threshold: <2ms per sign
  bench('signCheckpoint', async () => {
    await ready;
    await signCheckpoint(samplePayload, secretKey);
  });
});

describe('Ed25519 verification', () => {
  // Threshold: <3ms per verify
  bench('verifyCheckpointSignature', async () => {
    await ready;
    const valid = await verifyCheckpointSignature(precomputedSignature, samplePayload, publicKey);
    if (!valid) throw new Error('Signature verification failed in benchmark');
  });
});

describe('SHA-256 input commitment', () => {
  // Threshold: <1ms per commitment
  bench('computeInputCommitment', async () => {
    await ready;
    await computeInputCommitment(sampleCommitmentData);
  });
});

describe('Chain hash computation', () => {
  // Threshold: <0.5ms per hash
  bench('computeChainHash — with prev', async () => {
    await ready;
    await computeChainHash(sampleChainInput);
  });

  bench('computeChainHash — genesis', async () => {
    await ready;
    await computeChainHash(genesisChainInput);
  });
});
