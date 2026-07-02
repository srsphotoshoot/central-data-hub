import React, { useState } from 'react';
import { CheckCircle, XCircle, Package, Clock, AlertCircle, Building2, FileText, Clipboard, Truck } from 'lucide-react';
import { getDeptLabel } from '../constants';

const GatePassRequests = ({ entries, onUpdateStatus }) => {
  const [confirmAction, setConfirmAction] = useState(null);
  const [holdReason, setHoldReason] = useState('');

  const pendingRequests = entries.filter(e => e.status === 'dept_issued');
  const recentlyCleared = entries
    .filter(e => e.status === 'guard_cleared')
    .slice(0, 5);

  const requestAction = (id, status) => {
    setConfirmAction({ id, status });
  };

  const confirmUpdate = () => {
    const extra = confirmAction.status === 'guard_held' && holdReason.trim()
      ? { guardHoldReason: holdReason.trim() }
      : {};
    onUpdateStatus(confirmAction.id, confirmAction.status, extra);
    setConfirmAction(null);
    setHoldReason('');
  };

  return (
    <div className="gpr-page">
      <header className="page-header">
        <div className="title-area">
          <div className="header-tag">
            <Building2 size={14} />
            <span>Department → Guard</span>
          </div>
          <h1>Gate Pass Requests</h1>
          <p>
            {pendingRequests.length > 0
              ? `${pendingRequests.length} challan${pendingRequests.length > 1 ? 's' : ''} awaiting your confirmation`
              : 'All challans have been processed'}
          </p>
        </div>
        <div className="req-count-badge">
          <span className="count">{pendingRequests.length}</span>
          <span className="count-label">Pending</span>
        </div>
      </header>

      {pendingRequests.length === 0 ? (
        <div className="empty-gpr glass-card flex-center">
          <CheckCircle size={56} />
          <h3>No Pending Requests</h3>
          <p>When a department issues a challan, it will appear here for verification</p>
        </div>
      ) : (
        <div className="requests-list">
          {pendingRequests.map(entry => (
            <div key={entry.id} className="request-card glass-card">
              <div className="req-card-top">
                <div className="req-meta">
                  <span className="dept-badge">
                    <Building2 size={12} />
                    {getDeptLabel(entry.dept)}
                  </span>
                  <span className="req-time">
                    <Clock size={12} />
                    {entry.date}
                  </span>
                </div>
                <span className="awaiting-pill">Awaiting Gate Pass</span>
              </div>

              <div className="req-card-body">
                <div className="req-party">
                  <span className="party-label">Outgoing Party</span>
                  <h2 className="party-name">{entry.partyName || entry.party}</h2>
                </div>

                <div className="challan-row">
                  <div className="challan-item">
                    <span className="ch-label"><FileText size={12} /> Challan No.</span>
                    <code className="ch-val">CH: {entry.challanNo || entry.challan}</code>
                  </div>
                  {entry.designNo && (
                    <div className="challan-item">
                      <span className="ch-label">Design No.</span>
                      <code className="ch-val">{entry.designNo}</code>
                    </div>
                  )}
                  {entry.orderNo && (
                    <div className="challan-item">
                      <span className="ch-label">Order No.</span>
                      <code className="ch-val">{entry.orderNo}</code>
                    </div>
                  )}
                  {entry.biltyNo && (
                    <div className="challan-item">
                      <span className="ch-label">Bilty / LR No.</span>
                      <code className="ch-val">{entry.biltyNo}</code>
                    </div>
                  )}
                </div>

                {entry.transportName && (
                  <div className="transport-row">
                    <span className="ch-label"><Truck size={12} /> Transport</span>
                    <span className="transport-val">{entry.transportName}</span>
                  </div>
                )}

                <div className="material-highlight">
                  <div className="material-heading">
                    <Package size={16} />
                    <span>Material Being Dispatched</span>
                  </div>
                  <p className="material-desc">{entry.description || 'No description provided'}</p>
                  {entry.processName && (
                    <div style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--accent)' }}>
                      <strong>Process:</strong> {entry.processName}
                    </div>
                  )}
                  <div className="qty-display">
                    <span className="qty-num">{entry.quantity}</span>
                    <span className="qty-unit">{entry.unitType || entry.unit || 'pcs'}</span>
                  </div>
                </div>

                {entry.guardNotes && (
                  <div className="guard-notes">
                    <div className="notes-heading">
                      <Clipboard size={14} />
                      <span>Notes from Department</span>
                    </div>
                    <p className="notes-text">"{entry.guardNotes}"</p>
                  </div>
                )}
              </div>

              <div className="req-card-actions">
                <button
                  className="action-issue"
                  onClick={() => requestAction(entry.id, 'guard_cleared')}
                >
                  <CheckCircle size={20} />
                  Issue Gate Pass
                </button>
                <button
                  className="action-reject"
                  onClick={() => { setHoldReason(''); requestAction(entry.id, 'guard_held'); }}
                >
                  <XCircle size={20} />
                  Hold
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {recentlyCleared.length > 0 && (
        <section className="recently-cleared">
          <h3 className="section-title">Recently Issued Gate Passes</h3>
          <div className="cleared-list glass-card">
            {recentlyCleared.map(entry => (
              <div key={entry.id} className="cleared-row">
                <div className="cleared-left">
                  <span className="dept-badge small">
                    <Building2 size={10} />
                    {getDeptLabel(entry.dept)}
                  </span>
                  <div>
                    <p className="cleared-party">{entry.partyName || entry.party}</p>
                    <p className="cleared-detail">CH: {entry.challanNo || entry.challan} · {entry.quantity} {entry.unitType || entry.unit || 'pcs'}</p>
                  </div>
                </div>
                <div className="cleared-status">
                  <CheckCircle size={16} />
                  Gate Pass Issued
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {confirmAction && (
        <div className="confirm-overlay">
          <div className="confirm-box glass-card">
            {confirmAction.status === 'guard_cleared' ? (
              <>
                <div className="confirm-icon confirm-approve"><CheckCircle size={32} /></div>
                <h3>Issue Gate Pass?</h3>
                <p>Confirm that you have physically verified the material. The gate pass will be issued and the vehicle will be authorized to exit.</p>
              </>
            ) : (
              <>
                <div className="confirm-icon confirm-reject"><XCircle size={32} /></div>
                <h3>Hold This Challan?</h3>
                <p>The material will not exit. The department will be notified and can edit &amp; re-issue.</p>
                <textarea
                  className="hold-reason-input"
                  placeholder="Reason for hold (optional — visible to department)"
                  value={holdReason}
                  onChange={e => setHoldReason(e.target.value)}
                  rows={2}
                />
              </>
            )}
            <div className="confirm-actions">
              <button className="btn-cancel" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button
                className={confirmAction.status === 'guard_cleared' ? 'btn-confirm-approve' : 'btn-confirm-reject'}
                onClick={confirmUpdate}
              >
                {confirmAction.status === 'guard_cleared' ? 'Yes, Issue Pass' : 'Yes, Hold'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .gpr-page { display: flex; flex-direction: column; gap: 32px; }

        .header-tag { display: flex; align-items: center; gap: 6px; color: #a78bfa; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.1em; }
        .title-area h1 { font-size: 2rem; margin-bottom: 4px; }
        .title-area p { color: var(--text-dim); }

        .req-count-badge { display: flex; flex-direction: column; align-items: center; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.2); border-radius: 20px; padding: 16px 28px; }
        .req-count-badge .count { font-size: 2.5rem; font-weight: 900; color: #a78bfa; line-height: 1; }
        .req-count-badge .count-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #a78bfa; letter-spacing: 0.1em; margin-top: 4px; }

        .empty-gpr { height: 300px; flex-direction: column; gap: 16px; color: var(--secondary); text-align: center; }
        .empty-gpr h3 { font-size: 1.4rem; color: white; }
        .empty-gpr p { color: var(--text-dim); }

        .requests-list { display: flex; flex-direction: column; gap: 20px; }

        .request-card {
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          border: 1px solid rgba(139,92,246,0.2);
          position: relative;
        }

        .req-card-top { display: flex; justify-content: space-between; align-items: center; }
        .req-meta { display: flex; align-items: center; gap: 16px; }

        .dept-badge {
          display: inline-flex; align-items: center; gap: 5px;
          background: rgba(139,92,246,0.1);
          border: 1px solid rgba(139,92,246,0.2);
          color: #a78bfa;
          padding: 5px 12px;
          border-radius: 20px;
          font-size: 0.78rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .dept-badge.small { font-size: 0.68rem; padding: 3px 8px; }

        .req-time { display: flex; align-items: center; gap: 5px; font-size: 0.8rem; color: var(--text-dim); }

        .awaiting-pill {
          background: rgba(245,158,11,0.1);
          border: 1px solid rgba(245,158,11,0.2);
          color: #fbbf24;
          padding: 5px 14px;
          border-radius: 20px;
          font-size: 0.72rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          animation: awaitPulse 2s infinite;
        }
        @keyframes awaitPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }

        .req-card-body { display: flex; flex-direction: column; gap: 16px; }

        .req-party { display: flex; flex-direction: column; gap: 4px; }
        .party-label { font-size: 0.75rem; color: var(--text-dim); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
        .party-name { font-size: 1.6rem; font-weight: 800; color: white; letter-spacing: -0.02em; }

        .challan-row { display: flex; gap: 24px; flex-wrap: wrap; }
        .transport-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 10px; }
        .transport-val { font-size: 0.92rem; color: var(--text-main); font-weight: 600; }
        .challan-item { display: flex; flex-direction: column; gap: 4px; }
        .ch-label { display: flex; align-items: center; gap: 4px; font-size: 0.72rem; color: var(--text-dim); font-weight: 600; text-transform: uppercase; }
        .ch-val { font-family: monospace; font-size: 0.95rem; color: var(--accent); font-weight: 700; }

        .material-highlight {
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .material-heading { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
        .material-desc { font-size: 1.05rem; color: white; line-height: 1.5; font-weight: 500; }
        .qty-display { display: flex; align-items: baseline; gap: 6px; margin-top: 4px; }
        .qty-num { font-size: 2rem; font-weight: 900; color: var(--secondary); }
        .qty-unit { font-size: 1rem; color: var(--text-dim); font-weight: 600; text-transform: uppercase; }

        .guard-notes {
          background: rgba(245,158,11,0.05);
          border: 1px solid rgba(245,158,11,0.15);
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .notes-heading { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; font-weight: 700; color: #fbbf24; text-transform: uppercase; }
        .notes-text { font-size: 0.95rem; color: #fde68a; font-style: italic; line-height: 1.5; }

        .req-card-actions { display: flex; gap: 12px; }

        .action-issue {
          flex: 1;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          padding: 16px;
          background: var(--secondary);
          color: white;
          border: none;
          border-radius: 14px;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          transition: var(--transition);
          box-shadow: 0 8px 20px rgba(16,185,129,0.25);
        }
        .action-issue:hover { filter: brightness(1.1); transform: scale(1.02); }

        .action-reject {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 16px 24px;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border);
          color: var(--text-dim);
          border-radius: 14px;
          font-size: 0.95rem;
          font-weight: 700;
          cursor: pointer;
          transition: var(--transition);
        }
        .action-reject:hover { background: rgba(244,63,94,0.1); color: #fb7185; border-color: rgba(244,63,94,0.2); }

        .recently-cleared { display: flex; flex-direction: column; gap: 16px; }
        .section-title { font-size: 1rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
        .cleared-list { padding: 8px; display: flex; flex-direction: column; }
        .cleared-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); }
        .cleared-row:last-child { border-bottom: none; }
        .cleared-left { display: flex; align-items: center; gap: 14px; }
        .cleared-party { font-weight: 600; font-size: 0.95rem; margin-bottom: 2px; }
        .cleared-detail { font-size: 0.75rem; color: var(--text-dim); }
        .cleared-status { display: flex; align-items: center; gap: 6px; color: var(--secondary); font-weight: 700; font-size: 0.85rem; }

        .confirm-overlay { position: fixed; inset: 0; background: rgba(7,9,13,0.75); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 500; padding: 20px; }
        .confirm-box { max-width: 440px; width: 100%; padding: 36px; display: flex; flex-direction: column; gap: 16px; text-align: center; align-items: center; }
        .confirm-icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
        .confirm-approve { background: rgba(16,185,129,0.1); color: var(--secondary); }
        .confirm-reject { background: rgba(244,63,94,0.1); color: #fb7185; }
        .confirm-box h3 { font-size: 1.4rem; }
        .confirm-box p { color: var(--text-dim); font-size: 0.95rem; line-height: 1.6; }
        .confirm-actions { display: flex; gap: 12px; margin-top: 8px; }
        .btn-cancel { background: rgba(255,255,255,0.05); border: 1px solid var(--border); color: var(--text-dim); padding: 12px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; }
        .btn-confirm-approve { background: var(--secondary); color: white; border: none; padding: 12px 28px; border-radius: 12px; font-weight: 700; cursor: pointer; }
        .btn-confirm-reject { background: rgba(244,63,94,0.8); color: white; border: none; padding: 12px 28px; border-radius: 12px; font-weight: 700; cursor: pointer; }
        .hold-reason-input { width: 100%; background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 10px; color: white; padding: 10px 14px; font-size: 0.9rem; resize: none; font-family: inherit; }
        .hold-reason-input:focus { outline: none; border-color: rgba(244,63,94,0.4); }
        .hold-reason-input::placeholder { color: var(--text-dim); }

        @media (max-width: 768px) {
          .gpr-page { gap: 20px; }
          .page-header { flex-direction: column; align-items: flex-start; gap: 12px; }
          .title-area h1 { font-size: 1.5rem; }
          .req-count-badge { flex-direction: row; gap: 8px; padding: 10px 16px; }
          .req-count-badge .count { font-size: 1.6rem; }
          .request-card { padding: 18px; }
          .party-name { font-size: 1.2rem; }
          .req-card-actions { flex-direction: column; gap: 10px; }
          .action-reject { width: 100%; }
          .challan-row { flex-wrap: wrap; gap: 12px; }
          .confirm-box { padding: 24px; }
          .confirm-actions { flex-direction: column; width: 100%; }
          .btn-cancel, .btn-confirm-approve, .btn-confirm-reject { width: 100%; text-align: center; padding: 14px; }
        }
      `}</style>
    </div>
  );
};

export default GatePassRequests;
