import { describe, it, expect, vi } from 'vitest';
import { shouldProve } from '../analyze/proving';

describe('shouldProve', () => {
  it('should always prove boundary violations', () => {
    expect(shouldProve({ verdict: 'boundary_violation' })).toBe(true);
  });

  it('should not prove clear verdicts when random is high', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(shouldProve({ verdict: 'clear' })).toBe(false);
    vi.restoreAllMocks();
  });

  it('should prove clear verdicts when random is below threshold', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    expect(shouldProve({ verdict: 'clear' })).toBe(true);
    vi.restoreAllMocks();
  });

  it('should not prove review_needed verdicts when random is high', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    expect(shouldProve({ verdict: 'review_needed' })).toBe(false);
    vi.restoreAllMocks();
  });

  it('should prove review_needed verdicts when random is below threshold', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    expect(shouldProve({ verdict: 'review_needed' })).toBe(true);
    vi.restoreAllMocks();
  });

  it('10% stochastic sampling at boundary', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.099);
    expect(shouldProve({ verdict: 'clear' })).toBe(true);
    vi.restoreAllMocks();

    vi.spyOn(Math, 'random').mockReturnValue(0.10);
    expect(shouldProve({ verdict: 'clear' })).toBe(false);
    vi.restoreAllMocks();
  });
});
