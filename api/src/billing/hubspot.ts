/**
 * HubSpot CRM integration — contact sync and deal tracking.
 * Direct fetch() calls to HubSpot REST v3 API, same pattern as email.ts.
 * All functions guard on env.HUBSPOT_API_KEY — return silently if not set.
 *
 * Auth: Bearer token from a HubSpot app (created via CLI, see
 * https://developers.hubspot.com/docs/apps/developer-platform/build-apps/create-an-app).
 * Scopes needed: crm.objects.contacts.read, crm.objects.contacts.write,
 * crm.objects.deals.read, crm.objects.deals.write.
 */

import type { BillingEnv } from './types';

const HUBSPOT_BASE = 'https://api.hubapi.com';

// ============================================
// Core fetch wrapper
// ============================================

async function hubspotFetch(
  env: BillingEnv,
  path: string,
  options: RequestInit = {},
): Promise<Response | null> {
  if (!env.HUBSPOT_API_KEY) return null;

  try {
    const response = await fetch(`${HUBSPOT_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${env.HUBSPOT_API_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[hubspot] API error ${response.status} on ${path}: ${body}`);
      return null;
    }

    return response;
  } catch (err) {
    console.error(`[hubspot] Fetch failed for ${path}:`, err);
    return null;
  }
}

// ============================================
// Contact operations
// ============================================

async function findContactByEmail(
  env: BillingEnv,
  email: string,
): Promise<{ id: string } | null> {
  const response = await hubspotFetch(env, '/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: 'EQ',
          value: email,
        }],
      }],
      limit: 1,
    }),
  });

  if (!response) return null;

  const data = (await response.json()) as { total: number; results: Array<{ id: string }> };
  return data.total > 0 ? { id: data.results[0].id } : null;
}

export async function hubspotCreateOrUpdateContact(
  env: BillingEnv,
  properties: {
    email: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    jobtitle?: string;
    lifecyclestage?: string;
    mnemom_plan?: string;
    mnemom_account_id?: string;
    mnemom_signup_date?: string;
    mnemom_email_sequence?: string;
    mnemom_sequence_step?: string;
    company_size?: string;
    lead_source?: string;
  },
): Promise<{ id: string } | null> {
  if (!env.HUBSPOT_API_KEY) return null;

  try {
    const existing = await findContactByEmail(env, properties.email);

    if (existing) {
      // Update existing contact
      const response = await hubspotFetch(
        env,
        `/crm/v3/objects/contacts/${existing.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ properties }),
        },
      );
      if (response) {
        console.log(`[hubspot] Updated contact ${existing.id} for ${properties.email}`);
        return existing;
      }
      return null;
    }

    // Create new contact
    const response = await hubspotFetch(env, '/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties }),
    });

    if (!response) return null;

    const data = (await response.json()) as { id: string };
    console.log(`[hubspot] Created contact ${data.id} for ${properties.email}`);
    return { id: data.id };
  } catch (err) {
    console.error(`[hubspot] Create/update contact failed for ${properties.email}:`, err);
    return null;
  }
}

// ============================================
// Deal operations
// ============================================

export async function hubspotCreateDeal(
  env: BillingEnv,
  contactId: string,
  properties: {
    dealname: string;
    dealstage?: string;
    pipeline?: string;
    amount?: string;
  },
): Promise<{ id: string } | null> {
  if (!env.HUBSPOT_API_KEY) return null;

  try {
    const response = await hubspotFetch(env, '/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          pipeline: 'default',
          dealstage: 'appointmentscheduled', // Default pipeline first stage
          ...properties,
        },
        associations: [{
          to: { id: contactId },
          types: [{
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: 3, // Deal-to-Contact
          }],
        }],
      }),
    });

    if (!response) return null;

    const data = (await response.json()) as { id: string };
    console.log(`[hubspot] Created deal ${data.id}: ${properties.dealname}`);
    return { id: data.id };
  } catch (err) {
    console.error(`[hubspot] Create deal failed:`, err);
    return null;
  }
}

export async function hubspotUpdateDealStage(
  env: BillingEnv,
  dealId: string,
  dealstage: string,
): Promise<boolean> {
  if (!env.HUBSPOT_API_KEY) return false;

  const response = await hubspotFetch(env, `/crm/v3/objects/deals/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { dealstage } }),
  });

  if (response) {
    console.log(`[hubspot] Updated deal ${dealId} to stage ${dealstage}`);
    return true;
  }
  return false;
}
