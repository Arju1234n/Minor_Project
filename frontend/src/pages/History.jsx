import { useEffect, useState } from 'react';
import { dashboardAPI } from '../services/api';
import { HiOutlineClipboardList, HiOutlineRefresh } from 'react-icons/hi';
import './History.css';

export default function History() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pages: 1 });
  const [error, setError] = useState('');

  const fetchEvents = async (page = 1) => {
    try {
      setError('');
      setLoading(true);
      const res = await dashboardAPI.getEvents({ page, limit: 20 });
      setEvents(res.events || []);
      setPagination(res.pagination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  return (
    <div className="history-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Detection History</h1>
          <p className="page-subtitle">
            Browse past detection events and session statistics
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => fetchEvents(1)}>
          <HiOutlineRefresh size={16} />
          Refresh
        </button>
      </div>

      {error && <div className="dashboard-error animate-fade-in">⚠ {error}</div>}

      <div className="glass-card animate-fade-in">
        <h2 className="section-title">
          <HiOutlineClipboardList size={20} />
          Event Log
        </h2>

        {loading ? (
          <div className="loading-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <HiOutlineClipboardList size={40} />
            <p>No detection events recorded</p>
            <span className="text-muted">
              Events will appear here once AI detection is running
            </span>
          </div>
        ) : (
          <>
            <div className="camera-table-wrapper">
              <table className="camera-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Session</th>
                    <th>People</th>
                    <th>Detections</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((evt, i) => (
                    <tr key={i}>
                      <td>{new Date(evt.timestamp).toLocaleString()}</td>
                      <td>
                        <code>{evt.sessionId?.slice(0, 8) ?? '—'}…</code>
                      </td>
                      <td>
                        <span className="badge badge-online">
                          {evt.peopleCount}
                        </span>
                      </td>
                      <td className="text-muted">
                        {evt.detections?.length ?? 0} boxes
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="history-pagination">
              <button
                className="btn btn-ghost btn-sm"
                disabled={pagination.page <= 1}
                onClick={() => fetchEvents(pagination.page - 1)}
              >
                Previous
              </button>
              <span className="history-pagination__info">
                Page {pagination.page} of {pagination.pages}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={pagination.page >= pagination.pages}
                onClick={() => fetchEvents(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
