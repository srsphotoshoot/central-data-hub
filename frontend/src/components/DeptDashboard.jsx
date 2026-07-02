import React from 'react';
import { ArrowRight, Clock, Download, Upload, Package, CheckCircle, AlertCircle } from 'lucide-react';
import { DEPT_CONFIG, getDeptLabel, getStatusLabel, getStatusBadgeClass } from '../constants';

const today = () => new Date().toISOString().split('T')[0];
const yesterday = () => new Date(Date.now() - 86400000).toISOString().split('T')[0];

const calcTrend = (curr, prev) => {
  if (prev === 0) return curr > 0 ? 100 : null;
  return Math.round(((curr - prev) / prev) * 100);
};

const getRelativeTime = (timestamp) => {
  if (!timestamp) return '—';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const DeptDashboard = ({ entries, selectedDept, setActiveTab }) => {
  const config = DEPT_CONFIG[selectedDept] || DEPT_CONFIG.godown;
  const todayStr = today();
  const ystrdayStr = yesterday();

  const deptEntries = entries.filter(e => e.dept === selectedDept);

  const todayIn    = deptEntries.filter(e => e.type === 'incoming' && e.date === todayStr).length;
  const todayOut   = deptEntries.filter(e => e.type === 'outgoing' && e.date === todayStr).length;
  const ystIn      = deptEntries.filter(e => e.type === 'incoming' && e.date === ystrdayStr).length;
  const ystOut     = deptEntries.filter(e => e.type === 'outgoing' && e.date === ystrdayStr).length;
  const pending      = deptEntries.filter(e => e.status === 'pending').length;
  const cleared      = deptEntries.filter(e => e.status === 'completed').length;
  const awaitingGate = deptEntries.filter(e => e.status === 'dept_issued').length;

  const recent = deptEntries.slice(0, 6);

  const stats = [
    {
      label: config.incomingLabel,
      value: todayIn,
      trend: calcTrend(todayIn, ystIn),
      icon: Download,
      colorClass: 'stat-incoming',
    },
    {
      label: config.outgoingLabel,
      value: todayOut,
      trend: calcTrend(todayOut, ystOut),
      icon: Upload,
      colorClass: 'stat-outgoing',
    },
    {
      label: config.pendingLabel,
      value: pending,
      icon: Clock,
      colorClass: 'stat-pending',
    },
    {
      label: 'Awaiting Gate',
      value: awaitingGate,
      icon: Package,
      colorClass: 'stat-total',
    },
  ];

  return (
    <div className="dept-dashboard" style={{ '--dept-color': config.color, '--dept-bg': config.bg, '--dept-border': config.border, '--dept-glow': config.glow }}>

      <header className="dept-dash-header">
        <div>
          <div className="dept-label-tag">{config.label}</div>
          <h1>{config.dashboardTitle}</h1>
          <p className="dept-dash-sub">{config.description}</p>
        </div>
        <div className="dept-dash-date">
          <span>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      </header>

      <div className="dept-stats-grid">
        {stats.map((stat, i) => (
          <div key={i} className={`glass-card dept-stat-card ${stat.colorClass}`}>
            <div className="dept-stat-icon">
              <stat.icon size={22} />
            </div>
            <div className="dept-stat-body">
              <p className="dept-stat-label">{stat.label}</p>
              <div className="dept-stat-value-row">
                <h3>{stat.value}</h3>
                {stat.trend !== null && stat.trend !== undefined && (
                  <span className={`dept-trend ${stat.trend < 0 ? 'down' : 'up'}`}>
                    {stat.trend >= 0 ? '+' : ''}{stat.trend}%
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {pending > 0 && (
        <button className="clearance-alert" onClick={() => setActiveTab('clearance')}>
          <AlertCircle size={18} />
          <span>
            <strong>{pending} clearance request{pending > 1 ? 's' : ''}</strong> pending authorization — review and approve
          </span>
          <ArrowRight size={16} />
        </button>
      )}

      <div className="dept-dash-grid">
        <section className="glass-card dept-activity-section">
          <div className="dept-section-header">
            <h3>Recent Activity</h3>
            <button className="view-all-btn" onClick={() => setActiveTab('logs')}>
              View All <ArrowRight size={15} />
            </button>
          </div>

          {recent.length === 0 ? (
            <div className="no-activity">
              <Package size={36} />
              <p>No transactions recorded for this department yet.</p>
            </div>
          ) : (
            <div className="dept-activity-list">
              {recent.map(entry => (
                <div key={entry.id} className="dept-activity-row">
                  <div className={`type-dot ${entry.type}`} />
                  <div className="activity-body">
                    <p className="activity-party">{entry.partyName || entry.party || '—'}</p>
                    <p className="activity-meta">
                      {entry.type === 'incoming' ? 'Incoming' : 'Outgoing'} &nbsp;·&nbsp;
                      CH: {entry.challanNo || entry.challan || 'N/A'} &nbsp;·&nbsp;
                      {entry.quantity} {entry.unitType || entry.unit}
                    </p>
                  </div>
                  <div className="activity-right">
                    <span className="activity-time">
                      <Clock size={11} />{getRelativeTime(entry.timestamp)}
                    </span>
                    <span className={`badge ${getStatusBadgeClass(entry.status)}`}>
                      {getStatusLabel(entry.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="dept-side-panel">
          <section className="glass-card dept-quick-actions">
            <h3>Quick Actions</h3>
            <div className="dept-action-list">
              <button className="dept-action-btn" onClick={() => setActiveTab('clearance')}>
                <div className="dept-action-icon pending-icon"><AlertCircle size={18} /></div>
                <div>
                  <p className="dept-action-title">Review Clearances</p>
                  <p className="dept-action-sub">{pending} pending approval</p>
                </div>
                <ArrowRight size={16} />
              </button>
              <button className="dept-action-btn" onClick={() => setActiveTab('issue')}>
                <div className="dept-action-icon issue-icon"><Upload size={18} /></div>
                <div>
                  <p className="dept-action-title">Issue Outgoing Challan</p>
                  <p className="dept-action-sub">Send challan to gate</p>
                </div>
                <ArrowRight size={16} />
              </button>
              <button className="dept-action-btn" onClick={() => setActiveTab('logs')}>
                <div className="dept-action-icon log-icon"><Package size={18} /></div>
                <div>
                  <p className="dept-action-title">Movement Logs</p>
                  <p className="dept-action-sub">{deptEntries.length} total records</p>
                </div>
                <ArrowRight size={16} />
              </button>
            </div>
          </section>

          <section className="glass-card dept-summary-card">
            <h3>Clearance Summary</h3>
            <div className="summary-rows">
              <div className="summary-row">
                <span className="summary-dot cleared" />
                <span className="summary-label">Cleared</span>
                <span className="summary-val">{cleared}</span>
              </div>
              <div className="summary-row">
                <span className="summary-dot pending" />
                <span className="summary-label">Pending</span>
                <span className="summary-val">{pending}</span>
              </div>
              <div className="summary-row">
                <span className="summary-dot rejected" />
                <span className="summary-label">On Hold</span>
                <span className="summary-val">
                  {deptEntries.filter(e => e.status === 'rejected').length}
                </span>
              </div>
            </div>
            {deptEntries.length > 0 && (
              <div className="clearance-bar">
                <div
                  className="clearance-fill"
                  style={{ width: `${Math.round((cleared / deptEntries.length) * 100)}%` }}
                />
              </div>
            )}
            <p className="clearance-pct">
              {deptEntries.length > 0
                ? `${Math.round((cleared / deptEntries.length) * 100)}% clearance rate`
                : 'No records yet'}
            </p>
          </section>
        </div>
      </div>

      <style>{`
        .dept-dashboard { display: flex; flex-direction: column; gap: 28px; }

        .dept-dash-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .dept-label-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--dept-bg);
          border: 1px solid var(--dept-border);
          color: var(--dept-color);
          padding: 4px 14px;
          border-radius: 20px;
          font-size: 0.72rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 12px;
        }

        .dept-dash-header h1 {
          font-size: 2rem;
          letter-spacing: -0.02em;
          margin-bottom: 4px;
        }
        .dept-dash-sub { color: var(--text-dim); font-size: 0.95rem; }
        .dept-dash-date {
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px 18px;
          font-size: 0.85rem;
          color: var(--text-dim);
          font-weight: 500;
          white-space: nowrap;
        }

        .dept-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        .dept-stat-card {
          padding: 20px;
          display: flex;
          gap: 16px;
          align-items: center;
        }

        .dept-stat-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .stat-incoming .dept-stat-icon { background: var(--dept-bg); color: var(--dept-color); border: 1px solid var(--dept-border); }
        .stat-outgoing .dept-stat-icon { background: rgba(99,102,241,0.08); color: var(--primary); border: 1px solid rgba(99,102,241,0.15); }
        .stat-pending .dept-stat-icon { background: rgba(245,158,11,0.08); color: var(--accent); border: 1px solid rgba(245,158,11,0.15); }
        .stat-total .dept-stat-icon { background: rgba(100,116,139,0.1); color: #94a3b8; border: 1px solid rgba(100,116,139,0.15); }

        .dept-stat-label { font-size: 0.8rem; color: var(--text-dim); margin-bottom: 4px; font-weight: 500; }
        .dept-stat-value-row { display: flex; align-items: baseline; gap: 8px; }
        .dept-stat-value-row h3 { font-size: 1.8rem; font-weight: 800; }
        .dept-trend { font-size: 0.72rem; font-weight: 700; }
        .dept-trend.up { color: var(--secondary); }
        .dept-trend.down { color: #fb7185; }

        .clearance-alert {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 22px;
          background: rgba(245,158,11,0.07);
          border: 1px solid rgba(245,158,11,0.2);
          border-radius: 14px;
          color: #fbbf24;
          cursor: pointer;
          width: 100%;
          text-align: left;
          font-size: 0.95rem;
          transition: var(--transition);
        }
        .clearance-alert:hover { background: rgba(245,158,11,0.12); }
        .clearance-alert span { flex: 1; }
        .clearance-alert strong { font-weight: 700; }

        .dept-dash-grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 20px;
        }

        .dept-activity-section { padding: 24px; }
        .dept-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .dept-section-header h3 { font-size: 1rem; font-weight: 700; }
        .view-all-btn { display: flex; align-items: center; gap: 4px; background: none; border: none; color: var(--primary); font-weight: 600; font-size: 0.85rem; cursor: pointer; }

        .no-activity { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 0; color: var(--text-dim); text-align: center; }
        .no-activity p { font-size: 0.9rem; }

        .dept-activity-list { display: flex; flex-direction: column; gap: 0; }
        .dept-activity-row {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 0;
          border-bottom: 1px solid var(--border);
        }
        .dept-activity-row:last-child { border-bottom: none; }

        .type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .type-dot.incoming { background: var(--secondary); }
        .type-dot.outgoing { background: var(--primary); }

        .activity-body { flex: 1; min-width: 0; }
        .activity-party { font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .activity-meta { font-size: 0.75rem; color: var(--text-dim); margin-top: 2px; }

        .activity-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
        .activity-time { display: flex; align-items: center; gap: 3px; font-size: 0.72rem; color: var(--text-dim); }

        .dept-side-panel { display: flex; flex-direction: column; gap: 16px; }

        .dept-quick-actions { padding: 20px; }
        .dept-quick-actions h3 { font-size: 0.9rem; font-weight: 700; margin-bottom: 16px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }

        .dept-action-list { display: flex; flex-direction: column; gap: 8px; }
        .dept-action-btn {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.02);
          border-radius: 12px;
          color: var(--text-main);
          cursor: pointer;
          transition: var(--transition);
          text-align: left;
          width: 100%;
        }
        .dept-action-btn:hover { background: rgba(255,255,255,0.05); border-color: var(--dept-color); }
        .dept-action-btn svg:last-child { margin-left: auto; color: var(--text-dim); flex-shrink: 0; }
        .dept-action-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .pending-icon { background: rgba(245,158,11,0.1); color: #fbbf24; }
        .issue-icon { background: rgba(139,92,246,0.1); color: #a78bfa; }
        .log-icon { background: rgba(100,116,139,0.1); color: #94a3b8; }
        .dept-action-title { font-size: 0.88rem; font-weight: 600; margin-bottom: 1px; }
        .dept-action-sub { font-size: 0.75rem; color: var(--text-dim); }

        .dept-summary-card { padding: 20px; }
        .dept-summary-card h3 { font-size: 0.9rem; font-weight: 700; margin-bottom: 16px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
        .summary-rows { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
        .summary-row { display: flex; align-items: center; gap: 10px; font-size: 0.88rem; }
        .summary-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .summary-dot.cleared { background: var(--secondary); }
        .summary-dot.pending { background: var(--accent); }
        .summary-dot.rejected { background: #fb7185; }
        .summary-label { flex: 1; color: var(--text-dim); }
        .summary-val { font-weight: 700; }

        .clearance-bar { height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
        .clearance-fill { height: 100%; background: var(--secondary); border-radius: 3px; transition: width 0.6s ease; }
        .clearance-pct { font-size: 0.75rem; color: var(--text-dim); }

        @media (max-width: 1200px) {
          .dept-stats-grid { grid-template-columns: 1fr 1fr; }
          .dept-dash-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
};

export default DeptDashboard;
