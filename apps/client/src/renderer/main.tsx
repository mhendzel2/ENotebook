import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

// Ensure all API requests carry the HttpOnly session cookie.
// Also strip the legacy x-user-id header to avoid relying on client-supplied identity.
const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request).url;

  if (url.startsWith(API_BASE)) {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.delete('x-user-id');

    // If we have a stored session token, use it as a Bearer token.
    // This is a fallback for environments where cookies may not be sent (e.g., file://).
    if (!headers.has('authorization')) {
      try {
        const saved = localStorage.getItem('eln-user');
        if (saved) {
          const parsed = JSON.parse(saved) as { token?: string };
          if (parsed?.token) headers.set('authorization', `Bearer ${parsed.token}`);
        }
      } catch {
        // ignore
      }
    }

    return originalFetch(input, {
      ...init,
      credentials: 'include',
      headers,
    });
  }

  return originalFetch(input, init);
};

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
