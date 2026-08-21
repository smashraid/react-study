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