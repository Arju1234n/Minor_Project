import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  HiOutlineLockClosed,
  HiOutlineMail,
  HiOutlineEye,
  HiOutlineEyeOff,
  HiOutlineCollection,
} from 'react-icons/hi';
import './Login.css';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      {/* Animated background orbs */}
      <div className="login-bg">
        <div className="orb orb--1" />
        <div className="orb orb--2" />
        <div className="orb orb--3" />
      </div>

      <div className="login-container animate-scale-in">
        {/* Brand */}
        <div className="login-brand">
          <div className="login-logo">
            <HiOutlineCollection size={32} />
          </div>
          <h1 className="login-title">Smart Classroom AI</h1>
          <p className="login-subtitle">
            Real-time human detection &amp; tracking dashboard
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
              'Sign In'
            )}
          </button>
        </form>

        <p className="login-footer-text">
          Default credentials: <strong>admin@smartclassroom.ai</strong> / <strong>admin123</strong>
        </p>
      </div>
    </div>
  );
}
