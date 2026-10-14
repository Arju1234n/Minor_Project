import { useEffect, useState } from 'react';
import { cameraAPI } from '../services/api';
import {
  HiOutlineVideoCamera,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineRefresh,
  HiOutlineExternalLink,
  HiOutlineClipboardCopy,
} from 'react-icons/hi';
import './Cameras.css';

export default function Cameras() {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState('');

  const fetchCameras = async () => {
    try {
      setError('');
      const res = await cameraAPI.list();
      setCameras(res.sessions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await cameraAPI.create(newName.trim());
      setNewName('');
      await fetchCameras();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (sessionId) => {
    if (!confirm('Delete this camera session?')) return;
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
            Create, manage, and monitor your camera sessions
          </p>
        </div>
        <button className="btn btn-ghost" onClick={fetchCameras}>
          <HiOutlineRefresh size={16} />
          Refresh
        </button>
      </div>

      {error && <div className="dashboard-error animate-fade-in">⚠ {error}</div>}

      {/* Create Camera */}
      <div className="glass-card animate-fade-in">
        <h2 className="section-title">
          <HiOutlinePlus size={20} />
          Add New Camera
        </h2>
        <form className="create-camera-form" onSubmit={handleCreate}>
          <input
            type="text"
            className="form-input"
            placeholder="Camera name (e.g., Classroom A)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={creating || !newName.trim()}
          >
            {creating ? <span className="spinner-sm" /> : <><HiOutlinePlus size={16} /> Create</>}
          </button>
        </form>
      </div>

      {/* Camera Table */}
      <div className="glass-card animate-fade-in">
        <h2 className="section-title">
          <HiOutlineVideoCamera size={20} />
          All Cameras
        </h2>

        {loading ? (
          <div className="loading-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : cameras.length === 0 ? (
          <div className="empty-state">
            <HiOutlineVideoCamera size={40} />
            <p>No cameras registered</p>
            <span className="text-muted">Use the form above to add your first camera</span>
          </div>
        ) : (
          <div className="camera-table-wrapper">
            <table className="camera-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Session ID</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cameras.map((cam) => (
                  <tr key={cam.sessionId}>
                    <td className="camera-table__name">
                      <span className={`pulse-dot ${cam.status}`} />
                      {cam.name}
                    </td>
                    <td className="camera-table__id">
                      <code>{cam.sessionId.slice(0, 12)}…</code>
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
                        <a
                          href={`/camera/${cam.sessionId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary btn-sm"
                          title="Open smartphone camera view in new tab"
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
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(cam.sessionId)}
                          title="Delete session"
                        >
                          <HiOutlineTrash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
