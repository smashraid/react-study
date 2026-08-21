import { useState, useEffect, useRef } from 'react';

export interface ChunkState<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
}

export interface UseAsyncChunkOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
}

// IMPORTANT: [AbortController & Race Prevention Pattern]
// Cancels inflight HTTP requests on input change or component unmount,
// preventing memory leaks, state updates on unmounted components, and out-of-order responses.
export function useAsyncChunk<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: UseAsyncChunkOptions = {}
): ChunkState<T> {
  const { maxRetries = 3, initialBackoffMs = 100 } = options;

  const [state, setState] = useState<ChunkState<T>>({
    data: null,
    isLoading: true,
    error: null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    let isMounted = true;

    async function executeFetchWithRetry() {
      let attempt = 0;
      let delay = initialBackoffMs;

      // Reset loading state for new dependency changes
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      while (attempt <= maxRetries) {
        try {
          if (signal.aborted) return;

          const data = await fetcherRef.current(signal);

          if (isMounted && !signal.aborted) {
            setState({ data, isLoading: false, error: null });
            return;
          }
        } catch (err: unknown) {
          if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
            return;
          }

          attempt++;

          if (attempt > maxRetries) {
            if (isMounted) {
              setState({
                data: null,
                isLoading: false,
                error: err instanceof Error ? err : new Error(String(err)),
              });
            }
            return;
          }

          // Exponential backoff delay
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }

    executeFetchWithRetry();

    return () => {
      isMounted = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}