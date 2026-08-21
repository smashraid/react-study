Building production-grade React components that handle real-time WebSockets, async streams, and file transfers requires decoupling React's render lifecycle from browser memory and network infrastructure.

---

**Architectural Analysis Checklist (Pre-Code Phase)**

Before writing a single line of code for data-heavy components, evaluate these four core dimensions:

**1. Memory & Resource Ownership**
* *Question:* Who owns the active connection, DOM node, or binary memory blob?
* *Rule:* Any resource created outside React's state tree (WebSocket connections, `URL.createObjectURL` references, Web Workers, IndexedDB transactions) **must** have an explicit destruction lifecycle wired directly to a cleanup function.


**2. Render Frequency vs. Data Ingestion**
* *Question:* Does incoming data arrive faster than the monitor frame rate (60Hz / 16.6ms)?
* *Rule:* Never write high-frequency stream payloads directly into React `useState`. Buffer incoming network events off-tree in `useRef` or external stores, and batch UI syncs using `requestAnimationFrame` or `useSyncExternalStore`.


**3. Async Stale Closures & Race Conditions**
* *Question:* What happens if a prop or route changes while a 500MB S3 upload or API call is in flight?
* *Rule:* Every async operation must support cancellation via `AbortController`. Never assume an async promise resolution is still relevant by the time it resolves.


**4. Strict Mode & Component Idempotency**
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

## Module 1: Foundational Patterns

### 1. Custom Hooks

Extracting stateful business logic from UI components into reusable, composable functions.

**Example: `useLocalStorage**`

```tsx
import { useState, useEffect } from 'react';

function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(storedValue));
  }, [key, storedValue]);

  return [storedValue, setStoredValue] as const;
}

```

* **Caveats:** Custom hooks run sequentially on *every* render of the component that consumes them. If your hook contains heavy synchronous calculations without `useMemo`, it will bottleneck the UI thread.
* **Tradeoffs:** **Abstraction vs. Indirection.** While custom hooks clean up component files, abstracting too much logic makes it harder for new developers to trace where state mutations are actually happening.

---

### 2. Lifting State Up

Moving state from child components to their closest common ancestor so that siblings can share and synchronize that data.

**Example: An Accordion**

```tsx
function Accordion() {
  // State is "lifted" to the parent
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <div>
      <Panel 
        title="Section 1" 
        isActive={activeIndex === 0} 
        onShow={() => setActiveIndex(0)} 
      />
      <Panel 
        title="Section 2" 
        isActive={activeIndex === 1} 
        onShow={() => setActiveIndex(1)} 
      />
    </div>
  );
}

```

* **Caveats:** "Prop Drilling." If you lift state too high up the component tree, you end up passing props through 5 layers of intermediate components that don't actually care about the data.
* **Tradeoffs:** **Single Source of Truth vs. Render Cascades.** You ensure sibling components are perfectly synchronized, but every time that lifted state changes, the parent and *all* its children re-render (unless memoized).

---

### 3. Colocating State

Pushing state down the tree as close as possible to the component that actually needs it. This is the direct opposite of Lifting State Up.

**Example: A Heavy Page with an Independent Form**

```tsx
// ❌ Bad: State at the top level causes the entire dashboard to re-render on every keystroke
function Dashboard() {
  const [email, setEmail] = useState('');
  return (
    <div>
      <HeavyDataGrid /> 
      <input value={email} onChange={e => setEmail(e.target.value)} />
    </div>
  );
}

// ✅ Good: State is colocated inside the NewsletterForm
function Dashboard() {
  return (
    <div>
      <HeavyDataGrid /> 
      <NewsletterForm />
    </div>
  );
}

function NewsletterForm() {
  const [email, setEmail] = useState('');
  return <input value={email} onChange={e => setEmail(e.target.value)} />;
}

```

* **Caveats:** If product requirements change and a sibling component suddenly needs access to that colocated state, you have to refactor and lift the state back up.
* **Tradeoffs:** **Performance vs. Flexibility.** Colocation dramatically improves performance by preventing unnecessary re-renders of parent components, but it locks the state into a localized scope.

---

### 4. State Machine Pattern

Using explicit, mutually exclusive states (often via a discriminated union) to model component lifecycles, eliminating "impossible" states.

**Example: Data Fetching**

```tsx
// ❌ Bad: Boolean soup (impossible state: isLoading AND error can be true)
const [isLoading, setIsLoading] = useState(false);
const [data, setData] = useState(null);
const [error, setError] = useState(null);

// ✅ Good: State Machine Pattern
type FetchState<T> = 
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

function useDataFetcher<T>(url: string) {
  const [state, setState] = useState<FetchState<T>>({ status: 'idle' });

  useEffect(() => {
    setState({ status: 'loading' });
    fetch(url)
      .then(res => res.json())
      .then(data => setState({ status: 'success', data }))
      .catch(error => setState({ status: 'error', error }));
  }, [url]);

  return state;
}

```

* **Caveats:** It introduces more boilerplate. For extremely simple components (e.g., a toggle button), defining a state machine union type is over-engineering.
* **Tradeoffs:** **Predictability vs. Verbosity.** It completely eradicates edge-case bugs caused by overlapping boolean flags, but requires writing and maintaining stricter, more verbose TypeScript interfaces.

## Module 2: Component Patterns

### 1. Single Responsibility Principle (SRP)

A component should have exactly one reason to change. If a component manages complex state, fetches data, and contains intricate UI layout rules, it violates SRP.

**Example: Splitting a Monolithic Component**

```tsx
// ❌ Bad: A massive component doing too much
function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  useEffect(() => { fetchUser(userId).then(setUser) }, [userId]);
  
  if (!user) return <Loading />;
  return (
    <div>
      <header><h1>{user.name}</h1></header>
      <form onSubmit={/* handle complex update */}>...</form>
    </div>
  );
}

// ✅ Good: Segmented by responsibility
function UserProfile({ userId }) {
  const { user, isLoading } = useUser(userId); // Data responsibility extracted
  
  if (isLoading) return <Loading />;
  return (
    <div>
      <UserHeader user={user} />
      <UserEditForm user={user} />
    </div>
  );
}

```

* **Caveats:** Applying SRP too aggressively leads to "component fragmentation"—creating dozens of single-line component files that make the codebase difficult to navigate.
* **Tradeoffs:** **Maintainability vs. File Proliferation.** It isolates bugs and makes testing trivial, but requires you to jump across multiple files to understand the holistic UI.

---

### 2. Presentational vs. Container (Smart vs. Dumb) Components

Separating data-fetching and state management (Container/Smart) from the actual DOM rendering and styling (Presentational/Dumb).

**Example: Data Fetching Separation**

```tsx
// Container (Smart): Handles only logic and data
function UserListContainer() {
  const [users, setUsers] = useState([]);
  
  useEffect(() => {
    fetch('/api/users').then(res => res.json()).then(setUsers);
  }, []);

  return <UserList users={users} />;
}

// Presentational (Dumb): Handles only UI
function UserList({ users }) {
  return (
    <ul>
      {users.map(user => <li key={user.id}>{user.name}</li>)}
    </ul>
  );
}

```

* **Caveats:** In modern React, Custom Hooks have largely replaced the need for strictly separating Container components. You can now inject logic directly into Presentational components via hooks (`const users = useUsers()`).
* **Tradeoffs:** **Testability vs. Boilerplate.** It makes Presentational components incredibly easy to test (just pass mock props) and reuse, but doubles the number of components you need to write.

---

### 3. Children Pattern (Component Composition)

Passing components as data via the `children` prop to create reusable wrapper components. This prevents prop-drilling and deep nesting.

**Example: A Reusable Card Layout**

```tsx
function Card({ children, footer }) {
  return (
    <div className="card-wrapper">
      <div className="card-body">{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}

// Usage
<Card footer={<Button>Save</Button>}>
  <h2>User Settings</h2>
  <p>Update your profile here.</p>
</Card>

```

* **Caveats:** The parent component (`Card`) cannot easily inspect or modify the props of the `children` it receives without using fragile APIs like `React.Children.map` and `React.cloneElement`.
* **Tradeoffs:** **Flexibility vs. Strictness.** It allows consumers to inject any arbitrary UI, but makes it impossible for the parent to enforce strict layout rules on what the children render.

---

### 4. Render Props (Function Children) Pattern

Passing a function that returns a React element as a prop (or as `children`), allowing a component to share its internal state dynamically with the consumer.

**Example: A Window Resize Tracker**

```tsx
function WindowSize({ children }) {
  const [size, setSize] = useState({ width: window.innerWidth });

  useEffect(() => {
    const handleResize = () => setSize({ width: window.innerWidth });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return children(size); // Execute the function passed as children
}

// Usage
<WindowSize>
  {({ width }) => (
    <div>The window is {width}px wide.</div>
  )}
</WindowSize>

```

* **Caveats:** Leads to "wrapper hell" (deeply nested JSX) when multiple Render Prop components are composed together. Custom Hooks (`useWindowSize`) solve this problem much more elegantly.
* **Tradeoffs:** **Inversion of Control vs. JSX Readability.** It grants the consumer total control over rendering, but severely clutters the JSX markup.

---

### 5. Compound Components Pattern

A group of components that share implicit state and act together to perform a single task. The consumer dictates the layout, while the components wire themselves together under the hood (usually via Context).

**Example: A Dropdown Menu**

```tsx
const DropdownContext = createContext();

function Dropdown({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <DropdownContext.Provider value={{ isOpen, setIsOpen }}>
      <div className="dropdown">{children}</div>
    </DropdownContext.Provider>
  );
}

Dropdown.Toggle = function Toggle({ children }) {
  const { setIsOpen } = useContext(DropdownContext);
  return <button onClick={() => setIsOpen(p => !p)}>{children}</button>;
};

Dropdown.Menu = function Menu({ children }) {
  const { isOpen } = useContext(DropdownContext);
  return isOpen ? <div className="menu">{children}</div> : null;
};

// Usage
<Dropdown>
  <Dropdown.Toggle>Options</Dropdown.Toggle>
  <Dropdown.Menu>
    <MenuItem>Edit</MenuItem>
  </Dropdown.Menu>
</Dropdown>

```

* **Caveats:** Implementation is complex, especially when wiring up TypeScript interfaces for the Context and attaching sub-components to the main function object.
* **Tradeoffs:** **Consumer DX vs. Maintainer Complexity.** It provides a beautiful, highly flexible API for other developers using your UI library, but requires significantly more code to build and maintain securely.

---

### 6. Higher-Order Components (HOC)

A pure function that takes a component and returns a new, enhanced component. Used for cross-cutting concerns like authentication or logging.

**Example: Route Protection**

```tsx
function withAuth(WrappedComponent) {
  return function AuthenticatedRoute(props) {
    const { isAuthenticated } = useAuth();
    
    if (!isAuthenticated) return <Redirect to="/login" />;
    return <WrappedComponent {...props} />;
  };
}

// Usage
const SecureDashboard = withAuth(Dashboard);

```

* **Caveats:** HOCs can cause "prop collisions" (if the wrapper and the inner component use the same prop name) and they swallow static methods attached to the original component. TypeScript typings for HOCs are notoriously difficult.
* **Tradeoffs:** **Reusability vs. Obscurity.** Great for wrapping dozens of routes with the exact same logic, but obscures where props are actually coming from in React DevTools.

---

### 7. Dynamic Component Loading (Code Splitting)

Using `React.lazy()` and `<Suspense>` to defer the downloading of heavy JavaScript chunks until the user actually navigates to them or requests them.

**Example: Lazy Loading a Heavy Chart Library**

```tsx
import { lazy, Suspense } from 'react';

// This chunk is not downloaded until AnalyticsDashboard mounts
const HeavyChart = lazy(() => import('./components/HeavyChart'));

function AnalyticsDashboard() {
  return (
    <Suspense fallback={<Spinner />}>
      <HeavyChart />
    </Suspense>
  );
}

```

* **Caveats:** If the user is on a slow network, the UI will halt and display the fallback spinner while the chunk downloads, leading to perceived latency upon user interaction.
* **Tradeoffs:** **Initial Load Time vs. Interaction Delay.** Drastically reduces the initial bundle size (fast Time to Interactive), but shifts that network penalty to later moments in the user journey.

---

### 8. Virtualization Pattern

Rendering only the DOM nodes currently visible in the user's viewport (plus a small overscan padding) to support lists of thousands of items without crashing the browser.

**Example: Rendering 100k Rows**

```tsx
import { FixedSizeList as List } from 'react-window';

function MassiveTable({ items }) {
  const Row = ({ index, style }) => (
    <div style={style}>
      {items[index].name}
    </div>
  );

  return (
    <List
      height={400}
      itemCount={100000}
      itemSize={35}
      width={600}
    >
      {Row}
    </List>
  );
}

```

* **Caveats:** Virtualization inherently breaks native browser features. Since off-screen rows do not exist in the DOM, native "Ctrl+F" (Find in page) cannot search them, and screen readers struggle to index the list accurately.
* **Tradeoffs:** **Absolute Performance vs. Native Web Capabilities.** Essential for massive datasets to prevent DOM freezing, but requires building custom search solutions and advanced accessibility ARIA attributes.

## Module 3: Hook Patterns

### 1. Deriving State

Calculating derived values synchronously during the render cycle rather than using `useState` and `useEffect` to synchronize redundant data.

**Example: Filtering a List**

```tsx
// ❌ Bad: Redundant state and effect synchronization
function UserList({ users }) {
  const [query, setQuery] = useState('');
  const [filteredUsers, setFilteredUsers] = useState(users);

  useEffect(() => {
    setFilteredUsers(users.filter(u => u.name.includes(query)));
  }, [query, users]);

  return <input onChange={e => setQuery(e.target.value)} />;
}

// ✅ Good: Derived State
function UserList({ users }) {
  const [query, setQuery] = useState('');
  
  // Computed synchronously during render
  const filteredUsers = users.filter(u => u.name.includes(query));

  return <input onChange={e => setQuery(e.target.value)} />;
}

```

* **Caveats:** If the derivation is mathematically intense or involves arrays of thousands of items, calculating it on every render will block the main thread. In those specific cases, wrap the derivation in `useMemo`.
* **Tradeoffs:** **Simplicity vs. Render Cost.** It drastically simplifies state management and guarantees data consistency, but slightly increases the computational cost of standard render cycles.

---

### 2. Debounce

Delaying a state update or an API call until the user has stopped triggering the event for a defined period (e.g., waiting for the user to stop typing before searching).

**Example: Debounced Search Input**

```tsx
function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delayMs);
    // Cleanup function cancels the timeout if value changes before delay completes
    return () => clearTimeout(handler);
  }, [value, delayMs]);

  return debouncedValue;
}

function SearchBar() {
  const [input, setInput] = useState('');
  const debouncedInput = useDebounce(input, 500); // Waits 500ms after last keystroke

  useEffect(() => {
    if (debouncedInput) fetchResults(debouncedInput);
  }, [debouncedInput]);
  
  return <input onChange={e => setInput(e.target.value)} />;
}

```

* **Caveats:** Debounce artificially delays the UI response. If used on local state updates that don't involve network requests, it makes the interface feel sluggish and unresponsive.
* **Tradeoffs:** **Network Efficiency vs. Perceived Latency.** It prevents hammering the server with useless API calls on every keystroke, but forces the user to wait slightly longer to see their final result.

---

### 3. Prioritize Rendering with `useDeferredValue`

Telling React to defer rendering a non-critical part of the UI (like a heavy search results list) so the critical part (like the text input field) remains instantly responsive at 60 FPS.

**Example: Deferring a Heavy List Render**

```tsx
function SearchPage() {
  const [query, setQuery] = useState('');
  // React will yield to the input first, then calculate deferredQuery in the background
  const deferredQuery = useDeferredValue(query);

  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      {/* Heavy computation relies on deferred value */}
      <HeavyDataGrid search={deferredQuery} />
    </div>
  );
}

```

* **Caveats:** The component must actually be heavy enough to warrant deferment. Using this on trivial renders adds unnecessary scheduling overhead. It does *not* prevent API calls; it only defers UI rendering.
* **Tradeoffs:** **Input Responsiveness vs. Visual Consistency.** The user gets butter-smooth typing, but the results list will momentarily display "stale" data until the deferred background render completes.

---

### 4. Interrupt Rendering with `useTransition`

Marking state updates as non-blocking, low-priority "transitions." This allows React to pause or abandon rendering that transition if a higher-priority event (like a click) occurs.

**Example: Tab Switching**

```tsx
function TabContainer() {
  const [tab, setTab] = useState('home');
  const [isPending, startTransition] = useTransition();

  function selectAnalyticsTab() {
    // Marks the state update as low-priority
    startTransition(() => {
      setTab('heavy-analytics');
    });
  }

  return (
    <div>
      <button onClick={selectAnalyticsTab}>
        {isPending ? 'Loading...' : 'Analytics'}
      </button>
      {tab === 'heavy-analytics' ? <HeavyChart /> : <Home />}
    </div>
  );
}

```

* **Caveats:** You cannot use `startTransition` to wrap asynchronous API calls or timeouts; it is strictly for wrapping synchronous state update functions (`setTab`).
* **Tradeoffs:** **UX Fluidity vs. Immediate Execution.** It keeps the app responsive during heavy screen navigations, but delays the visual execution of the state update.

---

### 5. Effect Separation Pattern

Decomposing one massive `useEffect` block into multiple smaller, focused effects, each with its own precise dependency array.

**Example: Splitting Concerns**

```tsx
// ❌ Bad: One effect handles auth, logging, and data
useEffect(() => {
  fetchData(id);
  trackPageVisit(url);
  if (!user) logout();
}, [id, url, user]); // If user changes, it re-fetches data!

// ✅ Good: Segmented by domain
useEffect(() => {
  fetchData(id);
}, [id]);

useEffect(() => {
  trackPageVisit(url);
}, [url]);

useEffect(() => {
  if (!user) logout();
}, [user]);

```

* **Caveats:** It increases vertical line count. Over-splitting can sometimes make it harder to trace the order of operations if the effects implicitly rely on each other.
* **Tradeoffs:** **Bug Prevention vs. Verbosity.** It completely eliminates the risk of an effect re-running accidentally because an unrelated dependency changed, but requires writing more code.

---

### 6. First Render Detection

Bypassing effect execution during the initial component mount phase, allowing an effect to run *only* on subsequent updates.

**Example: Skip Effect on Mount**

```tsx
function useUpdateEffect(callback: () => void, dependencies: any[]) {
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    callback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}

```

* **Caveats:** This breaks the declarative paradigm of React. Effects are meant to synchronize state regardless of the mount phase. If you heavily rely on this, your logic is likely imperative.
* **Tradeoffs:** **Imperative Control vs. React Paradigms.** It solves edge cases where you don't want an API call to fire on load, but it makes the component's behavior slightly less predictable to other React developers.

---

### 7. Custom Hook Composition

Building higher-level hooks by chaining together smaller, atomic hooks.

**Example: Combining Hooks**

```tsx
function useAuthForm() {
  // Composing atomic hooks
  const { user } = useAuthSession();
  const form = useFormValidator(initialSchema);
  const { submit, isLoading } = useNetworkRequest('/login');

  return { user, form, submit, isLoading };
}

```

* **Caveats:** If a deeply nested hook changes its return signature, it can break the entire composition chain.
* **Tradeoffs:** **High Cohesion vs. Black Box Logic.** It creates incredibly powerful, single-line features for components, but debugging requires diving down multiple layers of hook abstractions.

---

### 8. Latest Ref Pattern

Storing frequently changing props or callbacks in a `useRef` to read their *latest* value inside an effect without triggering the effect to re-run.

**Example: A Persistent Interval**

```tsx
function useInterval(callback: () => void, delay: number) {
  const savedCallback = useRef(callback);

  // Sync the latest callback on every render
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // The interval NEVER restarts, even if the callback function changes
  useEffect(() => {
    const tick = () => savedCallback.current();
    const id = setInterval(tick, delay);
    return () => clearInterval(id);
  }, [delay]);
}

```

* **Caveats:** You are explicitly escaping React's reactive data flow. If you read the ref during render (outside an effect), it will cause tearing and UI bugs.
* **Tradeoffs:** **Stability vs. Reactivity.** It solves the classic "interval resetting" problem, but you forfeit the safety net of React's dependency checking.

---

### 9. Abandon Render Pattern

Short-circuiting the render cycle early by returning `null` or an empty state before executing heavy hooks or JSX logic.

**Example: Guard Clause Rendering**

```tsx
function AdminPanel({ user }) {
  // Hook execution is allowed before the return
  const data = useAdminData(user.id);

  if (!user.isAdmin) {
    return null; // Abandon render tree entirely
  }

  return <HeavyAdminDashboard data={data} />;
}

```

* **Caveats:** You cannot place `if` statements *before* React Hooks. Hooks must always be called at the top level in the same order.
* **Tradeoffs:** **Performance vs. UX.** It prevents heavy DOM nodes from rendering unnecessarily, but returning `null` can create jarring layout shifts if not handled properly.

---

### 10. `use()` Hook with Promises (React 19+)

A new primitive to unwrap Promises directly inside a render function, shifting the loading state responsibility to the nearest `<Suspense>` boundary.

**Example: Unwrapping a Fetch Promise**

```tsx
import { use, Suspense } from 'react';

// The promise is passed from a parent or fetched externally
function UserProfile({ userPromise }) {
  const user = use(userPromise); // Pauses render until resolved
  return <h1>{user.name}</h1>;
}

function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <UserProfile userPromise={fetchUser(1)} />
    </Suspense>
  );
}

```

* **Caveats:** If you initialize the Promise inside the component itself (e.g., `use(fetchUser())`), it will trigger an infinite render loop because a new Promise reference is created on every render. Promises must be cached or passed as props.
* **Tradeoffs:** **Clean DX vs. Waterfall Requests.** It completely eliminates boilerplate `useEffect` fetching, but if nested deeply, it can cause "waterfall" network requests (components waiting for their parent to fetch before they can start fetching).

## Module 4: UI Patterns

### 1. Error Boundary Pattern

Catching JavaScript runtime errors anywhere in a child component tree, logging those errors, and displaying a fallback UI instead of the component tree that crashed.

**Example: Modern Error Boundary (via `react-error-boundary`)**

```tsx
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div role="alert" className="text-red-500">
      <h2>Something went wrong:</h2>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

function Dashboard() {
  return (
    // Wraps the fragile component tree
    <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => clearCache()}>
      <FragileWidget />
    </ErrorBoundary>
  );
}

```

* **Caveats:** Error Boundaries *do not* catch errors inside event handlers (e.g., an `onClick` function), asynchronous code (e.g., `setTimeout` or `fetch`), server-side rendering, or errors thrown in the boundary itself.
* **Tradeoffs:** **Resilience vs. Masking.** It prevents the dreaded "white screen of death," but placing a boundary too high in the DOM tree can result in replacing the entire application with an error screen for a minor localized failure.

---

### 2. Guard Clause Rendering

Using early return statements at the top of a component to handle loading states, invalid permissions, or missing data cleanly before reaching the primary UI logic.

**Example: Flatter Component Logic**

```tsx
// ❌ Bad: Nested ternaries and deep indentation
function UserSettings({ user, isLoading }) {
  return (
    <div>
      {isLoading ? (
        <Spinner />
      ) : user ? (
        user.isAdmin ? <AdminPanel /> : <BasicPanel />
      ) : (
        <Redirect to="/login" />
      )}
    </div>
  );
}

// ✅ Good: Guard Clauses
function UserSettings({ user, isLoading }) {
  // Guard 1: Data is loading
  if (isLoading) return <Spinner />;
  
  // Guard 2: Missing data
  if (!user) return <Redirect to="/login" />;

  // Guard 3: Feature flag / Role validation
  if (!user.isAdmin) return <BasicPanel />;

  // Primary execution path
  return <AdminPanel />;
}

```

* **Caveats:** Because of the Rules of Hooks, guard clauses must be placed *after* all `useState`, `useEffect`, and custom hooks. You cannot return early to skip a hook execution.
* **Tradeoffs:** **Readability vs. Component Size.** It drastically improves code readability by eliminating "pyramid of doom" indentation, but requires you to manage hooks carefully so they don't break if props are missing.

---

### 3. Skeleton & Placeholder Pattern

Displaying a structural wireframe of the component while data is fetching. This mimics the layout of the loaded content to prevent Cumulative Layout Shift (CLS).

**Example: Skeleton Loading State**

```tsx
function ProfileCard({ userId }) {
  const { data, isLoading } = useQuery(['user', userId], fetchUser);

  if (isLoading) {
    return (
      <div className="card skeleton-wrapper">
        <div className="skeleton-avatar circle"></div>
        <div className="skeleton-text title w-3/4"></div>
        <div className="skeleton-text line w-full"></div>
      </div>
    );
  }

  return (
    <div className="card">
      <img src={data.avatar} className="avatar circle" alt="Avatar" />
      <h2 className="title w-3/4">{data.name}</h2>
      <p className="line w-full">{data.bio}</p>
    </div>
  );
}

```

* **Caveats:** Skeletons must precisely match the dimensions of the final loaded content. If the skeleton is 200px tall but the loaded data is 300px tall, the UI will still jump, defeating the purpose.
* **Tradeoffs:** **Perceived Performance vs. Maintenance Burden.** Users perceive the app to be significantly faster and more stable, but developers must maintain two visual states (the skeleton and the actual component) in sync forever.

---

### 4. Empty State Pattern

Providing an explicit, actionable, and visually distinct UI when a dataset is empty, a search yields no results, or a user first signs up.

**Example: Actionable Empty State**

```tsx
function ProjectList({ projects, onProjectCreate }) {
  // ❌ Bad: Just returning null or an empty div

  // ✅ Good: Guiding the user
  if (projects.length === 0) {
    return (
      <div className="empty-state text-center p-8 border-dashed">
        <img src="/icons/folder-empty.svg" alt="No projects" />
        <h3>No projects found</h3>
        <p>Get started by creating your first project workspace.</p>
        <button onClick={onProjectCreate} className="btn-primary">
          Create Project
        </button>
      </div>
    );
  }

  return <ul>{projects.map(p => <ProjectItem key={p.id} project={p} />)}</ul>;
}

```

* **Caveats:** Often forgotten until the very end of development. A poor empty state ("No Data") is a dead-end that increases user bounce rates.
* **Tradeoffs:** **UX Polish vs. Design Overhead.** It transforms edge cases into onboarding opportunities, but requires custom copywriting, illustrations, and distinct design tokens.

---

### 5. Optimistic UI Updates

Mutating the UI instantly based on a user's action, assuming the asynchronous server request will succeed. If the server throws an error, the UI rolls back to its previous state.

**Example: Liking a Post (Conceptual)**

```tsx
function LikeButton({ post }) {
  const [isLiked, setIsLiked] = useState(post.likedByMe);

  const handleToggleLike = async () => {
    // 1. Optimistic Update: Change UI instantly
    setIsLiked(prev => !prev);

    try {
      // 2. Perform Network Request
      await api.toggleLike(post.id);
    } catch (error) {
      // 3. Rollback on Failure
      setIsLiked(prev => !prev);
      toast.error("Failed to update like status.");
    }
  };

  return (
    <button onClick={handleToggleLike}>
      {isLiked ? '❤️' : '🤍'}
    </button>
  );
}

```

* **Caveats:** Doing this manually with `useState` is brittle (especially for complex nested data). Production apps rely on caching libraries like TanStack Query (React Query) or Apollo to manage optimistic snapshots and rollbacks safely.
* **Tradeoffs:** **Perceived Zero Latency vs. State Synchronization Risk.** It makes the application feel incredibly fast even on a 3G network, but risks "lying" to the user if the server ultimately rejects the action.

---

### 6. Partial Rendering of Available Data (Stale-While-Revalidate)

Displaying cached or stale data immediately while a background request fetches the fresh data.

**Example: Background Refetching**

```tsx
// Using a library like SWR or React Query
function DashboardWidget() {
  const { data, isValidating } = useSWR('/api/metrics', fetcher, { 
    fallbackData: cachedMetrics // Load stale data instantly 
  });

  return (
    <div className="widget-card">
      <header>
        <h2>Revenue</h2>
        {/* Subtle indicator that background sync is happening */}
        {isValidating && <Spinner size="small" />} 
      </header>
      
      <div className="metric">
        {data ? `$${data.total}` : '---'}
      </div>
    </div>
  );
}

```

* **Caveats:** Users might make critical decisions based on stale data before the background refresh completes (e.g., trading stocks based on a 5-minute-old price).
* **Tradeoffs:** **Immediate Availability vs. Data Accuracy.** It completely eliminates loading screens for returning users, but the data might suddenly "snap" to a new value while the user is looking at it.

---

### 7. Variant Pattern

Condensing multiple visual and structural states into a single `variant` prop rather than exposing dozens of conflicting boolean props (`isPrimary`, `isLarge`, `isDanger`).

**Example: A Strict Component API**

```tsx
// ❌ Bad API: Conflicting booleans (<Button primary danger />)
// ✅ Good API: Variant configuration object

const buttonVariants = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'bg-gray-200 text-gray-800 hover:bg-gray-300',
  destructive: 'bg-red-600 text-white hover:bg-red-700',
};

const sizeVariants = {
  sm: 'px-2 py-1 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};

function Button({ variant = 'primary', size = 'md', children, ...props }) {
  const className = `rounded transition-colors ${buttonVariants[variant]} ${sizeVariants[size]}`;
  
  return <button className={className} {...props}>{children}</button>;
}

// Usage
<Button variant="destructive" size="lg">Delete Account</Button>

```

* **Caveats:** The configuration object mapping variants to classes can grow massive. If a consumer needs just *one* CSS property changed that isn't covered by a variant, they often have to abandon the component entirely.
* **Tradeoffs:** **Scalability vs. Flexibility.** It enforces strict design system consistency and prevents impossible UI combinations, but locks developers into predefined visual templates.
