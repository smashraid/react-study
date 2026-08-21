# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

---

# High-Performance React Architecture Engine

A production-grade React architecture designed for high-throughput streaming, zero-cascade re-rendering, resilient asynchronous data fetching, and large-scale dataset virtualization (100,000+ items at 60 FPS).

---

## Purpose & System Overview

Standard React patterns often fail under extreme production loads—such as WebSocket message bursts, rapid screen re-renders, high-frequency form input state updates, or massive array rendering. This repository implements an enterprise-grade execution pipeline that decouples React's render lifecycles from browser memory engines, network streams, and DOM reflow boundaries.

### Key Objectives
* **Zero-DOM Lag:** Render less than 20 DOM nodes out of 100,000+ dataset items while maintaining native browser scroll physics.
* **Zero-Cascade State Accumulation:** Allow unbounded sub-tree input state collection without re-rendering sibling form fields or parent containers.
* **Memory Safety & Cancellation:** Guarantee 100% cleanup of in-flight `fetch` requests, WebSocket connections, dynamic chunk loaders, and binary Blob Object URLs across all unmount scenarios.
* **Resilient Data Ingestion:** Protect the UI thread from high-frequency network spikes via frame-rate throttled off-tree buffering (`requestAnimationFrame`) and exponential backoff retries.

---

## Core Architecture & Phase Breakdown


```

┌─────────────────────────────────────────────────────────────────────────────┐
│                         HIGH-PERFORMANCE ARCHITECTURE                       │
└─────────────────────────────────────────────────────────────────────────────┘
│                       │                      │                       │
▼                       ▼                      ▼                       ▼
┌───────────┐           ┌───────────┐          ┌───────────┐           ┌───────────┐
│  PHASE 1  │           │  PHASE 2  │          │  PHASE 3  │           │  PHASE 4  │
│           │           │           │          │           │           │           │
│ Stream    │           │ Schema    │          │ Resilient │           │ Virtual   │
│ Buffering │           │ Form      │          │ Async     │           │ Windowing │
│ & rAF     │           │ Engine    │          │ Chunking  │           │ Engine    │
└───────────┘           └───────────┘          └───────────┘           └───────────┘

```

### Phase 1: High-Frequency Stream Buffering & UI Batching
* **Target Problem:** WebSockets and SSE streams emitting thousands of messages per second cause UI thrashing, continuous reflows, and dropped frames if tied directly to React `useState`.
* **Architecture Solution:** Streams write incoming network payloads off-tree into a mutated `useRef` buffer. A scheduled `requestAnimationFrame` (rAF) loop flushes batched slice updates into React state synchronized with the display refresh rate (~16.6ms / 60Hz).

### Phase 2: Schema Form Engine (Compound Components & Context Selectors)
* **Target Problem:** Typing into a controlled form input in deeply nested trees re-renders the parent form container and every sibling input on every keystroke.
* **Architecture Solution:** Implements an atomic store pattern with compound components (`Form`, `Form.Field`, `Form.Submit`). Fields subscribe exclusively to their own slice of state using Context Selectors, isolating updates and achieving zero re-renders across sibling components (`fieldASpy` vs. `fieldBSpy`).

### Phase 3: Resilient Dynamic Chunking & AbortController Memory Management
* **Target Problem:** In-flight dynamic code split chunks or API calls cause race conditions, stale closures, memory leaks, or unhandled promise rejections on unmount/route transitions.
* **Architecture Solution:** `useAsyncChunk` wires an `AbortController` signal to all async dynamic fetches. It handles automatic cancellation upon hook unmount or dependency shifts, coupled with exponential backoff retries for transient network drops.

### Phase 4: Virtualized Windowing Table Engine (100k+ Items)
* **Target Problem:** Mounting thousands of complex DOM elements leads to severe DOM bloat, memory exhaustion, and unscrollable web applications.
* **Architecture Solution:** `useVirtualizer` and `VirtualTable` compute visible items in $O(1)$ time complexity using container scroll offsets. A "Phantom Container" creates phantom scroll height, while rendered nodes are positioned via GPU hardware-accelerated CSS `translateY` transforms.

---

## Summary Matrix: All 4 Phases

| Phase | System Module | Core Component / Hook | Primary Target | Key Technical Paradigm |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | Stream Buffering | `useBufferedStream` | High-frequency WebSockets | Off-tree `useRef` buffering + `rAF` batching |
| **Phase 2** | Form Engine | `Form`, `Form.Field` | Complex, deep forms | Context Selectors + Uncontrolled Store Accumulation |
| **Phase 3** | Resilient Loader | `useAsyncChunk`, `ChunkLoader` | Code/Data Chunks | `AbortController` cancellation + Backoff Retries |
| **Phase 4** | Virtual Windowing | `VirtualTable`, `useVirtualizer` | 100,000+ Row Tables | $O(1)$ visible slice + GPU `translateY` positioning |

---

## Key React Patterns & Design Paradigms

### 1. Compound Component Pattern
Encapsulates shared state implicitly without exposing context consumers directly to the end-user API:
```tsx
<Form initialValues={{ firstName: 'John' }} onSubmit={handleSubmit}>
  <Form.Field label="First Name" name="firstName"/>
  <Form.Field label="Last Name" name="lastName"/>
  <Form.Submit>Save</Form.Submit>
</Form>

```

### 2. Context Selectors & Isolated Subscriptions

Prevents global state changes from triggering widespread re-renders. Component updates occur **only** when the specific selected value changes:

```tsx
const fieldValue = useFormStoreSelector(
  store, 
  useCallback((state) => state.values[name], [name])
);

```

### 3. Hardware-Accelerated Layout Promotion

Uses GPU composite layers for virtualized items to eliminate heavy browser layout reflows and repaints during high-speed scrolling:

```tsx
<div style={{ transform: `translateY(${offsetTop}px)`, position: 'absolute' }}>
  {renderRow(item)}
</div>

```

### 4. Scoped AbortController Execution Cycle

Wires explicit cancellation signals directly into network requests and promise chains:

```tsx
useEffect(() => {
  const controller = new AbortController();
  fetchData(controller.signal);
  return () => controller.abort(); // Instant unmount cleanup
}, [fetchData]);

```

### 5. Latest Ref Pattern for Stable Callbacks

Captures fresh props and state inside async closures without re-triggering `useEffect` cleanup cycles:

```tsx
const callbackRef = useRef(onSuccess);
useEffect(() => { callbackRef.current = onSuccess; }, [onSuccess]);

```

---

## Production Memory Management & Leak Mitigation Matrix

| Leak Vector | Cause | Architectural Fix |
| --- | --- | --- |
| **S3 / Blob URLs** | `URL.createObjectURL(file)` retains binary objects in heap indefinitely. | Explicit call to `URL.revokeObjectURL(url)` in `useEffect` cleanup. |
| **WebSocket Subscriptions** | Retained socket listeners hold strong references to unmounted components. | Nullify `onmessage` and `onerror` handlers, then invoke `.close()` on unmount. |
| **Un-canceled Fetches** | In-flight HTTP promises attempt to resolve state on unmounted components. | Attach `AbortSignal` to every fetch and call `.abort()` during lifecycle destruction. |
| **Stream Buffering Memory** | Suspended/background browser tabs pause `rAF`, leading to unbounded array buffers. | Enforce array length caps (`slice(-max)`) and inspect `document.visibilityState`. |
| **DOM Element Overload** | Direct mapping over thousands of array items in React JSX. | Implement virtualized windowing to constrain live DOM nodes below 20 elements. |

---

## Production Readiness & Edge Case Guidance

### 1. Thundering Herd Backoff Protection

When configuring retries, exponential backoff alone can cause synchronized client traffic spikes during server recovery. **Full Jitter** must be applied:

$$\text{Delay} = \text{random}() \times (\text{InitialBackoff} \times 2^{\text{attempt}})$$

### 2. Background Tab Throttling

Browsers limit `requestAnimationFrame` execution in inactive tabs. High-frequency message streams must cap total stored buffer length:

```ts
if (document.visibilityState === 'hidden') {
  bufferRef.current = bufferRef.current.slice(-MAX_BUFFER_LIMIT);
}

```

### 3. Virtualization Focus Traps

When using keyboard navigation (`Tab`) within a virtualized list, elements scrolling out of view will unmount, causing focus to drop to `document.body`. To support full accessibility:

* Retain focus index in state.
* Automatically scroll focus-targeted items back into view when navigated via keyboard.

---

## Testing & Quality Assurance

This repository includes full Vitest test suites covering unit assertions, JSDOM scroll simulations, isolated re-rendering checks, and async request aborts.

### Executing the Test Suites

```bash
# Run all Vitest suites in sequence
pnpm run test

# Run specific phase test suite
pnpm dlx vitest src/test/VirtualTable.test.tsx

# Execute TypeScript typechecking and linting
pnpm run typecheck && pnpm run lint

```