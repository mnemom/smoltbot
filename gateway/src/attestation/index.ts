/**
 * Attestation module barrel export.
 *
 * Re-exports all attestation primitives (signing, chain, merkle, certificate)
 * for use by the gateway worker's integrity pipeline.
 */

export {
  signCheckpoint,
  verifyCheckpointSignature,
  computeInputCommitment,
  loadSigningKeyFromHex,
  getPublicKeyFromSecret,
  uint8ToBase64,
  base64ToUint8,
  uint8ToHex,
  type InputCommitmentData,
} from './signing';

export {
  computeChainHash,
  verifyChainLink,
  verifyChainSequence,
  type ChainInput,
  type ChainCheckpoint,
  type ChainVerificationResult,
} from './chain';

export {
  computeLeafHash,
  computeNodeHash,
  computeMerkleRoot,
  generateInclusionProof,
  verifyInclusionProof,
  buildTreeState,
  type LeafData,
  type MerkleProof,
  type MerkleProofSibling,
  type MerkleTreeState,
} from './merkle';

export {
  buildCertificate,
  buildSignedPayload,
  generateCertificateId,
  type IntegrityCertificate,
  type CertificateInput,
  type SignedPayloadInput,
} from './certificate';
