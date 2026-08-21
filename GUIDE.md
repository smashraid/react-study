Building production-grade React components that handle real-time WebSockets, async streams, and file transfers requires decoupling React's render lifecycle from browser memory and network infrastructure.

---

**Architectural Analysis Checklist (Pre-Code Phase)**

Before writing a single line of code for data-heavy components, evaluate these four core dimensions:

* **1. Memory & Resource Ownership**
* *Question:* Who owns the active connection, DOM node, or binary memory blob?
* *Rule:* Any resource created outside React's state tree (WebSocket connections, `URL.createObjectURL` references, Web Workers, IndexedDB transactions) **must** have an explicit destruction lifecycle wired directly to a cleanup function.


* **2. Render Frequency vs. Data Ingestion**
* *Question:* Does incoming data arrive faster than the monitor frame rate (60Hz / 16.6ms)?
* *Rule:* Never write high-frequency stream payloads directly into React `useState`. Buffer incoming network events off-tree in `useRef` or external stores, and batch UI syncs using `requestAnimationFrame` or `useSyncExternalStore`.


* **3. Async Stale Closures & Race Conditions**
* *Question:* What happens if a prop or route changes while a 500MB S3 upload or API call is in flight?
* *Rule:* Every async operation must support cancellation via `AbortController`. Never assume an async promise resolution is still relevant by the time it resolves.


* **4. Strict Mode & Component Idempotency**
* *Question:* Does mounting, immediate unmounting, and re-mounting create duplicate socket connections or leaked HTTP requests?
* *Rule:* Cleanup functions must be fully idempotent—calling them multiple times in rapid succession must leave the browser in a clean, predictable state.



---

**Memory Leak Prevention Matrix**

| Leak Vector | Production Risk | Architectural Fix |
| --- | --- | --- |
| **S3 / Blob Object URLs** | `URL.createObjectURL(file)` retains raw binary data in browser RAM until page refresh. | Call `URL.revokeObjectURL(url)` immediately when the preview unmounts or is replaced. |
| **In-flight Fetch Requests** | Promises resolving on unmounted components cause silent memory retention and state errors. | Pass `AbortSignal` to every `fetch` call and invoke `controller.abort()` in `useEffect` cleanup. |
| **WebSocket Listeners** | Retained handlers retain references to component closures and state setters. | Nullify `socket.onmessage`, `socket.onerror`, and call `socket.close()` on unmount. |
| **Stream Buffers** | Backgrounded browser tabs freeze `rAF`, allowing off-tree arrays to grow infinitely in RAM. | Implement strict array caps (`slice(-max)`) and listen to `document.visibilityState`. |
| **Stale Closures in Callbacks** | Event handlers capturing stale state cause out-of-sync network requests. | Synchronize callbacks using stable ref hooks rather than re-subscribing on every render. |

---

**Production Component Architecture: S3 Presigned Upload & Real-Time Progress**

This component demonstrates production memory management: it revokes binary Object URLs, aborts in-flight S3 PUT requests on unmount, manages a WebSocket for processing progress, and guards against stale closures.

```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';

interface UploadManagerProps {
  file: File;
  getPresignedUrlApi: (fileName: string, signal: AbortSignal) => Promise<{ uploadUrl: string; fileId: string }>;
  wsEndpoint: string;
  onSuccess: (fileId: string) => void;
}

export function ResilientUploadManager({
  file,
  getPresignedUrlApi,
  wsEndpoint,
  onSuccess,
}: UploadManagerProps) {
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'error'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // IMPORTANT: [Latest Ref Pattern]
  // Keeps callbacks fresh without triggering effect re-subscriptions or stale closure bugs.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  // IMPORTANT: [Binary Object URL Memory Lifecycle]
  // Manages binary RAM allocation for local file previews.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => {
      // Free binary memory in browser heap immediately on unmount or file change
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const executeUpload = useCallback(async () => {
    // IMPORTANT: [Scoped AbortController Pattern]
    // Tied to this execution cycle to cancel fetch and upload operations cleanly.
    const abortController = new AbortController();
    const { signal } = abortController;

    let socket: WebSocket | null = null;

    try {
      setStatus('uploading');

      // 1. Fetch Presigned URL (Cancelable)
      const { uploadUrl, fileId } = await getPresignedUrlApi(file.name, signal);

      // 2. Upload file directly to S3 Bucket (Cancelable)
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
        signal,
      });

      if (!uploadResponse.ok) throw new Error('S3 Direct Upload Failed');

      setStatus('processing');

      // 3. Connect to Processing Progress WebSocket
      socket = new WebSocket(`${wsEndpoint}?fileId=${fileId}`);

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'PROGRESS') {
            setProgress(data.percentage);
          } else if (data.type === 'COMPLETE') {
            setStatus('idle');
            onSuccessRef.current(fileId);
          }
        } catch {
          // Ignore invalid frames
        }
      };

      socket.onerror = () => {
        if (!signal.aborted) setStatus('error');
      };

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Silently swallow aborts triggered by user navigation or unmount
        return;
      }
      setStatus('error');
    }

    // Cleanup function for explicit cancellation
    return () => {
      abortController.abort();
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [file, getPresignedUrlApi, wsEndpoint]);

  useEffect(() => {
    const cleanupPromise = executeUpload();

    return () => {
      cleanupPromise.then((cleanup) => cleanup?.());
    };
  }, [executeUpload]);

  return (
    <div style={{ padding: '1rem', border: '1px solid #ccc' }}>
      {previewUrl && (
        <img
          src={previewUrl}
          alt="Upload preview"
          style={{ width: 100, height: 100, objectFit: 'cover' }}
        />
      )}
      <div>Status: {status}</div>
      <div>Progress: {progress}%</div>
    </div>
  );
}

```