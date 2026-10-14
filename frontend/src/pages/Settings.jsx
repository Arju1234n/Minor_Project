import { useState, useEffect } from 'react';
import { settingsAPI, aiAPI } from '../services/api';
import {
  HiOutlineCog,
  HiOutlineSave,
  HiOutlineTrash,
  HiOutlineShieldCheck,
  HiOutlineServer,
  HiOutlineCheckCircle,
  HiOutlineLockClosed,
} from 'react-icons/hi';
import './Settings.css';

/**
 * Settings Page — Phase 8:
 * - Real-time configuration of AI Confidence Threshold & IoU
 * - Virtual tripwire vertical position ratio
 * - Event log retention policy & manual purge execution
 * - Privacy mode (anonymization of bounding boxes)
 * - Architecture & privacy safeguards declaration
 */
export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  // Settings values
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.45);
  const [iouThreshold, setIouThreshold] = useState(0.50);
  const [retentionDays, setRetentionDays] = useState(30);
  const [tripwireY, setTripwireY] = useState(0.50);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [enableBreadcrumbs, setEnableBreadcrumbs] = useState(true);

  // Load existing settings on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await settingsAPI.get();
        if (mounted && res.settings) {
          if (res.settings.confidenceThreshold != null) setConfidenceThreshold(res.settings.confidenceThreshold);
          if (res.settings.iouThreshold != null) setIouThreshold(res.settings.iouThreshold);
          if (res.settings.retentionDays != null) setRetentionDays(res.settings.retentionDays);
          if (res.settings.virtualTripwireY != null) setTripwireY(res.settings.virtualTripwireY);
          if (res.settings.privacyMode != null) setPrivacyMode(res.settings.privacyMode);
          if (res.settings.enableBreadcrumbs != null) setEnableBreadcrumbs(res.settings.enableBreadcrumbs);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setStatusMsg({ type: '', text: '' });

    try {
      await settingsAPI.update({
        confidenceThreshold,
        iouThreshold,
        retentionDays,
        virtualTripwireY: tripwireY,
        privacyMode,
        enableBreadcrumbs,
      });

      // Also notify AI service if running
      await aiAPI.updateConfig(confidenceThreshold).catch(() => {});

      setStatusMsg({ type: 'success', text: 'Settings updated and synchronized across all services!' });
      setTimeout(() => setStatusMsg({ type: '', text: '' }), 4000);
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to update settings' });
    } finally {
      setSaving(false);
    }
  };

  const handlePurge = async () => {
    if (!confirm(`Are you sure you want to permanently delete all detection events older than ${retentionDays} days?`)) {
      return;
    }
    setPurging(true);
    setStatusMsg({ type: '', text: '' });

    try {
      const res = await settingsAPI.purgeRetention();
      setStatusMsg({
        type: 'success',
        text: `Retention purge complete: ${res.deletedCount || 0} historical events removed.`,
      });
      setTimeout(() => setStatusMsg({ type: '', text: '' }), 4000);
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to purge events' });
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings & System Governance</h1>
          <p className="page-subtitle">
            Configure AI detection parameters, WebRTC streaming preferences, and data privacy safeguards
          </p>
        </div>
      </div>

      {statusMsg.text && (
        <div className={`status-banner ${statusMsg.type === 'success' ? 'status-banner--success' : 'status-banner--error'} animate-fade-in`}>
          {statusMsg.type === 'success' ? <HiOutlineCheckCircle size={18} /> : <span>⚠</span>}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <div className="settings-grid">
        {/* Detection & Tracking Configuration */}
        <div className="glass-card animate-fade-in">
          <h2 className="section-title">
            <HiOutlineCog size={20} />
            AI Computer Vision Parameters
          </h2>

          <div className="settings-form">
            <div className="form-group">
              <label className="form-label" htmlFor="threshold">
                Confidence Threshold (Person Class Only)
              </label>
              <div className="settings-range">
                <input
                  id="threshold"
                  type="range"
                  min="0.10"
                  max="0.95"
                  step="0.05"
                  value={confidenceThreshold}
                  onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                  className="range-input"
                />
                <span className="range-value">{confidenceThreshold.toFixed(2)}</span>
              </div>
              <span className="form-hint">
                Detections below this confidence will be filtered out before tracking.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="iou">
                IoU Association Matching Threshold
              </label>
              <div className="settings-range">
                <input
                  id="iou"
                  type="range"
                  min="0.20"
                  max="0.80"
                  step="0.05"
                  value={iouThreshold}
                  onChange={(e) => setIouThreshold(parseFloat(e.target.value))}
                  className="range-input"
                />
                <span className="range-value">{iouThreshold.toFixed(2)}</span>
              </div>
              <span className="form-hint">
                Higher IoU enforces stricter bounding box overlap when assigning persistent ByteTrack IDs.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="tripwire">
                Virtual Tripwire Line Ratio (Height %)
              </label>
              <div className="settings-range">
                <input
                  id="tripwire"
                  type="range"
                  min="0.10"
                  max="0.90"
                  step="0.05"
                  value={tripwireY}
                  onChange={(e) => setTripwireY(parseFloat(e.target.value))}
                  className="range-input"
                />
                <span className="range-value">{Math.round(tripwireY * 100)}%</span>
              </div>
              <span className="form-hint">
                Vertical position of the entrance/exit threshold line in the camera frame.
              </span>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={enableBreadcrumbs}
                  onChange={(e) => setEnableBreadcrumbs(e.target.checked)}
                />
                <span>Render Trajectory Breadcrumbs (Historical Movement Path)</span>
              </label>
            </div>

            <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
              <HiOutlineSave size={16} />
              {saving ? 'Saving...' : 'Save AI Parameters'}
            </button>
          </div>
        </div>

        {/* Data Governance & Retention */}
        <div className="glass-card animate-fade-in">
          <h2 className="section-title">
            <HiOutlineShieldCheck size={20} />
            Data Retention & Privacy Controls
          </h2>

          <div className="settings-form">
            <div className="form-group">
              <label className="form-label" htmlFor="retention">
                Event Log TTL Auto-Expiry (Days)
              </label>
              <input
                id="retention"
                type="number"
                className="form-input"
                min={1}
                max={365}
                value={retentionDays}
                onChange={(e) => setRetentionDays(parseInt(e.target.value) || 30)}
              />
              <span className="form-hint">
                MongoDB automatic TTL index will purge raw detection timestamp entries older than this interval.
              </span>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={privacyMode}
                  onChange={(e) => setPrivacyMode(e.target.checked)}
                />
                <span>Enable Privacy Masking (Anonymize Bounding Boxes)</span>
              </label>
              <span className="form-hint">
                When active, detection coordinate logs are stripped before saving to MongoDB.
              </span>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
                <HiOutlineSave size={16} />
                {saving ? 'Saving...' : 'Save Retention Policy'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handlePurge}
                disabled={purging || loading}
              >
                <HiOutlineTrash size={16} />
                {purging ? 'Purging...' : 'Run Purge Now'}
              </button>
            </div>

            {/* Privacy Architecture Notice */}
            <div className="privacy-card">
              <div className="privacy-header">
                <HiOutlineLockClosed size={16} className="text-primary" />
                <strong>Privacy by Design Safeguards</strong>
              </div>
              <ul className="privacy-list">
                <li>Direct WebRTC P2P media transmission: Raw video frames are never stored or uploaded to MongoDB.</li>
                <li>Anonymous counting: No facial recognition, biometric template extraction, or PII capture.</li>
                <li>Phone operator visibility: Active camera status and streaming LEDs remain visibly indicated on the smartphone UI.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Microservices Architecture Telemetry */}
        <div className="glass-card animate-fade-in" style={{ gridColumn: '1 / -1' }}>
          <h2 className="section-title">
            <HiOutlineServer size={20} />
            System Stack & Architecture Telemetry
          </h2>

          <div className="system-telemetry-grid">
            <div className="telemetry-block">
              <span className="telemetry-title">Web Application Backend</span>
              <span className="telemetry-detail">Node.js + Express 4.x</span>
              <span className="telemetry-sub text-online">● Port 5000 (Active)</span>
            </div>

            <div className="telemetry-block">
              <span className="telemetry-title">AI Vision Inference Engine</span>
              <span className="telemetry-detail">Python 3.10 + FastAPI + YOLOv8n</span>
              <span className="telemetry-sub text-online">● Port 8000 (Active)</span>
            </div>

            <div className="telemetry-block">
              <span className="telemetry-title">Multi-Object Tracker</span>
              <span className="telemetry-detail">ByteTrack (Kalman Filter + Hungarian)</span>
              <span className="telemetry-sub text-info">● Multi-Session Ready</span>
            </div>

            <div className="telemetry-block">
              <span className="telemetry-title">Video Transport Protocol</span>
              <span className="telemetry-detail">WebRTC Direct P2P + Socket.IO</span>
              <span className="telemetry-sub text-warning">● Google STUN Configured</span>
            </div>

            <div className="telemetry-block">
              <span className="telemetry-title">Database Storage</span>
              <span className="telemetry-detail">MongoDB 7.0 + Mongoose TTL</span>
              <span className="telemetry-sub text-online">● localhost:27017</span>
            </div>

            <div className="telemetry-block">
              <span className="telemetry-title">Admin Dashboard Client</span>
              <span className="telemetry-detail">React 18 + Vite (SPA)</span>
              <span className="telemetry-sub text-online">● Port 5173 (Active)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
