# Notes related to React performance

## Common Production Cases

Passing unit and integration tests in a JSDOM environment is a huge milestone, but JSDOM does not simulate real browser layout engines, network constraints, or hardware limits.

To take this codebase from "tests pass" to true production reliability, pay close attention to these critical real-world edge cases:

### 1. Stream Buffering: Inactive Tab Throttling

* **The Caveat:** Modern browsers freeze or throttle `requestAnimationFrame` to 0–1 FPS whenever the browser tab goes into the background or loses focus.
* **The Risk:** Your WebSocket keeps receiving messages while `rAF` is paused. `bufferRef.current` will accumulate tens of thousands of items un-flushed, causing a sudden memory spike or a massive UI freeze when the user clicks back to the tab.
* **The Solution:** Add a `document.visibilityState` check or hard cap the maximum length of `bufferRef.current` inside `socket.onmessage`.

### 2. Virtualization: Focus Traps & Accessibility

* **The Caveat:** JSDOM does not measure layout coordinates (`scrollTop`, `clientHeight`, `offsetHeight` are all `0` unless explicitly mocked).
* **Keyboard Navigation Failure:** If a user uses the `Tab` key to move through inputs inside a virtualized list, tabbing onto a row that scrolls out of view will unmount the active DOM element, instantly dropping focus to `document.body`.
* **In-Page Search (Ctrl + F):** Off-screen rows don't exist in the DOM, making them invisible to native browser search and screen readers (VoiceOver/NVDA).
* **Dynamic Heights:** Fixed row height (`itemHeight: 40`) breaks if user text wraps on mobile screens or images load asynchronously.

### 3. Backoff Retries: The "Thundering Herd" Problem

* **The Caveat:** Pure exponential backoff (`delay *= 2`) means that if a microservice restarts, thousands of disconnected client browsers will retry their HTTP requests at the exact same millisecond boundary.
* **The Solution:** Add **Full Jitter** to your backoff algorithm (`delay = Math.random() * (initialBackoffMs * Math.pow(2, attempt))`) to smooth out server load spikes.

### 4. Form Engine: Schema Validation & Nested Paths

* **Unsubscribed Field Cleanup:** Ensure field components clean up their store references on unmount so long-lived forms don't leak memory.
* **Nested Paths:** Production schemas often require dot-notation field paths (e.g., `<Form.Field name="address.city"/>`). Ensure your `FormStore` get/set methods handle nested object resolution.

---
## React 19.2 Changes

With React 19.2 and the production-ready **React Compiler**, the paradigm of React performance has fundamentally shifted. You no longer need to litter your code with manual `useMemo`, `useCallback`, or `React.memo`.

However, because the compiler relies on **static analysis** to automatically wrap your values and functions in memoization blocks, it introduces a new class of edge cases and architectural footguns.

When building with React 19.2 and the compiler enabled, these are the primary areas you need to worry about:

---

### 1. Zero Tolerance for Violating the "Rules of React"

The compiler assumes your components and hooks are strictly **pure and idempotent**. If your code breaks standard React rules, the compiler will either silently skip optimization or—worse—produce subtle runtime bugs and stale data.

* **What to watch out for:** Performing side effects *during* render (e.g., mutating a variable declared outside the component, modifying global state on the fly, or writing to `ref.current` during the render phase).
* **The fix:** All side effects must strictly live inside `useEffect` or event handlers.

### 2. The "Silent Failure" Trap

When the compiler encounters code patterns it cannot safely parse or optimize, **it fails silently**. It will not break your build by default; it will simply "bail out" and leave that component unoptimized.

* **What to watch out for:** Complex dynamic property access (e.g., `data[dynamicField]` mapped inside heavy loops), deeply nested switch-case reducers, or complex `try/catch` control-flow blocks.
* **The fix:** You must explicitly install and configure the **`eslint-plugin-react-compiler`** lint rules. Set critical compiler lint rules to throw errors rather than warnings so you immediately know if a crucial component failed compilation.

### 3. Non-Hook API & Third-Party Library Incompatibilities

Libraries that rely on imperative patterns, mutable objects, or non-hook APIs can break because the compiler treats them like standard React data flow and aggressively auto-memoizes them.

* **What to watch out for:** Older patterns in form or state libraries (historically, things like raw `.watch()` methods in form libraries without proper hooks) can return stale data because the compiler caches the reference.
* **The fix:** Ensure your core ecosystem libraries are updated for React 19. For instance, migrate from raw imperative getters to hook equivalents (like `useWatch` instead of `.watch`). For uncopiable legacy libraries, you can escape-hatch individual files or components using the **`"use no memo";`** directive at the top of the file.

### 4. Direct Mutations and Destructuring Footguns

Because the compiler tracks dependency graphs based on reference identities, mutating data structures in place will cause the UI to desynchronize.

* **What to watch out for:** Destructuring props or state objects and then mutating them directly (e.g., `const { user } = props; user.name = 'New';`), or pushing items directly into arrays (`arr.push(newItem)`).
* **The fix:** Strict immutability is no longer just a best practice—it is mandatory. Always return brand-new object/array references using spread operators or immutable state patterns.

### 5. Over-Reliance on "Accidental" Referential Stability

In legacy React, you might have written effects that fired more often than necessary because an object reference kept changing. Conversely, you might have relied on a stable reference that broke when someone changed a parent component.

* **What to watch out for:** The compiler stabilizes references globally where it sees fit. If your `useEffect` dependencies were subtly misconfigured in the past, the compiler's aggressive auto-memoization might suddenly make them stable, changing how your effects trigger (either causing infinite loops or preventing effects from firing when expected).
* **The fix:** Clean up your dependency arrays. Every value used inside an effect must be accurately declared in its dependency array.

---

### Summary Checklist for React 19.2

1. **Enforce the Linter:** Run `eslint-plugin-react-compiler` in strict mode to catch components the compiler rejects.
2. **Scrap Manual Memoization:** You can safely delete redundant `useMemo` and `useCallback` clutter, but keep them if you need explicit fine-tuned control over an edge case.
3. **Embrace `"use no memo"`:** If a legacy third-party library component breaks under the compiler, drop the `"use no memo";` directive at the top of that specific file while you refactor.