import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  HiOutlineViewGrid,
  HiOutlineVideoCamera,
  HiOutlineEye,
  HiOutlineCog,
  HiOutlineLogout,
  HiOutlineClipboardList,
  HiOutlineCollection,
} from 'react-icons/hi';
import './Sidebar.css';

const navItems = [
  { to: '/dashboard', icon: HiOutlineViewGrid, label: 'Dashboard' },
  { to: '/cameras', icon: HiOutlineVideoCamera, label: 'Cameras' },
  { to: '/monitoring', icon: HiOutlineEye, label: 'Live Monitor' },
  { to: '/history', icon: HiOutlineClipboardList, label: 'History' },
  { to: '/settings', icon: HiOutlineCog, label: 'Settings' },
];

export default function Sidebar({ collapsed, onToggle }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Brand */}
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <HiOutlineCollection size={28} />
        </div>
        {!collapsed && (
          <div className="sidebar__brand-text">
            <span className="sidebar__title">SmartClass</span>
            <span className="sidebar__subtitle">AI Monitor</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar__nav">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
            }
            title={label}
          >
            <Icon size={20} />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div className="sidebar__footer">
        {!collapsed && (
          <div className="sidebar__user">
            <div className="sidebar__avatar">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="sidebar__user-info">
              <span className="sidebar__user-name">{user?.name}</span>
              <span className="sidebar__user-role">{user?.role}</span>
            </div>
          </div>
        )}
        <button className="sidebar__logout" onClick={handleLogout} title="Logout">
          <HiOutlineLogout size={20} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
