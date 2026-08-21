import { http, HttpResponse } from 'msw';

export const handlers = [
  // Default fallback handlers for API mocks
  http.get('/api/health', () => {
    return HttpResponse.json({ status: 'ok' });
  }),
];