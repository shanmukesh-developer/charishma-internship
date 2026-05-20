"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FetchInterceptor() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
      let [resource, config] = args;
      
      // Only intercept our own API calls
      if (typeof resource === 'string' && resource.includes('/api/')) {
        if (!config) {
          config = {};
        }
        
        // Always include cookies for auth
        config.credentials = 'include';
        
        // Filter out Authorization Bearer header if it was manually attached 
        // to prevent interference with HttpOnly cookies
        if (config.headers) {
          const headers = new Headers(config.headers);
          headers.delete('Authorization');
          
          // Convert Headers back to plain object if needed, 
          // or just pass the Headers object directly
          config.headers = headers;
        }

        args[1] = config;
      }

      const response = await originalFetch(...args);
      
      // Handle automatic logout on 401
      if (response.status === 401 && typeof resource === 'string' && !resource.includes('/api/users/login')) {
        localStorage.removeItem('user');
        // We do not redirect aggressively to allow the user to read the message, 
        // but we clear local state so they know they are logged out.
      }
      
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [router]);

  return null;
}
