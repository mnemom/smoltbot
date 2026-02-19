/**
 * Verification API Endpoint Handlers
 *
 * Public endpoints for cryptographic attestation verification:
 *
 *   GET  /v1/keys                           — list active signing keys
 *   GET  /v1/checkpoints/:id/certificate    — retrieve integrity certificate
 *   POST /v1/verify                         — verify a certificate
 *   GET  /v1/agents/:id/merkle-root         — agent Merkle tree root
 *   GET  /v1/checkpoints/:id/inclusion-proof — Merkle inclusion proof
 *
 * All endpoints are public (no auth required). They allow any party
 * to independently verify the integrity of analysis checkpoints
 * without trusting the Mnemom API.
 */

import type { BillingEnv } from '../billing/types';
import { verifyCheckpointSignature, base64ToUint8, loadSigningKeyFromHex } from './signing';
import { computeChainHash, type ChainInput } from './chain';
import { generateInclusionProof, verifyInclusionProof, computeLeafHash } from './merkle';
import { buildCertificate, type CertificateInput, type IntegrityCertificate } from './certificate';
import type {
  SigningKeyInfo,
  MerkleRootResponse,
  InclusionProofResponse,
  VerifyCertificateResponse,
  ProofStatusResponse,
} from './types';

// ============================================
// Response helpers
// ============================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Mnemom-Api-Key, X-AIP-Version',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ============================================
// Supabase fetch helper
// ============================================

async function supabaseGet(
  env: BillingEnv,
  path: string,
): Promise<{ data: unknown; error: string | null }> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      return { data: null, error: await response.text() };
    }
    return { data: await response.json(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============================================
// GET /v1/keys
// ============================================

/**
 * List all active signing keys. Public endpoint, no auth required.
 */
export async function handleGetKeys(env: BillingEnv): Promise<Response> {
  const { data, error } = await supabaseGet(
    env,
    'signing_keys?is_active=eq.true&select=key_id,public_key,algorithm,created_at,is_active',
  );

  if (error) {
    return errorResponse('Failed to retrieve signing keys', 503);
  }

  const keys = (data as SigningKeyInfo[]) || [];
  return jsonResponse({ keys });
}

// ============================================
// GET /v1/checkpoints/:id/certificate
// ============================================

/**
 * Retrieve or reconstruct an integrity certificate for a checkpoint.
 * Public endpoint, no auth required.
 */
export async function handleGetCertificate(
  env: BillingEnv,
  checkpointId: string,
): Promise<Response> {
  // Fetch the checkpoint
  const { data: cpData, error: cpError } = await supabaseGet(
    env,
    `integrity_checkpoints?checkpoint_id=eq.${encodeURIComponent(checkpointId)}&select=*`,
  );

  if (cpError) {
    return errorResponse('Failed to retrieve checkpoint', 503);
  }

  const checkpoints = cpData as Record<string, unknown>[];
  if (!checkpoints || checkpoints.length === 0) {
    return errorResponse('Checkpoint not found', 404);
  }

  const cp = checkpoints[0];

  if (!cp.certificate_id) {
    return errorResponse('Certificate not available for this checkpoint', 404);
  }

  // Extract analysis metadata
  const analysisMeta = cp.analysis_metadata as Record<string, unknown> | undefined;
  const concerns = (cp.concerns as Array<{ category: string; severity: string; description: string }>) || [];

  // Build certificate input from stored checkpoint data
  const certInput: CertificateInput = {
    checkpointId: cp.checkpoint_id as string,
    agentId: cp.agent_id as string,
    sessionId: cp.session_id as string,
    cardId: cp.card_id as string,
    verdict: cp.verdict as string,
    concerns,
    confidence: (analysisMeta?.extraction_confidence as number) ?? 1.0,
    reasoningSummary: cp.reasoning_summary as string,
    analysisModel: (analysisMeta?.analysis_model as string) || 'unknown',
    analysisDurationMs: (analysisMeta?.analysis_duration_ms as number) || 0,
    thinkingBlockHash: cp.thinking_block_hash as string,
    cardHash: (cp.card_hash as string) || '',
    valuesHash: (cp.values_hash as string) || '',
    contextHash: (cp.context_hash as string) || '',
    modelVersion: (cp.model_version as string) || '',
    inputCommitment: (cp.input_commitment as string) || '',
    signatureKeyId: (cp.signing_key_id as string) || '',
    signatureValue: (cp.signature as string) || '',
    signedPayload: (cp.signed_payload as string) || '',
    chainHash: (cp.chain_hash as string) || '',
    prevChainHash: (cp.prev_chain_hash as string) || null,
    chainPosition: (cp.chain_position as number) || 0,
    merkleData: null,
  };

  // If Merkle data is available, fetch and include it
  if (cp.merkle_leaf_index != null && cp.agent_id) {
    const { data: treeData } = await supabaseGet(
      env,
      `agent_merkle_trees?agent_id=eq.${encodeURIComponent(cp.agent_id as string)}&select=*`,
    );

    const trees = treeData as Record<string, unknown>[];
    if (trees && trees.length > 0) {
      const tree = trees[0];
      const leafHashes = (tree.leaf_hashes as string[]) || [];
      const leafIndex = cp.merkle_leaf_index as number;

      if (leafIndex >= 0 && leafIndex < leafHashes.length) {
        try {
          const proof = generateInclusionProof(leafHashes, leafIndex);
          certInput.merkleData = {
            leafHash: proof.leafHash,
            leafIndex: proof.leafIndex,
            root: proof.root,
            treeSize: proof.treeSize,
            inclusionProof: proof.siblings.map((s) => ({ hash: s.hash, position: s.position })),
          };
        } catch {
          // Merkle proof generation failed; omit merkle data
        }
      }
    }
  }

  const certificate = buildCertificate(certInput);

  // Populate verdict_derivation proof if available
  try {
    const { data: proofData } = await supabaseGet(
      env,
      `verdict_proofs?checkpoint_id=eq.${encodeURIComponent(checkpointId)}&status=eq.completed&select=image_id,receipt,journal,verified_at&limit=1`,
    );
    const proofs = proofData as Array<Record<string, unknown>>;
    if (proofs && proofs.length > 0) {
      const proof = proofs[0];
      (certificate.proofs as Record<string, unknown>).verdict_derivation = {
        method: 'RISC-Zero-STARK' as const,
        image_id: proof.image_id as string,
        receipt: proof.receipt as string,
        journal: proof.journal as string,
        verified_at: proof.verified_at as string,
      };
    }
  } catch {
    // Fail-open: verdict_derivation stays null if lookup fails
  }

  // Override the certificate_id with the stored one for consistency
  (certificate as unknown as Record<string, unknown>).certificate_id = cp.certificate_id;

  return jsonResponse(certificate);
}

// ============================================
// POST /v1/verify
// ============================================

/**
 * Verify an integrity certificate. Public endpoint, no auth required.
 * Performs signature, chain hash, and Merkle proof verification.
 */
export async function handleVerifyCertificate(
  env: BillingEnv,
  request: Request,
): Promise<Response> {
  // Parse request body
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const cert = body.certificate as IntegrityCertificate | undefined;
  if (!cert || typeof cert !== 'object') {
    return errorResponse('certificate field is required', 400);
  }

  // Validate certificate structure
  if (!cert.proofs?.signature || !cert.subject?.checkpoint_id) {
    return errorResponse('Invalid certificate structure', 400);
  }

  const checks: VerifyCertificateResponse['checks'] = {
    signature: { valid: false, key_id: cert.proofs.signature.key_id },
    chain: { valid: false, chain_hash: cert.proofs.chain?.chain_hash || '' },
    merkle: null,
    input_commitment: { valid: false, commitment: cert.input_commitments?.combined_commitment || '' },
    verdict_derivation: null,
  };

  let allValid = true;
  const details: string[] = [];

  // ---- Check 1: Signature verification ----
  try {
    const keyId = cert.proofs.signature.key_id;
    const { data: keyData, error: keyError } = await supabaseGet(
      env,
      `signing_keys?key_id=eq.${encodeURIComponent(keyId)}&select=public_key,algorithm`,
    );

    if (keyError || !keyData || (keyData as unknown[]).length === 0) {
      checks.signature.valid = false;
      allValid = false;
      details.push(`Signature: signing key "${keyId}" not found`);
    } else {
      const keys = keyData as Array<{ public_key: string; algorithm: string }>;
      const publicKeyHex = keys[0].public_key;
      const publicKey = loadSigningKeyFromHex(publicKeyHex);

      const signatureValid = await verifyCheckpointSignature(
        cert.proofs.signature.value,
        cert.proofs.signature.signed_payload,
        publicKey,
      );

      checks.signature.valid = signatureValid;
      if (!signatureValid) {
        allValid = false;
        details.push('Signature: Ed25519 signature verification failed');
      } else {
        details.push('Signature: valid');
      }
    }
  } catch (err) {
    checks.signature.valid = false;
    allValid = false;
    details.push(`Signature: verification error — ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // ---- Check 2: Chain hash verification ----
  try {
    const chainProof = cert.proofs.chain;
    if (chainProof && chainProof.chain_hash) {
      const chainInput: ChainInput = {
        prevChainHash: chainProof.prev_chain_hash,
        checkpointId: cert.subject.checkpoint_id,
        verdict: cert.claims.verdict,
        thinkingBlockHash: cert.input_commitments.thinking_block_hash,
        inputCommitment: cert.input_commitments.combined_commitment,
        timestamp: cert.issued_at,
      };

      const recomputedHash = await computeChainHash(chainInput);
      const chainValid = recomputedHash === chainProof.chain_hash;

      checks.chain.valid = chainValid;
      if (!chainValid) {
        allValid = false;
        details.push('Chain: recomputed chain hash does not match certificate');
      } else {
        details.push('Chain: valid');
      }
    } else {
      checks.chain.valid = false;
      allValid = false;
      details.push('Chain: no chain proof data in certificate');
    }
  } catch (err) {
    checks.chain.valid = false;
    allValid = false;
    details.push(`Chain: verification error — ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // ---- Check 3: Merkle proof verification ----
  try {
    const merkleProof = cert.proofs.merkle;
    if (merkleProof) {
      const proof = {
        leafHash: merkleProof.leaf_hash,
        leafIndex: merkleProof.leaf_index,
        siblings: merkleProof.inclusion_proof.map((s) => ({
          hash: s.hash,
          position: s.position,
        })),
        root: merkleProof.root,
        treeSize: merkleProof.tree_size,
      };

      const merkleValid = verifyInclusionProof(proof, merkleProof.leaf_hash, merkleProof.root);

      checks.merkle = { valid: merkleValid, root: merkleProof.root };
      if (!merkleValid) {
        allValid = false;
        details.push('Merkle: inclusion proof verification failed');
      } else {
        details.push('Merkle: valid');
      }
    } else {
      // Merkle proof is optional; null means not applicable
      details.push('Merkle: not present (optional)');
    }
  } catch (err) {
    checks.merkle = { valid: false, root: cert.proofs.merkle?.root || '' };
    allValid = false;
    details.push(`Merkle: verification error — ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // ---- Input commitment check ----
  // The input commitment is a hash over analysis inputs; we can verify it
  // is present and non-empty but cannot recompute it without the original inputs.
  if (cert.input_commitments?.combined_commitment) {
    checks.input_commitment.valid = true;
    details.push('Input commitment: present');
  } else {
    checks.input_commitment.valid = false;
    allValid = false;
    details.push('Input commitment: missing');
  }

  // ---- Check 5: Verdict derivation proof ----
  try {
    const verdictProof = cert.proofs.verdict_derivation;
    if (verdictProof && typeof verdictProof === 'object' && 'method' in verdictProof) {
      const vp = verdictProof as { method: string; image_id: string; receipt: string; journal: string; verified_at: string };
      // Delegate STARK verification to prover service
      const proverUrl = (env as unknown as Record<string, string>).PROVER_URL;
      if (proverUrl) {
        const proverKey = (env as unknown as Record<string, string>).PROVER_API_KEY;
        const verifyResp = await fetch(`${proverUrl}/prove/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(proverKey ? { 'X-Prover-Key': proverKey } : {}),
          },
          body: JSON.stringify({ receipt: vp.receipt, image_id: vp.image_id }),
        });

        if (verifyResp.ok) {
          const verifyResult = (await verifyResp.json()) as { valid: boolean };
          checks.verdict_derivation = { valid: verifyResult.valid, method: vp.method };
          if (!verifyResult.valid) {
            allValid = false;
            details.push('Verdict derivation: STARK proof verification failed');
          } else {
            details.push('Verdict derivation: valid');
          }
        } else {
          checks.verdict_derivation = { valid: false, method: vp.method };
          allValid = false;
          details.push('Verdict derivation: prover service unavailable');
        }
      } else {
        // No prover configured — structural check only
        checks.verdict_derivation = { valid: true, method: vp.method };
        details.push('Verdict derivation: present (structural check only — prover not configured)');
      }
    } else {
      // Verdict derivation proof is optional; null means not yet proven
      details.push('Verdict derivation: not present (optional)');
    }
  } catch (err) {
    checks.verdict_derivation = { valid: false, method: 'unknown' };
    allValid = false;
    details.push(`Verdict derivation: verification error — ${err instanceof Error ? err.message : 'unknown'}`);
  }

  const response: VerifyCertificateResponse = {
    valid: allValid,
    checks,
    details: details.join('; '),
  };

  return jsonResponse(response);
}

// ============================================
// GET /v1/agents/:id/merkle-root
// ============================================

/**
 * Get the current Merkle tree root for an agent. Public endpoint.
 */
export async function handleGetMerkleRoot(
  env: BillingEnv,
  agentId: string,
): Promise<Response> {
  const { data, error } = await supabaseGet(
    env,
    `agent_merkle_trees?agent_id=eq.${encodeURIComponent(agentId)}&select=agent_id,merkle_root,tree_depth,leaf_count,last_updated`,
  );

  if (error) {
    return errorResponse('Failed to retrieve Merkle tree', 503);
  }

  const trees = data as MerkleRootResponse[];
  if (!trees || trees.length === 0) {
    return errorResponse('No Merkle tree found for this agent', 404);
  }

  return jsonResponse(trees[0]);
}

// ============================================
// GET /v1/checkpoints/:id/inclusion-proof
// ============================================

/**
 * Generate and return a Merkle inclusion proof for a checkpoint. Public endpoint.
 */
export async function handleGetInclusionProof(
  env: BillingEnv,
  checkpointId: string,
): Promise<Response> {
  // Fetch the checkpoint to get merkle_leaf_index and agent_id
  const { data: cpData, error: cpError } = await supabaseGet(
    env,
    `integrity_checkpoints?checkpoint_id=eq.${encodeURIComponent(checkpointId)}&select=checkpoint_id,agent_id,merkle_leaf_index,verdict,thinking_block_hash,chain_hash,timestamp`,
  );

  if (cpError) {
    return errorResponse('Failed to retrieve checkpoint', 503);
  }

  const checkpoints = cpData as Record<string, unknown>[];
  if (!checkpoints || checkpoints.length === 0) {
    return errorResponse('Checkpoint not found', 404);
  }

  const cp = checkpoints[0];

  if (cp.merkle_leaf_index == null) {
    return errorResponse('No Merkle proof available for this checkpoint', 404);
  }

  const agentId = cp.agent_id as string;
  const leafIndex = cp.merkle_leaf_index as number;

  // Fetch the agent's Merkle tree including leaf hashes
  const { data: treeData, error: treeError } = await supabaseGet(
    env,
    `agent_merkle_trees?agent_id=eq.${encodeURIComponent(agentId)}&select=merkle_root,tree_depth,leaf_count,leaf_hashes`,
  );

  if (treeError) {
    return errorResponse('Failed to retrieve Merkle tree', 503);
  }

  const trees = treeData as Record<string, unknown>[];
  if (!trees || trees.length === 0) {
    return errorResponse('No Merkle tree found for this agent', 404);
  }

  const tree = trees[0];
  const leafHashes = (tree.leaf_hashes as string[]) || [];

  if (leafIndex < 0 || leafIndex >= leafHashes.length) {
    return errorResponse('Merkle leaf index out of bounds', 422);
  }

  // Generate the inclusion proof
  let proof;
  try {
    proof = generateInclusionProof(leafHashes, leafIndex);
  } catch (err) {
    return errorResponse(
      `Failed to generate inclusion proof: ${err instanceof Error ? err.message : 'unknown'}`,
      500,
    );
  }

  // Verify the proof against the stored root
  const storedRoot = tree.merkle_root as string;
  const verified = verifyInclusionProof(proof, proof.leafHash, storedRoot);

  const response: InclusionProofResponse = {
    checkpoint_id: checkpointId,
    leaf_hash: proof.leafHash,
    leaf_index: proof.leafIndex,
    siblings: proof.siblings.map((s) => ({ hash: s.hash, position: s.position })),
    root: storedRoot,
    tree_size: proof.treeSize,
    verified,
  };

  return jsonResponse(response);
}

// ============================================
// POST /v1/checkpoints/:id/prove
// ============================================

/**
 * Request a zero-knowledge proof for a checkpoint's verdict derivation.
 * Requires authentication via X-Mnemom-Api-Key.
 */
export async function handleRequestProof(
  env: BillingEnv,
  checkpointId: string,
): Promise<Response> {
  // Verify checkpoint exists
  const { data: cpData, error: cpError } = await supabaseGet(
    env,
    `integrity_checkpoints?checkpoint_id=eq.${encodeURIComponent(checkpointId)}&select=checkpoint_id,verdict,thinking_block_hash,card_hash,values_hash,model`,
  );

  if (cpError) {
    return errorResponse('Failed to retrieve checkpoint', 503);
  }

  const checkpoints = cpData as Record<string, unknown>[];
  if (!checkpoints || checkpoints.length === 0) {
    return errorResponse('Checkpoint not found', 404);
  }

  const cp = checkpoints[0];

  // Check if proof already exists
  const { data: existingProof } = await supabaseGet(
    env,
    `verdict_proofs?checkpoint_id=eq.${encodeURIComponent(checkpointId)}&select=proof_id,status&limit=1`,
  );
  const existing = existingProof as Array<Record<string, unknown>>;
  if (existing && existing.length > 0) {
    return jsonResponse({
      proof_id: existing[0].proof_id,
      status: existing[0].status,
      message: 'Proof already exists for this checkpoint',
    });
  }

  // Generate proof ID and insert pending row
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let proofId = 'prf-';
  for (let i = 0; i < 8; i++) {
    proofId += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  try {
    const insertResp = await fetch(`${env.SUPABASE_URL}/rest/v1/verdict_proofs`, {
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

    if (!insertResp.ok) {
      return errorResponse('Failed to create proof request', 500);
    }
  } catch {
    return errorResponse('Failed to create proof request', 500);
  }

  // Fire request to prover service
  const proverUrl = (env as unknown as Record<string, string>).PROVER_URL;
  if (proverUrl) {
    const proverKey = (env as unknown as Record<string, string>).PROVER_API_KEY;
    fetch(`${proverUrl}/prove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(proverKey ? { 'X-Prover-Key': proverKey } : {}),
      },
      body: JSON.stringify({
        proof_id: proofId,
        checkpoint_id: checkpointId,
        analysis_json: '',
        thinking_hash: cp.thinking_block_hash || '',
        card_hash: cp.card_hash || '',
        values_hash: cp.values_hash || '',
        model: cp.model || '',
      }),
    }).catch(() => { /* fail-open */ });
  }

  return jsonResponse({
    proof_id: proofId,
    status: 'queued',
    estimated_completion_ms: 5000,
  }, 202);
}

// ============================================
// GET /v1/checkpoints/:id/proof
// ============================================

/**
 * Get the proof status/data for a checkpoint. Public endpoint.
 */
export async function handleGetProof(
  env: BillingEnv,
  checkpointId: string,
): Promise<Response> {
  const { data, error } = await supabaseGet(
    env,
    `verdict_proofs?checkpoint_id=eq.${encodeURIComponent(checkpointId)}&select=proof_id,checkpoint_id,status,proof_type,image_id,proving_duration_ms,verified,verified_at,created_at,updated_at&order=created_at.desc&limit=1`,
  );

  if (error) {
    return errorResponse('Failed to retrieve proof', 503);
  }

  const proofs = data as ProofStatusResponse[];
  if (!proofs || proofs.length === 0) {
    return errorResponse('No proof found for this checkpoint', 404);
  }

  return jsonResponse(proofs[0]);
}
