const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

const api = {
  get: async (url: string) => {
    const res = await fetch(`${API_URL}/api${url}`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    return { data: await res.json() };
  },

  post: async (url: string, body?: any) => {
    const res = await fetch(`${API_URL}/api${url}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    return { data: await res.json() };
  },

  put: async (url: string, body?: any) => {
    const res = await fetch(`${API_URL}/api${url}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    return { data: await res.json() };
  },

  delete: async (url: string) => {
    const res = await fetch(`${API_URL}/api${url}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    return { data: await res.json() };
  },
};

export default api;
