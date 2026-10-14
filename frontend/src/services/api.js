const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * Make an authenticated API request.
 */
async function request(endpoint, options = {}) {
  const token = localStorage.getItem('token');

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
    ...options,
  };

  const res = await fetch(`${API_URL}${endpoint}`, config);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || 'Request failed');
  }

  return data;
}

// ── Auth ───────────────────────────────────────────────
export const authAPI = {
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (name, email, password) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  getMe: () => request('/auth/me'),
};

// ── Cameras ────────────────────────────────────────────
export const cameraAPI = {
  list: () => request('/cameras'),

  create: (name) =>
    request('/cameras', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  get: (sessionId) => request(`/cameras/${sessionId}`),

  updateStatus: (sessionId, status) =>
    request(`/cameras/${sessionId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  delete: (sessionId) =>
    request(`/cameras/${sessionId}`, { method: 'DELETE' }),

  getPublicConfig: (sessionId) => request(`/cameras/public/${sessionId}`),
  getIceServers: () => request('/cameras/public/ice-servers'),
};

// ── Dashboard ──────────────────────────────────────────
export const dashboardAPI = {
  getStats: () => request('/dashboard/stats'),
  getEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/dashboard/events${query ? `?${query}` : ''}`);
  },
};
