import { useEffect, useState } from 'react';
import { dashboardAPI, cameraAPI } from '../services/api';
import {
  HiOutlineVideoCamera,
  HiOutlineStatusOnline,
  HiOutlineUserGroup,
  HiOutlineLightningBolt,
  HiOutlineRefresh,
} from 'react-icons/hi';
import './Dashboard.css';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      setError('');
      const [statsRes, camRes] = await Promise.all([
        dashboardAPI.getStats(),
        cameraAPI.list(),
      ]);
      setStats(statsRes.stats);
      setCameras(camRes.sessions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 15 seconds
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
      </div>
    );
  }

  const statCards = [
    {
      icon: HiOutlineVideoCamera,
      label: 'Total Cameras',
      value: stats?.totalCameras ?? 0,
      color: 'var(--accent-primary)',
    },
    {
      icon: HiOutlineStatusOnline,
      label: 'Online Now',
      value: stats?.onlineCameras ?? 0,
      color: 'var(--accent-success)',
    },
    {
      icon: HiOutlineUserGroup,
      label: 'People Detected Today',
      value: stats?.eventsToday ?? 0,
      color: 'var(--accent-secondary)',
    },
    {
      icon: HiOutlineLightningBolt,
      label: 'Recent Events',
      value: stats?.recentEvents?.length ?? 0,
      color: 'var(--accent-warning)',
    },
  ];

  return (
    <div className="dashboard-page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Real-time overview of your smart classroom monitoring system
          </p>
        </div>
        <button className="btn btn-ghost" onClick={fetchData}>
          <HiOutlineRefresh size={16} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="dashboard-error animate-fade-in">
          ⚠ {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="stat-grid stagger">
        {statCards.map((card, i) => (
          <div key={i} className="glass-card stat-card animate-fade-in">
            <div className="stat-card__header">
              <div
                className="stat-card__icon"
                style={{ background: `${card.color}20`, color: card.color }}
              >
                <card.icon size={22} />
              </div>
            </div>
            <div className="stat-value">{card.value}</div>
            <div className="stat-label">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Camera List + Recent Activity */}
      <div className="dashboard-grid">
        {/* Connected Cameras */}
        <div className="glass-card animate-fade-in">
          <h2 className="section-title">
            <HiOutlineVideoCamera size={20} />
            Camera Sessions
          </h2>

          {cameras.length === 0 ? (
            <div className="empty-state">
              <HiOutlineVideoCamera size={40} />
              <p>No cameras registered yet</p>
              <span className="text-muted">
                Go to Camera Management to add a camera
              </span>
            </div>
          ) : (
            <div className="camera-list">
              {cameras.map((cam) => (
                <div key={cam.sessionId} className="camera-item">
                  <div className="camera-item__info">
                    <span className={`pulse-dot ${cam.status}`} />
                    <div>
                      <span className="camera-item__name">{cam.name}</span>
                      <span className="camera-item__id">
                        {cam.sessionId.slice(0, 8)}…
                      </span>
                    </div>
                  </div>
                  <span className={`badge badge-${cam.status}`}>
                    {cam.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Detection Events */}
        <div className="glass-card animate-fade-in">
          <h2 className="section-title">
            <HiOutlineLightningBolt size={20} />
            Recent Detection Events
          </h2>

          {(!stats?.recentEvents || stats.recentEvents.length === 0) ? (
            <div className="empty-state">
              <HiOutlineUserGroup size={40} />
              <p>No detection events yet</p>
              <span className="text-muted">
                Events will appear here once detection is running
              </span>
            </div>
          ) : (
            <div className="event-list">
              {stats.recentEvents.slice(0, 10).map((evt, i) => (
                <div key={i} className="event-item">
                  <div className="event-item__badge">
                    {evt.peopleCount}
                  </div>
                  <div className="event-item__info">
                    <span className="event-item__label">
                      {evt.peopleCount} {evt.peopleCount === 1 ? 'person' : 'people'} detected
                    </span>
                    <span className="event-item__time">
                      {new Date(evt.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
