import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import {
  HiOutlineLockClosed,
  HiOutlineMail,
  HiOutlineEye,
  HiOutlineEyeOff,
  HiOutlineCollection,
  HiOutlinePhotograph,
  HiOutlineMoon,
} from 'react-icons/hi';
import adminBg from '../assets/admin-login-bg.png';
import './Login.css';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Background toggle: Campus Photo vs Dark Cyber theme
  const [showCampusBg, setShowCampusBg] = useState(() => {
    const saved = localStorage.getItem('login_bg_mode');
    return saved !== null ? saved === 'campus' : true;
  });

  const handleToggleBg = () => {
    setShowCampusBg((prev) => {
      const next = !prev;
      localStorage.setItem('login_bg_mode', next ? 'campus' : 'dark');
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Background Layer 1: Campus Building Photo */}
      <div className={`login-bg-frame ${showCampusBg ? 'active' : 'inactive'}`}>
        <img
          src={adminBg}
          alt="Academic Cum Admin Building"
          className="login-bg-photo"
          loading="eager"
        />
        <div className="login-bg-scrim" />
      </div>

      {/* Background Layer 2: Dark Cyber Theme with Floating Orbs */}
      <div className={`login-dark-bg ${!showCampusBg ? 'active' : 'inactive'}`}>
        <div className="orb orb--1" />
        <div className="orb orb--2" />
        <div className="orb orb--3" />
      </div>

      {/* Top Bar with Campus Chip & Background Toggle Switch */}
      <div className="login-top-bar">
        {showCampusBg ? (
          <div className="campus-chip animate-fade-in">
            <span className="campus-chip-dot" />
            <span className="campus-chip-text">Academic Cum Admin Building</span>
          </div>
        ) : (
          <div className="campus-chip dark-chip animate-fade-in">
            <span className="campus-chip-dot purple-dot" />
            <span className="campus-chip-text">Minimal Dark Cyber Theme</span>
          </div>
        )}

        <button
          type="button"
          className="login-bg-toggle-btn"
          onClick={handleToggleBg}
          title={showCampusBg ? "Switch to Minimal Dark Background" : "Switch to Campus Building Background"}
          aria-label="Toggle background mode"
        >
          {showCampusBg ? (
            <>
              <HiOutlineMoon size={16} />
              <span>Dark Theme</span>
            </>
          ) : (
            <>
              <HiOutlinePhotograph size={16} />
              <span>Campus Photo</span>
            </>
          )}
        </button>
      </div>

      <div className="login-container animate-scale-in">
        {/* Brand */}
        <div className="login-brand">
          <div className="login-portal-tag">
            <span className="portal-pulse-dot" />
            ADMINISTRATIVE PORTAL
          </div>
          <div className="login-logo">
            <HiOutlineCollection size={30} />
          </div>
          <h1 className="login-title">Smart Classroom AI</h1>
          <p className="login-subtitle">
            Vision Intelligence &amp; Spatial Classroom Analytics
          </p>
        </div>

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error animate-fade-in">
              <span>⚠</span> {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="email">
              Email Address
            </label>
            <div className="input-wrapper">
              <HiOutlineMail className="input-icon" size={18} />
              <input
                id="email"
                type="email"
                className="form-input form-input--icon"
                placeholder="admin@smartclassroom.ai"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Password
            </label>
            <div className="input-wrapper">
              <HiOutlineLockClosed className="input-icon" size={18} />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="form-input form-input--icon"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((s) => !s)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <HiOutlineEyeOff size={18} />
                ) : (
                  <HiOutlineEye size={18} />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg login-submit"
            disabled={loading}
          >
            {loading ? (
              <span className="spinner-sm" />
            ) : (
              'Sign In to Dashboard'
            )}
          </button>
        </form>

        {/* Quick Fill Credentials Card */}
        <div
          className="login-quick-creds"
          onClick={() => {
            setEmail('admin@smartclassroom.ai');
            setPassword('admin123');
            setError('');
          }}
          title="Click to auto-fill default admin credentials"
        >
          <div className="quick-creds-header">
            <span className="quick-creds-badge">Default Admin Access</span>
            <span className="quick-creds-action">Click to fill</span>
          </div>
          <div className="quick-creds-body">
            <code>admin@smartclassroom.ai</code> • <code>admin123</code>
          </div>
        </div>

        <div className="login-footer-copy">
          Smart Classroom AI System • All Rights Reserved
        </div>
      </div>
    </div>
  );
}
