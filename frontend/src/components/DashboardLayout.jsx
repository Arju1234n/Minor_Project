import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import Sidebar from './Sidebar';
import { HiOutlineMenu } from 'react-icons/hi';
import './DashboardLayout.css';

export default function DashboardLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="dashboard-layout">
      <div className={mobileOpen ? 'sidebar--mobile-open-wrapper' : ''}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
        />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <main
        className="dashboard-main"
        style={{
          marginLeft: sidebarCollapsed
            ? 'var(--sidebar-collapsed)'
            : 'var(--sidebar-width)',
        }}
      >
        {/* Top bar (mobile toggle + breadcrumb area) */}
        <header className="dashboard-topbar">
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileOpen((o) => !o)}
          >
            <HiOutlineMenu size={24} />
          </button>
        </header>

        <div className="dashboard-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
