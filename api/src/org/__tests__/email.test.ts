/**
 * Tests for org-related email templates (pure functions, no mocking needed).
 * Follows the pattern from billing/__tests__/enterprise-contact.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { orgInviteEmail, orgRoleChangeEmail } from '../../billing/email';

// ============================================================================
// orgInviteEmail
// ============================================================================

describe('orgInviteEmail', () => {
  it('includes inviter name and org name in subject', () => {
    const result = orgInviteEmail({ inviterName: 'Alice', orgName: 'Acme Corp', acceptUrl: 'https://mnemom.ai/accept?token=abc' });
    expect(result.subject).toBe('Alice invited you to join Acme Corp on Mnemom');
  });

  it('includes accept URL in HTML body', () => {
    const result = orgInviteEmail({ inviterName: 'Alice', orgName: 'Acme Corp', acceptUrl: 'https://mnemom.ai/accept?token=abc' });
    expect(result.html).toContain('https://mnemom.ai/accept?token=abc');
  });

  it('includes accept URL in text body', () => {
    const result = orgInviteEmail({ inviterName: 'Alice', orgName: 'Acme Corp', acceptUrl: 'https://mnemom.ai/accept?token=abc' });
    expect(result.text).toContain('https://mnemom.ai/accept?token=abc');
  });

  it('mentions 7-day expiry', () => {
    const result = orgInviteEmail({ inviterName: 'Alice', orgName: 'Acme Corp', acceptUrl: 'https://example.com' });
    expect(result.text).toContain('7 days');
  });

  it('mentions 7-day expiry in HTML body', () => {
    const result = orgInviteEmail({ inviterName: 'Alice', orgName: 'Acme Corp', acceptUrl: 'https://example.com' });
    expect(result.html).toContain('7 days');
  });

  it('includes inviter name in HTML body', () => {
    const result = orgInviteEmail({ inviterName: 'Bob Smith', orgName: 'Test Org', acceptUrl: 'https://example.com' });
    expect(result.html).toContain('Bob Smith');
  });

  it('includes org name in HTML body', () => {
    const result = orgInviteEmail({ inviterName: 'Bob', orgName: 'Mega Corp', acceptUrl: 'https://example.com' });
    expect(result.html).toContain('Mega Corp');
  });

  it('includes org name in text body', () => {
    const result = orgInviteEmail({ inviterName: 'Bob', orgName: 'Mega Corp', acceptUrl: 'https://example.com' });
    expect(result.text).toContain('Mega Corp');
  });

  it('returns subject, html, and text fields', () => {
    const result = orgInviteEmail({ inviterName: 'Alice', orgName: 'Acme', acceptUrl: 'https://example.com' });
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
    expect(typeof result.subject).toBe('string');
    expect(typeof result.html).toBe('string');
    expect(typeof result.text).toBe('string');
  });
});

// ============================================================================
// orgRoleChangeEmail
// ============================================================================

describe('orgRoleChangeEmail', () => {
  it('includes org name in subject', () => {
    const result = orgRoleChangeEmail({ orgName: 'Acme Corp', oldRole: 'member', newRole: 'admin' });
    expect(result.subject).toBe('Your role in Acme Corp has been updated');
  });

  it('includes old and new role in HTML body', () => {
    const result = orgRoleChangeEmail({ orgName: 'Acme Corp', oldRole: 'member', newRole: 'admin' });
    expect(result.html).toContain('member');
    expect(result.html).toContain('admin');
  });

  it('includes old and new role in text body', () => {
    const result = orgRoleChangeEmail({ orgName: 'Acme Corp', oldRole: 'member', newRole: 'admin' });
    expect(result.text).toContain('member');
    expect(result.text).toContain('admin');
  });

  it('includes org name in HTML body', () => {
    const result = orgRoleChangeEmail({ orgName: 'Test Org', oldRole: 'viewer', newRole: 'member' });
    expect(result.html).toContain('Test Org');
  });

  it('includes org name in text body', () => {
    const result = orgRoleChangeEmail({ orgName: 'Test Org', oldRole: 'viewer', newRole: 'member' });
    expect(result.text).toContain('Test Org');
  });

  it('returns subject, html, and text fields', () => {
    const result = orgRoleChangeEmail({ orgName: 'Acme', oldRole: 'member', newRole: 'admin' });
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
    expect(typeof result.subject).toBe('string');
    expect(typeof result.html).toBe('string');
    expect(typeof result.text).toBe('string');
  });

  it('mentions the change is effective immediately', () => {
    const result = orgRoleChangeEmail({ orgName: 'Acme Corp', oldRole: 'member', newRole: 'admin' });
    expect(result.text).toContain('effective immediately');
    expect(result.html).toContain('effective immediately');
  });

  it('works for downgrade from admin to viewer', () => {
    const result = orgRoleChangeEmail({ orgName: 'My Org', oldRole: 'admin', newRole: 'viewer' });
    expect(result.subject).toBe('Your role in My Org has been updated');
    expect(result.html).toContain('admin');
    expect(result.html).toContain('viewer');
    expect(result.text).toContain('admin');
    expect(result.text).toContain('viewer');
  });
});
