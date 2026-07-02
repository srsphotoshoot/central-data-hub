import React, { useState } from 'react';
import { Package, Clock, ArrowRight, Download, Upload, Bell, ChevronRight, FileText, Truck, CheckCircle } from 'lucide-react';

const today = () => new Date().toISOString().split('T')[0];
const yesterday = () => new Date(Date.now() - 86400000).toISOString().split('T')[0];

const calcTrend = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
};

const getRelativeTime = (timestamp) => {
  if (!timestamp) return 'N/A';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const WeekChart = ({ entries }) => {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    return {
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      isToday: i === 6,
      incoming: entries.filter(e => e.type === 'incoming' && e.date === dateStr).length,
      outgoing: entries.filter(e => e.type === 'outgoing' && e.date === dateStr).length,
    };
  });

  const maxVal = Math.max(1, ...days.flatMap(d => [d.incoming, d.outgoing]));
  const totalWeek = days.reduce((s, d) => s + d.incoming + d.outgoing, 0);

  return (
    <section className="glass-card week-chart-card">
      <div className="wc-header">
        <div>
          <h3>7-Day Movement</h3>
          <p className="wc-sub">{totalWeek} total transactions this week</p>
        </div>
        <div className="wc-legend">
          <span className="wc-dot in-dot" /> <span>Incoming</span>
          <span className="wc-dot out-dot" /> <span>Outgoing</span>
        </div>
      </div>
      <div className="wc-body">
        {days.map((day, i) => (
          <div key={i} className={`wc-col ${day.isToday ? 'wc-today' : ''}`}>
            <div className="wc-bars">
              <div
                className="wc-bar wc-in"
                style={{ height: `${Math.max(4, (day.incoming / maxVal) * 100)}%` }}
                title={`${day.incoming} incoming`}
              />
              <div
                className="wc-bar wc-out"
                style={{ height: `${Math.max(day.outgoing > 0 ? 4 : 0, (day.outgoing / maxVal) * 100)}%` }}
                title={`${day.outgoing} outgoing`}
              />
            </div>
            <div className="wc-nums">
              {day.incoming > 0 && <span className="wc-n in-n">{day.incoming}</span>}
              {day.outgoing > 0 && <span className="wc-n out-n">{day.outgoing}</span>}
            </div>
            <span className="wc-label">{day.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

const StatCard = ({ icon: Icon, label, value, trend, color }) => (
  <div className="glass-card stat-card">
    <div className={`icon-box ${color}`}>
      <Icon size={24} />
    </div>
    <div className="stat-info">
      <p className="label">{label}</p>
      <div className="value-row">
        <h3>{value}</h3>
        {trend !== null && trend !== undefined && (
          <span className={`trend ${trend < 0 ? 'trend-down' : ''}`}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
    </div>
  </div>
);

const Dashboard = ({ entries = [], setActiveTab, onUpdateStatus }) => {
  const todayStr = today();
  const ystrdayStr = yesterday();

  const todayIn = entries.filter(e => e.type === 'incoming' && e.date === todayStr).length;
  const todayOut = entries.filter(e => e.type === 'outgoing' && e.date === todayStr).length;
  const ystrdayIn = entries.filter(e => e.type === 'incoming' && e.date === ystrdayStr).length;
  const ystrdayOut = entries.filter(e => e.type === 'outgoing' && e.date === ystrdayStr).length;

  const stats = [
    { icon: Download, label: 'Incoming Today', value: todayIn, trend: calcTrend(todayIn, ystrdayIn), color: 'emerald' },
    { icon: Upload, label: 'Outgoing Today', value: todayOut, trend: calcTrend(todayOut, ystrdayOut), color: 'indigo' },
    { icon: Clock, label: 'In Progress', value: entries.filter(e => e.status === 'pending').length, color: 'amber' },
    { icon: Package, label: 'Total Movement', value: entries.length, color: 'rose' },
  ];

  const deptRequests = entries.filter(e => e.status === 'dept_issued');

  return (
    <div className="dashboard">
      <header className="page-header">
        <div className="welcome">
          <h1>Material Movement Dashboard</h1>
          <p>Tracking departmental transactions and goods flow.</p>
        </div>
        <div className="actions">
          <button className="btn-primary" onClick={() => setActiveTab('incoming')}>
            New Incoming Entry
          </button>
        </div>
      </header>

      {deptRequests.length > 0 && (
        <button className="dept-alert-banner" onClick={() => setActiveTab('requests')}>
          <div className="alert-icon">
            <Bell size={20} />
          </div>
          <div className="alert-text">
            <strong>{deptRequests.length} Gate Pass Request{deptRequests.length > 1 ? 's' : ''} Pending</strong>
            <span>Department has issued challans — physically verify and issue gate passes</span>
          </div>
          <ChevronRight size={20} className="alert-arrow" />
        </button>
      )}

      <div className="stats-grid">
        {stats.map((stat, i) => (
          <StatCard key={i} {...stat} />
        ))}
      </div>

      <WeekChart entries={entries} />

      <div className="dashboard-grid">
        <section className="glass-card activity-section">
          <div className="section-header">
            <h3>Recent Material Movement</h3>
            <button className="view-all" onClick={() => setActiveTab('logs')}>
              View Logs <ArrowRight size={16} />
            </button>
          </div>
          <div className="activity-list">
            {entries.slice(0, 6).map((entry) => (
              <div key={entry.id} className="activity-item">
                <div className="item-prefix">
                  <div className={`status-dot ${entry.type}`} />
                </div>
                <div className="item-content">
                  <p className="item-title">{entry.partyName || entry.party}</p>
                  <p className="item-meta">
                    {entry.type === 'incoming' ? 'IN' : 'OUT'} •
                    CH: {entry.challanNo || entry.challan} •
                    {entry.quantity} {entry.unitType || entry.unit}
                  </p>
                </div>
                <div className="item-time">
                  <Clock size={12} />
                  <span>{getRelativeTime(entry.timestamp)}</span>
                </div>
                <div className={`badge badge-${
                  entry.status === 'completed'     ? 'in' :
                  entry.status === 'guard_cleared' ? 'cleared' :
                  entry.status === 'dept_issued'   ? 'dept' :
                  entry.status === 'rejected'      ? 'out' :
                  entry.status === 'guard_held'    ? 'out' : 'pending'
                }`}>
                  {entry.status === 'completed'     ? 'Cleared' :
                   entry.status === 'guard_cleared' ? 'Dispatched' :
                   entry.status === 'dept_issued'   ? 'At Gate' :
                   entry.status === 'rejected'      ? 'On Hold' :
                   entry.status === 'guard_held'    ? 'Held' : 'Pending'}
                </div>
              </div>
            ))}
            {entries.length === 0 && (
              <p className="no-entries">No entries yet. Start by adding an incoming entry.</p>
            )}
          </div>
        </section>

        <section className="glass-card quick-actions">
          <h3>Quick Entry</h3>
          <div className="action-buttons">
            <button className="action-btn" onClick={() => setActiveTab('incoming')}>
              <Download size={20} />
              <span>Incoming Material</span>
            </button>
            <button className="action-btn" onClick={() => setActiveTab('requests')}>
              <Upload size={20} />
              <span>Gate Pass Requests</span>
            </button>
            <button className="action-btn" onClick={() => setActiveTab('logs')}>
              <Package size={20} />
              <span>Movement History</span>
            </button>
          </div>
        </section>
      </div>

      <style>{`
        .dashboard { display: flex; flex-direction: column; gap: 32px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-end; }
        .welcome h1 { font-size: 2rem; margin-bottom: 4px; }
        .welcome p { color: var(--text-dim); }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
        .stat-card { padding: 24px; display: flex; align-items: center; gap: 20px; }
        .icon-box { width: 56px; height: 56px; border-radius: 16px; display: flex; align-items: center; justify-content: center; color: white; }
        .icon-box.indigo { background: rgba(99, 102, 241, 0.1); color: var(--primary); }
        .icon-box.emerald { background: rgba(16, 185, 129, 0.1); color: var(--secondary); }
        .icon-box.amber { background: rgba(245, 158, 11, 0.1); color: var(--accent); }
        .icon-box.rose { background: rgba(244, 63, 94, 0.1); color: #fb7185; }

        .stat-info .label { font-size: 0.85rem; color: var(--text-dim); margin-bottom: 4px; }
        .value-row { display: flex; align-items: baseline; gap: 8px; }
        .value-row h3 { font-size: 1.5rem; }
        .trend { font-size: 0.75rem; color: var(--secondary); font-weight: 600; }
        .trend-down { color: #fb7185; }

        .dashboard-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 24px; }
        .activity-section { padding: 24px; }
        .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        .view-all { background: none; border: none; color: var(--primary); display: flex; align-items: center; gap: 4px; cursor: pointer; font-weight: 600; font-size: 0.9rem; }

        .activity-list { display: flex; flex-direction: column; gap: 16px; }
        .activity-item { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
        .activity-item:last-child { border-bottom: none; padding-bottom: 0; }

        .status-dot { width: 10px; height: 10px; border-radius: 50%; }
        .status-dot.incoming { background: var(--secondary); }
        .status-dot.outgoing { background: var(--primary); }

        .item-content { flex: 1; }
        .item-title { font-weight: 600; font-size: 0.95rem; }
        .item-meta { font-size: 0.8rem; color: var(--text-dim); }
        .item-time { display: flex; align-items: center; gap: 4px; font-size: 0.75rem; color: var(--text-dim); }

        .no-entries { color: var(--text-dim); font-size: 0.9rem; text-align: center; padding: 24px 0; }

        .dept-alert-banner {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 18px 24px;
          background: rgba(245, 158, 11, 0.08);
          border: 1px solid rgba(245, 158, 11, 0.25);
          border-radius: 16px;
          cursor: pointer;
          transition: var(--transition);
          width: 100%;
          text-align: left;
          animation: alertSlide 0.4s ease;
        }
        @keyframes alertSlide {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .dept-alert-banner:hover { background: rgba(245, 158, 11, 0.13); border-color: rgba(245, 158, 11, 0.4); }
        .alert-icon { width: 44px; height: 44px; background: rgba(245,158,11,0.15); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #fbbf24; flex-shrink: 0; animation: bellShake 2s infinite; }
        @keyframes bellShake {
          0%, 90%, 100% { transform: rotate(0); }
          92% { transform: rotate(-10deg); }
          96% { transform: rotate(10deg); }
        }
        .alert-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .alert-text strong { color: #fbbf24; font-size: 1rem; }
        .alert-text span { color: var(--text-dim); font-size: 0.85rem; }
        .alert-arrow { color: #fbbf24; flex-shrink: 0; }

        .quick-actions { padding: 24px; display: flex; flex-direction: column; gap: 20px; }
        .action-buttons { display: flex; flex-direction: column; gap: 12px; }
        .action-btn { width: 100%; display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: var(--radius-lg); color: var(--text-main); cursor: pointer; transition: var(--transition); }
        .action-btn:hover { background: rgba(255,255,255,0.08); border-color: var(--primary); }

        @media (max-width: 1024px) {
          .dashboard-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 768px) {
          .page-header { flex-direction: column; align-items: flex-start; gap: 12px; }
          .welcome h1 { font-size: 1.4rem; }
          .actions .btn-primary { width: 100%; }
          .stats-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
          .stat-card { padding: 16px; gap: 12px; }
          .icon-box { width: 44px; height: 44px; border-radius: 12px; }
          .value-row h3 { font-size: 1.3rem; }
          .wc-body { height: 110px; }
          .activity-section, .quick-actions { padding: 16px; }
        }

        /* 7-day chart */
        .week-chart-card { padding: 24px; }
        .wc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .wc-header h3 { font-size: 1rem; font-weight: 700; margin-bottom: 4px; }
        .wc-sub { font-size: 0.8rem; color: var(--text-dim); }
        .wc-legend { display: flex; align-items: center; gap: 16px; font-size: 0.8rem; color: var(--text-dim); }
        .wc-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; margin-right: 5px; }
        .in-dot { background: var(--secondary); }
        .out-dot { background: var(--primary); }

        .wc-body { display: flex; align-items: flex-end; gap: 8px; height: 140px; padding-bottom: 28px; position: relative; border-bottom: 1px solid var(--border); }
        .wc-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; position: relative; }
        .wc-today .wc-label { color: var(--primary); font-weight: 700; }
        .wc-today::after { content: ''; position: absolute; bottom: -28px; left: 50%; transform: translateX(-50%); width: 5px; height: 5px; background: var(--primary); border-radius: 50%; }

        .wc-bars { display: flex; align-items: flex-end; gap: 3px; width: 100%; height: 100%; }
        .wc-bar { flex: 1; border-radius: 4px 4px 0 0; transition: height 0.4s ease; min-height: 0; }
        .wc-in { background: var(--secondary); opacity: 0.8; }
        .wc-out { background: var(--primary); opacity: 0.8; }
        .wc-col:hover .wc-bar { opacity: 1; }

        .wc-nums { display: flex; gap: 3px; position: absolute; top: -18px; }
        .wc-n { font-size: 0.65rem; font-weight: 700; }
        .in-n { color: var(--secondary); }
        .out-n { color: var(--primary); }

        .wc-label { position: absolute; bottom: -22px; font-size: 0.72rem; color: var(--text-dim); white-space: nowrap; }
      `}</style>
    </div>
  );
};

export default Dashboard;
