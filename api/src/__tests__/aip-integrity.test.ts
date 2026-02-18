/**
 * Tests for AIP integrity score calculation logic.
 *
 * The handleGetAipIntegrity endpoint distinguishes synthetic (unanalyzed)
 * checkpoints from real analyzed ones, so the integrity ratio reflects
 * only verified results and coverage_ratio shows analysis gaps.
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// Replicate the isSynthetic classification from api/src/index.ts
// ============================================================================

interface CheckpointRow {
  checkpoint_id: string;
  verdict: string;
  timestamp: string;
  re_evaluated_at: string | null;
  analysis_metadata: {
    analysis_duration_ms?: number;
    extraction_confidence?: number;
    thinking_tokens_analyzed?: number;
  } | null;
}

function isSynthetic(c: CheckpointRow): boolean {
  if (c.checkpoint_id.startsWith('ic-synthetic-')) return true;
  const meta = c.analysis_metadata;
  if (meta && meta.analysis_duration_ms === 0 && meta.extraction_confidence === 0 && meta.thinking_tokens_analyzed === 0) return true;
  return false;
}

function computeIntegrityScore(checkpoints: CheckpointRow[]) {
  const totalChecks = checkpoints.length;
  const analyzedList = checkpoints.filter(c => !isSynthetic(c));
  const unanalyzedChecks = totalChecks - analyzedList.length;
  const analyzedChecks = analyzedList.length;

  const clearCount = analyzedList.filter(c => c.verdict === 'clear').length;
  const reviewCount = analyzedList.filter(c => c.verdict === 'review_needed' && !c.re_evaluated_at).length;
  const violationCount = analyzedList.filter(c => c.verdict === 'boundary_violation' && !c.re_evaluated_at).length;
  const integrityRatio = analyzedChecks > 0 ? Math.round((clearCount / analyzedChecks) * 1000) / 1000 : 0;
  const coverageRatio = totalChecks > 0 ? Math.round((analyzedChecks / totalChecks) * 1000) / 1000 : 0;

  return {
    total_checks: totalChecks,
    analyzed_checks: analyzedChecks,
    unanalyzed_checks: unanalyzedChecks,
    clear_count: clearCount,
    review_count: reviewCount,
    violation_count: violationCount,
    integrity_ratio: integrityRatio,
    coverage_ratio: coverageRatio,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function makeCheckpoint(overrides: Partial<CheckpointRow> = {}): CheckpointRow {
  return {
    checkpoint_id: `ic-${crypto.randomUUID()}`,
    verdict: 'clear',
    timestamp: new Date().toISOString(),
    re_evaluated_at: null,
    analysis_metadata: {
      analysis_duration_ms: 450,
      extraction_confidence: 1.0,
      thinking_tokens_analyzed: 120,
    },
    ...overrides,
  };
}

function makeSyntheticCheckpoint(overrides: Partial<CheckpointRow> = {}): CheckpointRow {
  return {
    checkpoint_id: `ic-synthetic-${Date.now()}`,
    verdict: 'clear',
    timestamp: new Date().toISOString(),
    re_evaluated_at: null,
    analysis_metadata: {
      analysis_duration_ms: 0,
      extraction_confidence: 0,
      thinking_tokens_analyzed: 0,
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('isSynthetic classification', () => {
  it('identifies checkpoints with ic-synthetic- prefix as synthetic', () => {
    const cp = makeSyntheticCheckpoint();
    expect(isSynthetic(cp)).toBe(true);
  });

  it('identifies checkpoints with zero analysis metadata as synthetic', () => {
    const cp = makeCheckpoint({
      checkpoint_id: 'ic-some-uuid', // not ic-synthetic- prefix
      analysis_metadata: {
        analysis_duration_ms: 0,
        extraction_confidence: 0,
        thinking_tokens_analyzed: 0,
      },
    });
    expect(isSynthetic(cp)).toBe(true);
  });

  it('identifies real analyzed checkpoints correctly', () => {
    const cp = makeCheckpoint();
    expect(isSynthetic(cp)).toBe(false);
  });

  it('treats null analysis_metadata as non-synthetic (legacy data)', () => {
    const cp = makeCheckpoint({ analysis_metadata: null });
    expect(isSynthetic(cp)).toBe(false);
  });

  it('treats partial zero metadata as non-synthetic', () => {
    // Only duration is 0 but confidence is non-zero (e.g. fast analysis)
    const cp = makeCheckpoint({
      analysis_metadata: {
        analysis_duration_ms: 0,
        extraction_confidence: 1.0,
        thinking_tokens_analyzed: 50,
      },
    });
    expect(isSynthetic(cp)).toBe(false);
  });
});

describe('integrity score computation', () => {
  it('returns zero ratios for empty checkpoint list', () => {
    const result = computeIntegrityScore([]);
    expect(result.total_checks).toBe(0);
    expect(result.analyzed_checks).toBe(0);
    expect(result.unanalyzed_checks).toBe(0);
    expect(result.integrity_ratio).toBe(0);
    expect(result.coverage_ratio).toBe(0);
  });

  it('computes 100% integrity and 100% coverage for all-analyzed clears', () => {
    const checkpoints = [
      makeCheckpoint({ verdict: 'clear' }),
      makeCheckpoint({ verdict: 'clear' }),
      makeCheckpoint({ verdict: 'clear' }),
    ];
    const result = computeIntegrityScore(checkpoints);
    expect(result.total_checks).toBe(3);
    expect(result.analyzed_checks).toBe(3);
    expect(result.unanalyzed_checks).toBe(0);
    expect(result.clear_count).toBe(3);
    expect(result.integrity_ratio).toBe(1);
    expect(result.coverage_ratio).toBe(1);
  });

  it('excludes synthetic clears from integrity ratio', () => {
    const checkpoints = [
      makeCheckpoint({ verdict: 'clear' }),
      makeSyntheticCheckpoint({ verdict: 'clear' }),
      makeSyntheticCheckpoint({ verdict: 'clear' }),
    ];
    const result = computeIntegrityScore(checkpoints);
    expect(result.total_checks).toBe(3);
    expect(result.analyzed_checks).toBe(1);
    expect(result.unanalyzed_checks).toBe(2);
    expect(result.clear_count).toBe(1);
    expect(result.integrity_ratio).toBe(1); // 1/1 analyzed = 100%
    expect(result.coverage_ratio).toBe(0.333); // 1/3 = 33.3%
  });

  it('returns 0% integrity and 0% coverage when all checks are synthetic', () => {
    const checkpoints = [
      makeSyntheticCheckpoint(),
      makeSyntheticCheckpoint(),
      makeSyntheticCheckpoint(),
    ];
    const result = computeIntegrityScore(checkpoints);
    expect(result.total_checks).toBe(3);
    expect(result.analyzed_checks).toBe(0);
    expect(result.unanalyzed_checks).toBe(3);
    expect(result.clear_count).toBe(0);
    expect(result.integrity_ratio).toBe(0); // No analyzed checks
    expect(result.coverage_ratio).toBe(0);
  });

  it('correctly computes mixed verdict ratios', () => {
    const checkpoints = [
      makeCheckpoint({ verdict: 'clear' }),
      makeCheckpoint({ verdict: 'clear' }),
      makeCheckpoint({ verdict: 'review_needed' }),
      makeCheckpoint({ verdict: 'boundary_violation' }),
      makeSyntheticCheckpoint({ verdict: 'clear' }),
    ];
    const result = computeIntegrityScore(checkpoints);
    expect(result.total_checks).toBe(5);
    expect(result.analyzed_checks).toBe(4);
    expect(result.unanalyzed_checks).toBe(1);
    expect(result.clear_count).toBe(2);
    expect(result.review_count).toBe(1);
    expect(result.violation_count).toBe(1);
    expect(result.integrity_ratio).toBe(0.5); // 2/4 = 50%
    expect(result.coverage_ratio).toBe(0.8); // 4/5 = 80%
  });

  it('excludes re-evaluated checkpoints from review/violation counts', () => {
    const checkpoints = [
      makeCheckpoint({ verdict: 'clear' }),
      makeCheckpoint({ verdict: 'review_needed', re_evaluated_at: '2026-01-15T00:00:00Z' }),
      makeCheckpoint({ verdict: 'boundary_violation', re_evaluated_at: '2026-01-15T00:00:00Z' }),
    ];
    const result = computeIntegrityScore(checkpoints);
    expect(result.analyzed_checks).toBe(3);
    expect(result.clear_count).toBe(1);
    expect(result.review_count).toBe(0); // re-evaluated, not active
    expect(result.violation_count).toBe(0); // re-evaluated, not active
  });
});
