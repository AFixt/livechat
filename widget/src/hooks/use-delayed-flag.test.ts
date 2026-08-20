import { act, renderHook } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDelayedFlag } from './use-delayed-flag.js';

describe('useDelayedFlag', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays false until the source has been true for the full delay (§5.1.2 short period)', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDelayedFlag(true, 5000));

    // The invitation must NOT appear the instant support comes online.
    expect(result.current).toBe(false);
    await act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(result.current).toBe(false);

    // Once the short period elapses it opens.
    await act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it('turns off immediately when the source goes false and cancels a pending delay', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 5000), {
      initialProps: { active: true },
    });

    await act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(true);

    // Source drops → gate closes at once, no lingering timer re-opens it.
    rerender({ active: false });
    expect(result.current).toBe(false);
    await act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(false);
  });

  it('does not open if the source flips false before the delay elapses', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 5000), {
      initialProps: { active: true },
    });

    await act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender({ active: false });
    await act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });
});
