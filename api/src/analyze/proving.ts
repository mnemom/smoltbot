/**
 * Zero-knowledge proof request module for verdict derivation.
 *
 * Handles stochastic proving decisions and fire-and-forget proof requests
 * to the external RISC Zero prover service. Follows the existing fail-open
 * pattern used by attestation and webhooks.
 */

import type { BillingEnv } from '../billing/types';

/** Proof request payload sent to prover service */
interface ProofRequest {
  proof_id: string;
  checkpoint_id: string;
  analysis_json: string;
  thinking_hash: string;
  card_hash: string;
  values_hash: string;
  model: string;
}

/**
 * Determine whether a checkpoint should be proven via zkVM.
 *
 * Rules:
 * - boundary_violation verdicts are ALWAYS proven
 * - 10% stochastic sampling for all other verdicts
 */
export function shouldProve(checkpoint: { verdict: string }): boolean {
  if (checkpoint.verdict === 'boundary_violation') {
    return true;
  }
  return Math.random() < 0.10;
}

/**
 * Generate a proof ID in the format "prf-{8 random chars}".
 */
function generateProofId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `prf-${id}`;
}

/**
 * Request a zero-knowledge proof for a checkpoint's verdict derivation.
 *
 * This is fire-and-forget: inserts a pending row in verdict_proofs, then
 * POSTs to the prover service. The prover writes results directly to the
 * database when complete. Matches the existing fail-open pattern at
 * handlers.ts line 550.
 *
 * @param env - Worker environment with Supabase + prover config
 * @param checkpointId - The checkpoint to prove
 * @param checkpointData - Analysis data needed for proof input
 * @param attestation - Attestation data with input commitment hashes
 */
export async function requestProof(
  env: BillingEnv,
  checkpointId: string,
  checkpointData: {
    analysis_response_text?: string;
    thinking_block_hash: string;
    card_hash?: string;
    values_hash?: string;
    model: string;
  },
  attestation: {
    input_commitment: string;
  },
): Promise<void> {
  const proverUrl = (env as unknown as Record<string, string>).PROVER_URL;
  const proverKey = (env as unknown as Record<string, string>).PROVER_API_KEY;

  if (!proverUrl) {
    return; // Prover not configured — silently skip
  }

  const proofId = generateProofId();

  // Insert pending proof row
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/verdict_proofs`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        proof_id: proofId,
        checkpoint_id: checkpointId,
        proof_type: 'risc-zero-stark',
        status: 'pending',
      }),
    });
    if (!response.ok) {
      return; // fail-open
    }
  } catch {
    return; // fail-open
  }

  // Fire-and-forget POST to prover
  const proofRequest: ProofRequest = {
    proof_id: proofId,
    checkpoint_id: checkpointId,
    analysis_json: checkpointData.analysis_response_text || '',
    thinking_hash: checkpointData.thinking_block_hash,
    card_hash: checkpointData.card_hash || '',
    values_hash: checkpointData.values_hash || '',
    model: checkpointData.model,
  };

  fetch(`${proverUrl}/prove`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(proverKey ? { 'X-Prover-Key': proverKey } : {}),
    },
    body: JSON.stringify(proofRequest),
  }).catch(() => { /* fail-open */ });
}
