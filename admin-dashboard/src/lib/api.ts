const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

const api = {
  get: async (url: string) => {
    const res = await fetch(`${API_URL}/api${url}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`API Error: ${res.statusText}`);
    }
    const data = await res.json();
    return { data };
  },
  put: async (url: string, body?: any) => {
    const res = await fetch(`${API_URL}/api${url}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`API Error: ${res.statusText}`);
    }
    const data = await res.json();
    return { data };
  },
};

export default api;
