"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function useAdminAuth() {
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    
    if (!token || !userData) {
      router.push('/login');
      return;
    }

    // OPTIMISTIC AUTH: Assume valid if token exists, verify in background
    const user = JSON.parse(userData);
    if (user.role === 'admin') {
      setIsAuthed(true);
    } else {
      router.push('/login');
      return;
    }

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 5000;

    const checkSession = async (attempt = 1): Promise<void> => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const res = await fetch(`${apiUrl}/api/admin/config`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.status === 401) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          router.push('/login');
          setIsAuthed(false);
          return;
        }

        if (!res.ok && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          return checkSession(attempt + 1);
        }
      } catch (err: unknown) {
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        const isNetwork = err instanceof TypeError && err.message.includes('fetch');

        if ((isAbort || isNetwork) && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          return checkSession(attempt + 1);
        }
        // Persistent network error? Stay authed (cached mode)
      }
    };

    checkSession();
  }, [router]);

  return isAuthed;
}
