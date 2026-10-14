import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './components/DashboardLayout';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Cameras from './pages/Cameras';
import LiveMonitoring from './pages/LiveMonitoring';
import History from './pages/History';
import Settings from './pages/Settings';
import MobileCamera from './pages/MobileCamera';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/camera" element={<MobileCamera />} />
          <Route path="/camera/:sessionId" element={<MobileCamera />} />

          {/* Protected dashboard routes */}
          <Route
            element={
              <ProtectedRoute roles={['admin', 'operator']}>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/monitoring" element={<LiveMonitoring />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Redirect root to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
