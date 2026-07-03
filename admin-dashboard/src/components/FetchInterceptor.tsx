"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FetchInterceptor() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
      const resource = args[0];
      let config = args[1];
      
      // Only intercept our own API calls
      if (typeof resource === 'string' && resource.includes('/api/')) {
        if (!config) {
          config = {};
        }
        
        // Always include cookies for auth
        config.credentials = 'include';
        
        // Load token from localStorage to append as Bearer token if not already present
        let token = null;
        try {
          const storedUser = localStorage.getItem('user');
          if (storedUser) {
            token = JSON.parse(storedUser).token;
          }
        } catch {}

        const headers = new Headers(config.headers || {});
        if (token && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        config.headers = headers;

        args[1] = config;
      }

      const response = await originalFetch(...args);
      
      // Handle automatic logout on 401
      if (response.status === 401 && typeof resource === 'string' && !resource.includes('/api/users/login')) {
        localStorage.removeItem('user');
      }
      
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [router]);

  return null;
}
