import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

let socket = null;

/**
 * Returns a shared Socket.IO instance
 */
export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

/**
 * Fallback ICE servers (Google STUN)
 */
export const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Helper to fetch ICE servers from backend configuration
 */
export async function fetchIceServers() {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}/cameras/public/ice-servers`);
    if (res.ok) {
      const data = await res.json();
      if (data.iceServers && data.iceServers.length > 0) {
        return data.iceServers;
      }
    }
  } catch (err) {
    console.warn('Could not fetch custom ICE servers from API, using default STUN:', err.message);
  }
  return DEFAULT_ICE_SERVERS;
}
