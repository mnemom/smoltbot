/**
 * Org module types and interfaces.
 * Defines the data model for organizations, membership, invitations, and RBAC.
 */

// ============================================
// Org roles
// ============================================

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer' | 'auditor';

// ============================================
// Core entities
// ============================================

export interface Org {
  org_id: string;
  name: string;
  slug: string;
  billing_account_id: string;
  owner_user_id: string;
  billing_email?: string;
  company_name?: string;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  invited_by?: string;
  invited_at?: string;
  accepted_at?: string;
}

export interface OrgInvitation {
  invitation_id: string;
  org_id: string;
  email: string;
  role: Exclude<OrgRole, 'owner'>;
  token_hash: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: string;
  created_at?: string;
}

// ============================================
// Composite types
// ============================================

export interface OrgWithRole extends Org {
  role: OrgRole;
  member_count: number;
}

// ============================================
// RBAC permissions
// ============================================

export type PermissionLevel = 'full' | 'edit' | 'view' | 'own' | 'none' | 'full+export';

export interface RolePermissions {
  dashboard: PermissionLevel;
  agents: PermissionLevel;
  billing: PermissionLevel;
  settings: PermissionLevel;
  compliance: PermissionLevel;
}
