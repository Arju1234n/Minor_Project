import { useEffect, useState, useCallback } from 'react';
import { cameraAPI } from '../services/api';
import {
  HiOutlineVideoCamera,
  HiOutlineDeviceMobile,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineRefresh,
  HiOutlineExternalLink,
  HiOutlineClipboardCopy,
  HiOutlinePlay,
  HiOutlineStop,
  HiOutlineCheckCircle,
  HiOutlineExclamationCircle,
} from 'react-icons/hi';
import './Cameras.css';

export default function Cameras() {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('phone'); // 'phone' | 'cctv'
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [copiedId, setCopiedId] = useState('');

  // Smartphone Form State
  const [phoneName, setPhoneName] = useState('');
  const [creatingPhone, setCreatingPhone] = useState(false);

  // CCTV Form State
  const [cctvName, setCctvName] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [cctvUsername, setCctvUsername] = useState('');
  const [cctvPassword, setCctvPassword] = useState('');
  const [targetFps, setTargetFps] = useState(15);
  const [creatingCctv, setCreatingCctv] = useState(false);
  const [testingStream, setTestingStream] = useState(false);
  const [testResult, setTestResult] = useState(null); // { reachable: bool, message: str }

  // Action busy states: sessionId -> bool
  const [actionBusy, setActionBusy] = useState({});

  const fetchCameras = useCallback(async () => {
    try {
      setError('');
      const res = await cameraAPI.list();
      setCameras(res.sessions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  // Create Smartphone Session
  const handleCreatePhone = async (e) => {
    e.preventDefault();
    if (!phoneName.trim()) return;
    setCreatingPhone(true);
    setError('');
    setSuccessMsg('');
    try {
      await cameraAPI.create({
        name: phoneName.trim(),
        type: 'phone',
      });
      setPhoneName('');
      setSuccessMsg('Smartphone camera unit added successfully!');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchCameras();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingPhone(false);
    }
  };

  // Test CCTV Stream Reachability
  const handleTestConnection = async () => {
    if (!rtspUrl.trim()) {
      setError('Please enter a stream URL to test');
      return;
    }
    setTestingStream(true);
    setError('');
    setTestResult(null);
    try {
      const res = await cameraAPI.testStream(rtspUrl.trim(), cctvUsername.trim(), cctvPassword.trim());
      setTestResult({
        reachable: res.reachable,
        message: res.reachable
          ? `Connected successfully! (${res.width}x${res.height} @ ${res.latency_ms}ms)`
          : res.error || res.message || 'Stream connection failed',
      });
    } catch (err) {
      setTestResult({
        reachable: false,
        message: err.message || 'Failed to probe stream',
      });
    } finally {
      setTestingStream(false);
    }
  };

  // Create CCTV Camera Session
  const handleCreateCctv = async (e) => {
    e.preventDefault();
    if (!cctvName.trim() || !rtspUrl.trim()) return;
    setCreatingCctv(true);
    setError('');
    setSuccessMsg('');
    try {
      await cameraAPI.create({
        name: cctvName.trim(),
        type: 'cctv',
        rtspUrl: rtspUrl.trim(),
        username: cctvUsername.trim(),
        password: cctvPassword.trim(),
        fps: targetFps,
      });
      setCctvName('');
      setRtspUrl('');
      setCctvUsername('');
      setCctvPassword('');
      setTestResult(null);
      setSuccessMsg('CCTV camera configured successfully!');
      setTimeout(() => setSuccessMsg(''), 4000);
      await fetchCameras();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingCctv(false);
    }
  };

  // Start CCTV Ingestion
  const handleStartCctv = async (sessionId) => {
    setActionBusy((prev) => ({ ...prev, [sessionId]: true }));
    setError('');
    try {
      await cameraAPI.startCctv(sessionId);
      await fetchCameras();
    } catch (err) {
      setError(`Failed to start CCTV stream: ${err.message}`);
    } finally {
      setActionBusy((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  // Stop CCTV Ingestion
  const handleStopCctv = async (sessionId) => {
    setActionBusy((prev) => ({ ...prev, [sessionId]: true }));
    setError('');
    try {
      await cameraAPI.stopCctv(sessionId);
      await fetchCameras();
    } catch (err) {
      setError(`Failed to stop CCTV stream: ${err.message}`);
    } finally {
      setActionBusy((prev) => ({ ...prev, [sessionId]: false }));
    }
  };

  // Delete Camera
  const handleDelete = async (sessionId) => {
    if (!confirm('Delete this camera session? Any active streams will be stopped.')) return;
    try {
      await cameraAPI.delete(sessionId);
      await fetchCameras();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="cameras-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Camera Management</h1>
          <p className="page-subtitle">
            Configure Smartphone cameras and CCTV/IP network RTSP cameras
          </p>
        </div>
        <button className="btn btn-ghost" onClick={fetchCameras}>
          <HiOutlineRefresh size={16} />
          Refresh
        </button>
      </div>

      {error && <div className="dashboard-error animate-fade-in">⚠ {error}</div>}
      {successMsg && <div className="dashboard-success animate-fade-in" style={{ padding: '0.75rem 1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}>✓ {successMsg}</div>}

      {/* Add Camera Form Card */}
      <div className="glass-card animate-fade-in">
        <div className="camera-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'phone' ? 'active' : ''}`}
            onClick={() => setActiveTab('phone')}
          >
            <HiOutlineDeviceMobile size={18} />
            Smartphone Camera
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'cctv' ? 'active' : ''}`}
            onClick={() => setActiveTab('cctv')}
          >
            <HiOutlineVideoCamera size={18} />
            CCTV / IP Camera (RTSP)
          </button>
        </div>

        {activeTab === 'phone' ? (
          <form className="camera-form" onSubmit={handleCreatePhone}>
            <p className="form-helper-text">
              Turn any smartphone (iOS or Android) into a real-time classroom camera using direct WebRTC streaming.
            </p>
            <div className="form-row">
              <input
                type="text"
                className="form-input"
                placeholder="Camera Name (e.g., Classroom Front Unit)"
                value={phoneName}
                onChange={(e) => setPhoneName(e.target.value)}
                required
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creatingPhone || !phoneName.trim()}
              >
                {creatingPhone ? <span className="spinner-sm" /> : <><HiOutlinePlus size={16} /> Create Phone Camera</>}
              </button>
            </div>
          </form>
        ) : (
          <form className="camera-form" onSubmit={handleCreateCctv}>
            <p className="form-helper-text">
              Ingest an authorized CCTV or IP camera exposing an RTSP or HTTP stream (e.g. <code>rtsp://192.168.1.100:554/live</code>).
              Credentials are stored encrypted and never exposed in browser code.
            </p>

            <div className="grid-2-col">
              <div className="form-group">
                <label className="form-label">Camera Name *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g., Back Wall Dome Camera"
                  value={cctvName}
                  onChange={(e) => setCctvName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">RTSP Stream URL *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="rtsp://192.168.1.100:554/h264"
                  value={rtspUrl}
                  onChange={(e) => setRtspUrl(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Username (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="admin"
                  value={cctvUsername}
                  onChange={(e) => setCctvUsername(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password (Optional)</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={cctvPassword}
                  onChange={(e) => setCctvPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="form-actions-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleTestConnection}
                  disabled={testingStream || !rtspUrl.trim()}
                >
                  {testingStream ? <span className="spinner-sm" /> : 'Probe Connection'}
                </button>

                {testResult && (
                  <span className={`probe-badge ${testResult.reachable ? 'success' : 'error'}`}>
                    {testResult.reachable ? <HiOutlineCheckCircle size={16} /> : <HiOutlineExclamationCircle size={16} />}
                    {testResult.message}
                  </span>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={creatingCctv || !cctvName.trim() || !rtspUrl.trim()}
              >
                {creatingCctv ? <span className="spinner-sm" /> : <><HiOutlinePlus size={16} /> Add CCTV Camera</>}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Camera Table */}
      <div className="glass-card animate-fade-in">
        <h2 className="section-title">
          <HiOutlineVideoCamera size={20} />
          All Registered Cameras ({cameras.length})
        </h2>

        {loading ? (
          <div className="loading-screen" style={{ minHeight: 180 }}>
            <div className="spinner" />
          </div>
        ) : cameras.length === 0 ? (
          <div className="empty-state">
            <HiOutlineVideoCamera size={40} />
            <p>No cameras registered yet</p>
            <span className="text-muted">Use the tabs above to add a Smartphone or CCTV camera</span>
          </div>
        ) : (
          <div className="camera-table-wrapper">
            <table className="camera-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Source Type</th>
                  <th>Stream / Target</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cameras.map((cam) => {
                  const isCctv = cam.type === 'cctv';
                  const isBusy = Boolean(actionBusy[cam.sessionId]);
                  const isStreaming = cam.status === 'streaming';

                  return (
                    <tr key={cam.sessionId}>
                      <td className="camera-table__name">
                        <span className={`pulse-dot ${cam.status}`} />
                        {cam.name}
                      </td>
                      <td>
                        <span className={`source-type-badge ${isCctv ? 'cctv' : 'phone'}`}>
                          {isCctv ? <><HiOutlineVideoCamera size={13} /> CCTV / IP</> : <><HiOutlineDeviceMobile size={13} /> Smartphone</>}
                        </span>
                      </td>
                      <td className="camera-table__id">
                        {isCctv ? (
                          <code title={cam.sanitizedUrl || 'RTSP Stream'}>
                            {cam.sanitizedUrl ? (cam.sanitizedUrl.length > 36 ? cam.sanitizedUrl.slice(0, 36) + '…' : cam.sanitizedUrl) : 'RTSP Feed'}
                          </code>
                        ) : (
                          <code>WebRTC P2P ({cam.sessionId.slice(0, 8)}…)</code>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${cam.status}`}>
                          {cam.status}
                        </span>
                      </td>
                      <td className="camera-table__date">
                        {new Date(cam.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {isCctv ? (
                            <>
                              {isStreaming ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleStopCctv(cam.sessionId)}
                                  disabled={isBusy}
                                  title="Stop CCTV ingestion worker"
                                >
                                  {isBusy ? <span className="spinner-sm" /> : <><HiOutlineStop size={14} /> Stop Stream</>}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleStartCctv(cam.sessionId)}
                                  disabled={isBusy}
                                  title="Start background ingestion worker"
                                >
                                  {isBusy ? <span className="spinner-sm" /> : <><HiOutlinePlay size={14} /> Start Stream</>}
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              <a
                                href={`/camera/${cam.sessionId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-secondary btn-sm"
                                title="Open mobile camera broadcaster"
                              >
                                <HiOutlineExternalLink size={14} /> Open
                              </a>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                  const url = `${window.location.origin}/camera/${cam.sessionId}`;
                                  navigator.clipboard.writeText(url);
                                  setCopiedId(cam.sessionId);
                                  setTimeout(() => setCopiedId(''), 2000);
                                }}
                                title="Copy smartphone camera link"
                              >
                                <HiOutlineClipboardCopy size={14} />
                                {copiedId === cam.sessionId ? 'Copied!' : 'Copy'}
                              </button>
                            </>
                          )}

                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(cam.sessionId)}
                            title="Delete camera"
                          >
                            <HiOutlineTrash size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
