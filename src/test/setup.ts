import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './mocks/server';

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Reset handlers and unmount DOM trees after each test
afterEach(() => {
  server.resetHandlers();
  cleanup();
});

// Clean up server after all tests run
afterAll(() => server.close());