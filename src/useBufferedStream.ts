import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

export interface UseBufferedStreamOptions<T> {
  maxHistory?: number;
  transform?: (data: unknown) => T;
}

export interface UseBufferedStreamReturn<T> {
  data: T[];
  isConnected: boolean;
}

// IMPORTANT: [Immutable Snapshot State Pattern]
// Bundling data and connection status into a single state container ensures
// useSyncExternalStore handles UI updates reactively without reading refs during render.
interface StreamSnapshot<T> {
  data: T[];
  isConnected: boolean;
}

const DEFAULT_SERVER_SNAPSHOT: StreamSnapshot<never> = {
  data: [],
  isConnected: false,
};

export function useBufferedStream<T = unknown>(
  url: string | null,
  options: UseBufferedStreamOptions<T> = {}
): UseBufferedStreamReturn<T> {
  const { maxHistory = 1000, transform } = options;

  // IMPORTANT: [Off-Tree Buffer Pattern]
  // In-memory queue that collects rapid WebSocket messages without triggering React render cycles.
  const bufferRef = useRef<T[]>([]);
  const listenersRef = useRef<Set<() => void>>(new Set());
  const rafIdRef = useRef<number | null>(null);

  // Store state container held in a ref, read exclusively by getSnapshot
  const snapshotRef = useRef<StreamSnapshot<T>>({
    data: [],
    isConnected: false,
  });

  const transformRef = useRef(transform);
  const maxHistoryRef = useRef(maxHistory);

  // IMPORTANT: [Effects Ref Sync Pattern]
  // Synchronizing props/options to refs inside useEffect avoids mutating refs during the render phase.
  useEffect(() => {
    transformRef.current = transform;
    maxHistoryRef.current = maxHistory;
  }, [transform, maxHistory]);

  const notifySubscribers = useCallback(() => {
    listenersRef.current.forEach((listener) => listener());
  }, []);

  // IMPORTANT: [Named Function Scope Pattern]
  // Using a named function expression (`function tick()`) allows recursive frame scheduling
  // without capturing an uninitialized variable in useCallback.
  const flush = useCallback(function tick() {
    if (bufferRef.current.length > 0) {
      const incoming = bufferRef.current;
      bufferRef.current = [];

      let nextData = [...snapshotRef.current.data, ...incoming];
      const max = maxHistoryRef.current;

      if (nextData.length > max) {
        nextData = nextData.slice(nextData.length - max);
      }

      // Update the snapshot reference cleanly
      snapshotRef.current = {
        ...snapshotRef.current,
        data: nextData,
      };

      notifySubscribers();
    }

    rafIdRef.current = requestAnimationFrame(tick);
  }, [notifySubscribers]);

  useEffect(() => {
    if (!url) return;
    let socket: WebSocket | null = null;

    const setConnected = (isConnected: boolean) => {
      if (snapshotRef.current.isConnected !== isConnected) {
        snapshotRef.current = {
          ...snapshotRef.current,
          isConnected,
        };
        notifySubscribers();
      }
    };

    try {
      socket = new WebSocket(url);

      socket.onopen = () => setConnected(true);
      socket.onclose = () => setConnected(false);
      socket.onerror = () => setConnected(false);

      socket.onmessage = (event: MessageEvent) => {
        let payload: unknown = event.data;
        if (typeof event.data === 'string') {
          try {
            payload = JSON.parse(event.data);
          } catch {
            // Retain raw payload if not JSON
          }
        }
        const item = transformRef.current ? transformRef.current(payload) : (payload as T);
        bufferRef.current.push(item);
      };
    } catch (err) {
      console.error('WebSocket connection failed:', err);
      setConnected(false);
    }

    rafIdRef.current = requestAnimationFrame(flush);

    return () => {
      if (socket) {
        socket.close();
      }
      setConnected(false);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [url, flush, notifySubscribers]);

  const subscribe = useCallback((callback: () => void) => {
    listenersRef.current.add(callback);
    return () => {
      listenersRef.current.delete(callback);
    };
  }, []);

  // IMPORTANT: [Concurrent-Safe Snapshot Retrieval]
  // Returns a stable object reference until data or status actually updates.
  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const getServerSnapshot = useCallback(() => DEFAULT_SERVER_SNAPSHOT as StreamSnapshot<T>, []);

  // IMPORTANT: [External Store Integration]
  // React 18/19 official hook for reading external mutable stores safely without tearing.
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    data: snapshot.data,
    isConnected: snapshot.isConnected,
  };
}