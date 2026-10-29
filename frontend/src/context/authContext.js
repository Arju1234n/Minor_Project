import { createContext } from 'react';

/**
 * Raw React context object.
 * Kept in a plain .js file so AuthContext.jsx only exports the
 * AuthProvider component — satisfying Vite Fast Refresh's requirement
 * that .jsx files export only React components.
 */
export const AuthContext = createContext(null);
