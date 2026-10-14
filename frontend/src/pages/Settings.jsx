import { useState } from 'react';
import { HiOutlineCog, HiOutlineSave } from 'react-icons/hi';
import './Settings.css';

export default function Settings() {
  const [detectionThreshold, setDetectionThreshold] = useState(0.5);
  const [eventRetentionDays, setEventRetentionDays] = useState(30);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In future phases, this will persist to the backend
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">
            Configure detection parameters and system preferences
          </p>
        </div>
      </div>

      <div className="settings-grid stagger">
        {/* Detection Settings */}
        <div className="glass-card animate-fade-in">
          <h2 className="section-title">
            <HiOutlineCog size={20} />
            Detection Configuration
          </h2>

          <div className="settings-form">
            <div className="form-group">
              <label className="form-label" htmlFor="threshold">
                Detection Confidence Threshold
              </label>
              <div className="settings-range">
                <input
                  id="threshold"
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={detectionThreshold}
                  onChange={(e) =>
                    setDetectionThreshold(parseFloat(e.target.value))
                  }
                  className="range-input"
                />
                <span className="range-value">
                  {detectionThreshold.toFixed(2)}
                </span>
              </div>
              <span className="form-hint">
                Lower values detect more people but may include false positives.
                Higher values are more strict.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="retention">
                Event Retention (Days)
              </label>
              <input
                id="retention"
                type="number"
                className="form-input"
                min={1}
                max={365}
                value={eventRetentionDays}
                onChange={(e) =>
                  setEventRetentionDays(parseInt(e.target.value) || 30)
                }
              />
              <span className="form-hint">
                Detection events older than this will be automatically deleted.
              </span>
            </div>

            <button className="btn btn-primary" onClick={handleSave}>
              <HiOutlineSave size={16} />
              {saved ? 'Saved ✓' : 'Save Settings'}
            </button>
          </div>
        </div>

        {/* System Info */}
        <div className="glass-card animate-fade-in">
          <h2 className="section-title">
            <HiOutlineCog size={20} />
            System Information
          </h2>

          <div className="system-info">
            <div className="system-info__row">
              <span className="system-info__label">Backend</span>
              <span className="system-info__value">Node.js + Express</span>
            </div>
            <div className="system-info__row">
              <span className="system-info__label">AI Service</span>
              <span className="system-info__value">Python + FastAPI (Phase 4)</span>
            </div>
            <div className="system-info__row">
              <span className="system-info__label">Detection</span>
              <span className="system-info__value">YOLO (Phase 4)</span>
            </div>
            <div className="system-info__row">
              <span className="system-info__label">Tracking</span>
              <span className="system-info__value">ByteTrack (Phase 6)</span>
            </div>
            <div className="system-info__row">
              <span className="system-info__label">Streaming</span>
              <span className="system-info__value">WebRTC (Phase 3)</span>
            </div>
            <div className="system-info__row">
              <span className="system-info__label">Database</span>
              <span className="system-info__value">MongoDB</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
