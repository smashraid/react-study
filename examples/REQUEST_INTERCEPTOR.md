When an access token expires, a modern single-page application might have three or four API requests in flight simultaneously. Without a synchronization mechanism, all four requests will fail with a `401 Unauthorized`, and all four will simultaneously attempt to hit the `/refresh` endpoint.

This causes race conditions, invalidates token rotations (blacklisting the user), and thrashes your backend.

To solve this, we use a **Mutex Flag** (`isRefreshing`) and a **Promise Queue** (`failedQueue`) outside the Axios interceptor scope to pause concurrent requests until the first refresh finishes.

### The Implementation

```typescript
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { store } from './store'; // Example: Redux/Zustand or local storage

// 1. The Mutex and The Queue
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: any) => void;
}> = [];

// Helper to resolve or reject all paused requests
const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve(token as string);
    }
  });
  failedQueue = [];
};

export const api = axios.create({
  baseURL: 'https://api.yourdomain.com',
});

// Request Interceptor (Attaches current token)
api.interceptors.request.use((config) => {
  const token = store.getState().auth.accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 2. Response Interceptor (The Mutex Logic)
api.interceptors.response.use(
  (response) => response, // Pass through successful responses
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Guard: Only intercept 401s that haven't already been retried
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      
      // IF REFRESHING: Park this request in the queue
      if (isRefreshing) {
        return new Promise(function (resolve, reject) {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            reject: (err: any) => {
              reject(err);
            },
          });
        });
      }

      // IF NOT REFRESHING: Lock the mutex and start the refresh
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Hit your refresh endpoint. (Do NOT use the intercepted `api` instance here 
        // to avoid infinite loops. Use a fresh axios call or a dedicated client).
        const refreshResponse = await axios.post('https://api.yourdomain.com/auth/refresh', {
          refreshToken: store.getState().auth.refreshToken,
        });

        const newAccessToken = refreshResponse.data.accessToken;

        // Save the new token to your state manager/storage
        store.dispatch({ type: 'UPDATE_TOKEN', payload: newAccessToken });

        // Unpack the queue and resolve all waiting requests with the new token
        processQueue(null, newAccessToken);

        // Retry the original request that triggered the 401
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);

      } catch (refreshError) {
        // The refresh token is dead. Purge the queue and force a logout.
        processQueue(refreshError as Error, null);
        store.dispatch({ type: 'LOGOUT' });
        
        return Promise.reject(refreshError);
      } finally {
        // Always unlock the mutex, whether success or failure
        isRefreshing = false;
      }
    }

    // For all other errors, just throw them normally
    return Promise.reject(error);
  }
);

```

---

### Step-by-Step Breakdown

1. **The Lock (`isRefreshing`)**: When the first 401 occurs, this flips to `true`. Subsequent 401s evaluate this flag and hit the `if (isRefreshing)` block instead of attempting a new refresh.
2. **The Queue (`failedQueue`)**: A simple array holding the `resolve` and `reject` callbacks of unresolved Promises. This essentially "pauses" the execution of those Axios requests in memory.
3. **The `_retry` Flag**: Mutating the `originalRequest` with a `_retry` flag acts as an infinite-loop circuit breaker. If the new access token is *also* rejected with a 401, this prevents the interceptor from infinitely looping.
4. **The `finally` Block**: The mutex is always unlocked, ensuring the application doesn't permanently freeze if a network error interrupts the refresh process.

---

### Caveats & Tradeoffs

| Feature | Implication |
| --- | --- |
| **Refresh Instance Isolation** | You *must* use a separate `axios` instance (or the raw `axios` import) to make the `/refresh` call. If you use the intercepted `api` instance, and the refresh call returns a 401, it will intercept itself and cause a stack overflow. |
| **Memory Leaks** | If the `try/catch` block fails to call `processQueue` for any reason, the Promises in `failedQueue` will hang in memory forever, causing those specific UI components to spin indefinitely. |
| **Token Storage Security** | This example assumes the refresh token is accessible to JavaScript (e.g., in memory or LocalStorage). In higher-security applications, both tokens are HTTP-Only cookies. In that case, the `/refresh` payload is empty, but the mutex logic remains identical to prevent redundant cookie-refresh requests. |

Implementing a mutex lock with a request queue ensures that when multiple parallel API requests fail with a `401 Unauthorized`, only **one** refresh token request is sent to the backend, while the rest are paused and resumed once the new token is acquired.

Here is a production-grade implementation using Axios interceptors, TypeScript, and a safe queue processor.

---

### Production Axios Interceptor with Mutex Lock

```typescript
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { store } from './store'; // Your state manager (Zustand, Redux, etc.)

// 1. Mutex State and Queue Management
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: any) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token as string);
    }
  });
  failedQueue = [];
};

export const api = axios.create({
  baseURL: 'https://api.yourdomain.com',
  timeout: 10000,
});

// 2. Request Interceptor: Inject Access Token
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = store.getState().auth.accessToken;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 3. Response Interceptor: Intercept 401s & Handle Mutex
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Only handle 401 errors for requests that haven't already attempted a retry
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      
      // IF ALREADY REFRESHING: Park the request in the queue
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            reject: (err) => {
              reject(err);
            },
          });
        });
      }

      // IF FIRST TO FAIL: Lock the mutex and initialize refresh
      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // IMPORTANT: Use raw `axios`, NOT the intercepted `api` instance, 
        // to prevent infinite loops if the refresh call itself fails.
        const response = await axios.post('https://api.yourdomain.com/auth/refresh', {
          refreshToken: store.getState().auth.refreshToken,
        });

        const newAccessToken = response.data.accessToken;

        // Update local state store
        store.dispatch({ type: 'auth/setAccessToken', payload: newAccessToken });

        // Unblock all queued requests with the new token
        processQueue(null, newAccessToken);

        // Retry the original request that triggered the 401
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);

      } catch (refreshError) {
        // Refresh token is invalid/expired. Reject queue and force global logout.
        processQueue(refreshError as Error, null);
        store.dispatch({ type: 'auth/logout' });
        
        return Promise.reject(refreshError);
      } finally {
        // Always unlock the mutex whether success or failure occurs
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

```

---

### Core Architectural Safeguards

* **Infinite Loop Prevention (`_retry` flag):** Mutating the request config with `_retry = true` prevents an infinite execution loop if the newly fetched access token is immediately rejected with another 401.
* **Dedicated Axios Instance for Refresh:** Using the base `axios.post` instead of the intercepted `api` instance ensures that token rotation failures don't trigger the response interceptor recursively.
* **Guaranteed Mutex Unlock (`finally` block):** Placing `isRefreshing = false` inside a `finally` block ensures that network dropouts or unexpected exceptions never leave the application permanently locked.