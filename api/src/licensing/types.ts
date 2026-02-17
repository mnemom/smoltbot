/**
 * License Key System Types
 * Phase 7: Enterprise self-hosted billing
 */

export interface LicenseJWTPayload {
  license_id: string;
  account_id: string;
  plan_id: string;
  feature_flags: Record<string, boolean>;
  limits: Record<string, unknown>;
  max_activations: number;
  is_offline: boolean;
  iat: number;
  exp: number;
  kid: string;
}

export interface LicenseValidationRequest {
  license: string; // JWT
  instance_id: string;
  instance_metadata?: Record<string, unknown>;
}

export interface LicenseValidationResponse {
  valid: boolean;
  license_id: string;
  plan_id: string;
  feature_flags: Record<string, boolean>;
  limits: Record<string, unknown>;
  expires_at: string;
  next_check_seconds: number;
  warning?: string;
}
