/**
 * Self-Hosted Deployment Management Types
 * Phase 10: Deployment tracking, heartbeat, and fleet management.
 */

export interface SelfHostedDeployment {
  deployment_id: string;
  org_id: string;
  license_id: string;
  instance_name: string;
  instance_id: string;
  region: string | null;
  status: 'active' | 'inactive' | 'degraded';
  version: string | null;
  last_heartbeat_at: string | null;
  heartbeat_data: Record<string, unknown>;
  instance_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface HeartbeatRequest {
  deployment_id: string;
  instance_id: string;
  version?: string;
  heartbeat_data?: Record<string, unknown>;
}

export interface RegisterDeploymentRequest {
  instance_name: string;
  instance_id: string;
  license_id: string;
  region?: string;
  version?: string;
  instance_metadata?: Record<string, unknown>;
}
