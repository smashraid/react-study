import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ws } from 'msw';
import { server } from './mocks/server';
import { useBufferedStream } from '../useBufferedStream';

const streamLink = ws.link('ws://localhost:8080');

describe('useBufferedStream (MSW Intercepted)', () => {
  let serverClient: any = null;

  beforeEach(() => {
    serverClient = null;

    server.use(
      streamLink.addEventListener('connection', ({ client }) => {
        serverClient = client;
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('connects to WebSocket and sets connection status', async () => {
    const { result } = renderHook(() => useBufferedStream('ws://localhost:8080'));

    expect(result.current.isConnected).toBe(false);

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });
  });

  it('batches 500 incoming messages into a single frame render', async () => {
    // IMPORTANT: [Early Stubbing Pattern]
    // Stub requestAnimationFrame BEFORE calling renderHook so the hook's
    // useEffect registers its frame loop directly into our mock queue.
    const rafCallbacks = new Set<FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.add(cb);
      return Math.random();
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useBufferedStream<number>('ws://localhost:8080');
    });

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    const initialRenders = renderCount;

    // Dispatch 500 messages via MSW
    act(() => {
      for (let i = 0; i < 500; i++) {
        serverClient.send(JSON.stringify(i));
      }
    });

    // IMPORTANT: [Microtask Event Flush Pattern]
    // MSW socket messages arrive asynchronously on the microtask queue.
    // Awaiting a 0ms timeout ensures onmessage handlers fill bufferRef before the frame ticks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Verify no re-renders happened prior to the animation frame
    expect(result.current.data).toEqual([]);
    expect(renderCount).toBe(initialRenders);

    // Trigger frame execution manually
    act(() => {
      const callbacks = Array.from(rafCallbacks);
      rafCallbacks.clear();
      callbacks.forEach((cb) => cb(performance.now()));
    });

    // Exactly 1 re-render for all 500 items
    expect(result.current.data.length).toBe(500);
    expect(result.current.data[0]).toBe(0);
    expect(result.current.data[499]).toBe(499);
    expect(renderCount).toBe(initialRenders + 1);
  });
});