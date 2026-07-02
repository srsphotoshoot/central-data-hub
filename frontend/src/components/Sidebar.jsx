import React from 'react';
import { LayoutDashboard, Package, LogOut, ShieldCheck, Download, ClipboardList, Send, Bell, Activity } from 'lucide-react';

const GUARD_MENU = [
  { id: 'dashboard', label: 'Dashboard',         mobile: 'Home',     icon: LayoutDashboard },
  { id: 'production', label: 'Production Live',   mobile: 'Prod',     icon: Activity },
  { id: 'incoming',  label: 'Incoming',           mobile: 'In',       icon: Download },
  { id: 'requests',  label: 'Gate Pass Requests', mobile: 'Requests', icon: Bell },
  { id: 'logs',      label: 'Movement Logs',      mobile: 'Logs',     icon: Package },
];

const DEPT_MENU = [
  { id: 'dashboard', label: 'Dashboard',         mobile: 'Home',  icon: LayoutDashboard },
  { id: 'production', label: 'Production Live',   mobile: 'Prod',  icon: Activity },
  { id: 'clearance', label: 'Clearance Control', mobile: 'Clear', icon: ShieldCheck },
  { id: 'issue',     label: 'Issue Challan',      mobile: 'Issue', icon: Send },
  { id: 'logs',      label: 'Movement Logs',      mobile: 'Logs',  icon: ClipboardList },
];

const Sidebar = ({ activeTab, setActiveTab, userRole, onLogout, pendingRequestsCount = 0, guardHeldCount = 0 }) => {
  const isGuard = userRole === 'guard';
  const menuItems = isGuard ? GUARD_MENU : DEPT_MENU;

  return (
    <>
      {/* ── Desktop Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-box">
            <ShieldCheck size={28} />
          </div>
          <div className="logo-text">
            <h2>SRS</h2>
            <span>Gate Pass System</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {menuItems.map((item) => {
            const showGuardBadge = isGuard && item.id === 'requests' && pendingRequestsCount > 0;
            const showHeldBadge  = !isGuard && item.id === 'clearance' && guardHeldCount > 0;
            const hasAlert = (item.id === 'requests' && pendingRequestsCount > 0) ||
                             (item.id === 'clearance' && guardHeldCount > 0);
            return (
              <button
                key={item.id}
                className={`nav-item ${activeTab === item.id ? 'active' : ''} ${hasAlert ? 'has-alert' : ''} ${showHeldBadge ? 'has-held-alert' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
                {showGuardBadge && <span className="nav-badge">{pendingRequestsCount}</span>}
                {showHeldBadge  && <span className="nav-badge held-badge">{guardHeldCount}</span>}
                {activeTab === item.id && <div className="active-indicator" />}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="avatar">{isGuard ? 'SG' : 'DH'}</div>
            <div className="user-info">
              <p className="name">{isGuard ? 'Security Guard' : 'Dept. Head'}</p>
              <p className="role">{isGuard ? 'Gate 01' : 'Department'}</p>
            </div>
          </div>
          <button className="logout-btn" onClick={onLogout} title="Switch Role">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* ── Mobile Bottom Navigation ── */}
      <nav className="mobile-nav">
        {menuItems.map((item) => {
          const showGuardBadge = isGuard && item.id === 'requests' && pendingRequestsCount > 0;
          const showHeldBadge  = !isGuard && item.id === 'clearance' && guardHeldCount > 0;
          const isActive = activeTab === item.id;
          const hasAlert = (item.id === 'requests' && pendingRequestsCount > 0) ||
                           (item.id === 'clearance' && guardHeldCount > 0);
          return (
            <button
              key={item.id}
              className={`mobile-nav-btn ${isActive ? 'active' : ''} ${hasAlert ? 'has-alert' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              {isActive && <span className="mobile-active-bar" />}
              <div className="mobile-icon-wrap">
                <item.icon size={22} />
                {showGuardBadge && <span className="mobile-badge">{pendingRequestsCount}</span>}
                {showHeldBadge  && <span className="mobile-badge held-badge">{guardHeldCount}</span>}
              </div>
              <span className="mobile-nav-label">{item.mobile}</span>
            </button>
          );
        })}

        {/* Logout on mobile */}
        <button className="mobile-nav-btn mobile-logout" onClick={onLogout}>
          <div className="mobile-icon-wrap">
            <LogOut size={20} />
          </div>
          <span className="mobile-nav-label">Exit</span>
        </button>
      </nav>

      <style>{`
        /* ── Desktop Sidebar ── */
        .sidebar {
          width: var(--sidebar-width);
          height: 100vh;
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          padding: 24px 16px;
          z-index: 50;
          flex-shrink: 0;
        }

        .sidebar-header { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; padding: 0 8px; }

        .logo-box {
          width: 44px; height: 44px;
          background: linear-gradient(135deg, var(--primary), var(--primary-hover));
          border-radius: 12px; display: flex; align-items: center; justify-content: center;
          color: white; box-shadow: 0 8px 16px var(--primary-glow); flex-shrink: 0;
        }

        .logo-text h2 { font-size: 1.25rem; line-height: 1.2; color: var(--text-main); }
        .logo-text span { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }

        .sidebar-nav { flex: 1; display: flex; flex-direction: column; gap: 4px; }

        .nav-item {
          width: 100%; display: flex; align-items: center; gap: 12px;
          padding: 12px 16px; background: transparent; border: none;
          border-radius: var(--radius-lg); color: var(--text-dim);
          font-size: 0.9rem; font-weight: 500; cursor: pointer;
          transition: var(--transition); position: relative;
        }
        .nav-item:hover { background: rgba(255,255,255,0.05); color: var(--text-main); }
        .nav-item.active { background: rgba(99,102,241,0.1); color: var(--primary); }
        .nav-item.has-alert { color: #fbbf24; }
        .nav-item.has-alert:not(.active) { background: rgba(245,158,11,0.05); }

        .nav-badge {
          margin-left: auto; background: #fbbf24; color: #1e293b;
          font-size: 0.7rem; font-weight: 800; padding: 2px 8px;
          border-radius: 20px; animation: badgePulse 2s infinite;
        }
        .nav-badge.held-badge { background: #fb7185; color: white; }
        .nav-item.has-held-alert { color: #fb7185; }
        .nav-item.has-held-alert:not(.active) { background: rgba(244,63,94,0.06); }
        @keyframes badgePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

        .active-indicator {
          position: absolute; left: -16px; width: 4px; height: 24px;
          background: var(--primary); border-radius: 0 4px 4px 0;
          box-shadow: 4px 0 12px var(--primary-glow);
        }

        .sidebar-footer {
          margin-top: auto; padding-top: 24px; border-top: 1px solid var(--border);
          display: flex; align-items: center; justify-content: space-between;
        }
        .user-profile { display: flex; align-items: center; gap: 12px; }
        .avatar { width: 36px; height: 36px; background: rgba(255,255,255,0.1); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem; color: var(--text-main); }
        .user-info .name { font-size: 0.85rem; font-weight: 600; color: var(--text-main); }
        .user-info .role { font-size: 0.75rem; color: var(--text-dim); }
        .logout-btn { width: 36px; height: 36px; background: transparent; border: none; color: var(--text-dim); cursor: pointer; transition: var(--transition); display: flex; align-items: center; justify-content: center; }
        .logout-btn:hover { color: #fb7185; background: rgba(251,113,133,0.1); border-radius: 10px; }

        /* ── Mobile Bottom Nav — hidden on desktop ── */
        .mobile-nav { display: none; }

        @media (max-width: 768px) {
          .sidebar { display: none; }

          .mobile-nav {
            display: flex;
            position: fixed;
            bottom: 0; left: 0; right: 0;
            height: 64px;
            padding-bottom: env(safe-area-inset-bottom, 0px);
            background: rgba(15, 23, 42, 0.97);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-top: 1px solid var(--border);
            z-index: 200;
          }

          .mobile-nav-btn {
            flex: 1;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 3px; padding: 6px 2px;
            background: none; border: none;
            color: var(--text-dim); cursor: pointer;
            transition: color 0.2s; position: relative;
            -webkit-tap-highlight-color: transparent;
            min-width: 0;
          }
          .mobile-nav-btn.active { color: var(--primary); }
          .mobile-nav-btn.has-alert { color: #fbbf24; }
          .mobile-nav-btn.mobile-logout { color: var(--text-dim); }
          .mobile-nav-btn.mobile-logout:hover { color: #fb7185; }

          .mobile-active-bar {
            position: absolute; top: 0; left: 50%;
            transform: translateX(-50%);
            width: 28px; height: 3px;
            background: var(--primary); border-radius: 0 0 4px 4px;
          }

          .mobile-icon-wrap { position: relative; display: flex; align-items: center; justify-content: center; }

          .mobile-badge {
            position: absolute; top: -5px; right: -8px;
            background: #fbbf24; color: #1e293b;
            font-size: 0.55rem; font-weight: 900;
            padding: 1px 4px; border-radius: 8px;
            min-width: 14px; text-align: center;
            animation: badgePulse 2s infinite;
          }
          .mobile-badge.held-badge { background: #fb7185; color: white; }

          .mobile-nav-label {
            font-size: 0.58rem; font-weight: 600;
            text-align: center; line-height: 1;
            overflow: hidden; text-overflow: ellipsis;
            white-space: nowrap; max-width: 100%;
          }
        }
      `}</style>
    </>
  );
};

export default Sidebar;
