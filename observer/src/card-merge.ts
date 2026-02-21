/**
 * Card Resolution Merge Logic (Phase 3c)
 *
 * Merges org card templates with agent alignment cards to produce a "canonical card."
 * The org template provides base values that agents cannot remove; agent cards are additive.
 */

/**
 * Merge an org card template with an agent's alignment card.
 *
 * Merge rules:
 * - If no org template OR agent is exempt: return agentCard as-is
 * - Otherwise: org template fields are base, agent card fields are additive
 *   - values.declared: union of org + agent values (org values cannot be removed)
 *   - values.definitions: merge, org definitions take precedence for conflicts
 *   - autonomy_envelope.bounded_actions: union (org actions always present)
 *   - autonomy_envelope.forbidden_actions: union (org forbidden always enforced)
 *   - autonomy_envelope.escalation_triggers: concat (org triggers first, then agent)
 *   - principal: agent card wins (agent-specific)
 *   - audit_commitment: agent card wins (agent-specific)
 *   - card_id, agent_id, extensions: come from agent card
 *   - aap_version, issued_at, expires_at: agent card wins
 */
export function mergeOrgAndAgentCard(
  orgTemplate: Record<string, any> | null,
  agentCard: Record<string, any> | null,
  isExempt: boolean
): Record<string, any> | null {
  // If no agent card, nothing to merge
  if (!agentCard) {
    return agentCard;
  }

  // If no org template or agent is exempt, return agent card unchanged
  if (!orgTemplate || isExempt) {
    return agentCard;
  }

  // Deep clone agent card to avoid mutation
  const merged = JSON.parse(JSON.stringify(agentCard)) as Record<string, any>;

  // --- values.declared: union (org values always present) ---
  const orgDeclared: string[] = orgTemplate.values?.declared || [];
  const agentDeclared: string[] = agentCard.values?.declared || [];
  const declaredSet = new Set([...orgDeclared, ...agentDeclared]);
  if (!merged.values) {
    merged.values = {};
  }
  merged.values.declared = Array.from(declaredSet);

  // --- values.definitions: merge, org takes precedence for conflicts ---
  const orgDefinitions: Record<string, any> = orgTemplate.values?.definitions || {};
  const agentDefinitions: Record<string, any> = agentCard.values?.definitions || {};
  merged.values.definitions = {
    ...agentDefinitions,
    ...orgDefinitions, // org wins on conflict
  };

  // --- autonomy_envelope ---
  if (!merged.autonomy_envelope) {
    merged.autonomy_envelope = {};
  }

  // bounded_actions: union (org actions always present)
  const orgBounded: string[] = orgTemplate.autonomy_envelope?.bounded_actions || [];
  const agentBounded: string[] = agentCard.autonomy_envelope?.bounded_actions || [];
  const boundedSet = new Set([...orgBounded, ...agentBounded]);
  merged.autonomy_envelope.bounded_actions = Array.from(boundedSet);

  // forbidden_actions: union (org forbidden always enforced)
  const orgForbidden: string[] = orgTemplate.autonomy_envelope?.forbidden_actions || [];
  const agentForbidden: string[] = agentCard.autonomy_envelope?.forbidden_actions || [];
  const forbiddenSet = new Set([...orgForbidden, ...agentForbidden]);
  merged.autonomy_envelope.forbidden_actions = Array.from(forbiddenSet);

  // escalation_triggers: concat (org first, then agent)
  const orgTriggers: any[] = orgTemplate.autonomy_envelope?.escalation_triggers || [];
  const agentTriggers: any[] = agentCard.autonomy_envelope?.escalation_triggers || [];
  merged.autonomy_envelope.escalation_triggers = [...orgTriggers, ...agentTriggers];

  // --- Agent-specific fields (agent card wins) ---
  // principal, audit_commitment, card_id, agent_id, extensions,
  // aap_version, issued_at, expires_at all come from agent card
  // (already in merged via the deep clone)

  return merged;
}
