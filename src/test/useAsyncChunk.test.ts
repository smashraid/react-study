import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useAsyncChunk } from '../useAsyncChunk';

describe('Phase 3: Resilient Dynamic Chunk Loader', () => {
  it('fetches chunk data successfully on mount', async () => {
    const fetcher = vi.fn().mockResolvedValue({ moduleName: 'AnalyticsChunk' });

    const { result } = renderHook(() => useAsyncChunk(fetcher, []));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual({ moduleName: 'AnalyticsChunk' });
    expect(result.current.error).toBeNull();
  });

  it('aborts inflight request when dependencies change (race condition safety)', async () => {
    const abortedSignals: boolean[] = [];

    const fetcher = vi.fn().mockImplementation((signal: AbortSignal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({ id: 'done' });
        }, 100);

        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          abortedSignals.push(signal.aborted);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const { rerender } = renderHook(({ chunkId }) => useAsyncChunk(fetcher, [chunkId]), {
      initialProps: { chunkId: 'chunk-1' },
    });

    // Rapidly change dependencies before first request resolves
    rerender({ chunkId: 'chunk-2' });

    // Verify first request was aborted immediately
    expect(abortedSignals).toHaveLength(1);
    expect(abortedSignals[0]).toBe(true);
  });

  it('retries with backoff on transient failure and resolves', async () => {
    let attempts = 0;

    const fetcher = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Network Flake');
      }
      return { success: true };
    });

    const { result } = renderHook(() =>
      useAsyncChunk(fetcher, [], { maxRetries: 3, initialBackoffMs: 10 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(attempts).toBe(3);
    expect(result.current.data).toEqual({ success: true });
    expect(result.current.error).toBeNull();
  });

  it('returns error state after exceeding maximum retries', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Persistent 500 Error'));

    const { result } = renderHook(() =>
      useAsyncChunk(fetcher, [], { maxRetries: 2, initialBackoffMs: 10 })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetcher).toHaveBeenCalledTimes(3); // Initial + 2 retries
    expect(result.current.data).toBeNull();
    expect(result.current.error?.message).toBe('Persistent 500 Error');
  });
});