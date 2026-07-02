import React, { useState } from 'react';
import { Search, Clock, CheckCircle, AlertCircle, RefreshCw, ShieldCheck, Database, XCircle, X, Send, ArrowRightCircle, Edit2, Eye, Info } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
import { DEPT_CONFIG, getDeptLabel } from '../constants';

const REISSUE_FIELDS = ['partyName', 'challanNo', 'designNo', 'quantity', 'unitType', 'description', 'processName', 'transportName', 'biltyNo', 'orderNo'];

const DeptView = ({ entries, onUpdateStatus, showToast, selectedDept, guardHeldCount = 0 }) => {
  const [filter, setFilter] = useState(() => guardHeldCount > 0 ? 'issued' : 'pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);
  const [editEntry, setEditEntry] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [viewEntry, setViewEntry] = useState(null);

  const config = DEPT_CONFIG[selectedDept] || {};

  const isIssuedFilter = filter === 'issued';
  const isGuardAction = e => e.status === 'guard_held' ||
    (e.status === 'rejected' && e.initiatedBy === 'dept');

  const filteredEntries = entries.filter(e => {
    if (selectedDept && e.dept !== selectedDept) return false;
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = !searchLower ||
      (e.partyName || e.party || '').toLowerCase().includes(searchLower) ||
      (e.challanNo || e.challan || '').toLowerCase().includes(searchLower) ||
      (e.designNo || e.design || '').toLowerCase().includes(searchLower);
    if (!matchesSearch) return false;

    if (isIssuedFilter) {
      return e.status === 'dept_issued' || e.status === 'guard_cleared' || isGuardAction(e);
    }
    if (e.status === 'dept_issued' || e.status === 'guard_cleared' || isGuardAction(e)) return false;
    return filter === 'all' || e.status === filter;
  });

  const deptEntries = entries.filter(e =>
    e.dept === selectedDept &&
    e.status !== 'dept_issued' &&
    e.status !== 'guard_cleared'
  );

  const stats = {
    pending:      deptEntries.filter(e => e.status === 'pending').length,
    cleared:      deptEntries.filter(e => e.status === 'completed').length,
    awaitingGate: entries.filter(e => e.dept === selectedDept && e.status === 'dept_issued').length,
    guardHeld:    entries.filter(e => e.dept === selectedDept && isGuardAction(e)).length,
    gateCleared:  entries.filter(e => e.dept === selectedDept && e.status === 'guard_cleared').length,
  };

  const requestStatusChange = (id, status) => {
    const labels = { completed: 'Approve Clearance', rejected: 'Put on Hold' };
    setConfirmAction({ id, status, label: labels[status] || status });
  };

  const confirmUpdate = () => {
    onUpdateStatus(confirmAction.id, confirmAction.status);
    setConfirmAction(null);
  };

  const handleDatabaseSync = async () => {
    setIsVerifying(true);
    setSyncMessage(null);

    const toVerify = deptEntries.filter(e => e.status === 'pending' && e.challanNo?.trim());

    if (toVerify.length === 0) {
      setIsVerifying(false);
      setSyncMessage({ type: 'success', text: 'No pending challans to verify against CDH.' });
      setTimeout(() => setSyncMessage(null), 4000);
      return;
    }

    let verified = 0;
    let notFound = 0;
    let cdhDown = false;

    for (const entry of toVerify) {
      try {
        const res = await fetch(`${API_URL}/cdh/challans?challan_no=${encodeURIComponent(entry.challanNo)}`);
        if (res.status === 503) { cdhDown = true; break; }
        if (!res.ok) { notFound++; continue; }
        const data = await res.json();
        const matched = Array.isArray(data)
          ? data.length > 0
          : !!(data?.challan_no || data?.challanNo || data?.data?.challan_no);
        if (matched) {
          await onUpdateStatus(entry.id, 'completed', { cdh_verified: true });
          verified++;
        } else {
          notFound++;
        }
      } catch {
        notFound++;
      }
    }

    setIsVerifying(false);
    if (cdhDown) {
      setSyncMessage({ type: 'error', text: 'CDH is unreachable — verification skipped. Try again when CDH is online.' });
    } else if (verified > 0) {
      setSyncMessage({
        type: 'success',
        text: `CDH Verified — ${verified} challan${verified > 1 ? 's' : ''} matched and cleared.${notFound > 0 ? ` ${notFound} not found in CDH — left pending.` : ''}`,
      });
    } else {
      setSyncMessage({ type: 'warn', text: `No challans matched in CDH — all ${notFound} remain pending for manual review.` });
    }
    setTimeout(() => setSyncMessage(null), 6000);
  };

  return (
    <div className="dept-console">
      <header className="page-header">
        <div className="title-area">
          <div className="header-tag">
            <ShieldCheck size={14} />
            <span>{config.label || 'Department'} — Authorized Access</span>
          </div>
          <h1>Clearance Control Center</h1>
          <p>Review and authorize material movement requests for {config.label || 'this department'}</p>
        </div>
        <div className="header-actions">
          <button
            className={`btn-db-sync ${isVerifying ? 'loading' : ''}`}
            onClick={() => setConfirmSyncOpen(true)}
            disabled={isVerifying}
          >
            <Database size={18} />
            {isVerifying ? 'Verifying...' : 'Verify with Central DB'}
          </button>
          <div className="divider-v" />
          <div className="quick-stats">
            <div className="mini-stat">
              <span className="val">{stats.pending}</span>
              <span className="lab">Pending</span>
            </div>
            <div className="mini-stat">
              <span className="val success">{stats.cleared}</span>
              <span className="lab">Cleared</span>
            </div>
            <div className="mini-stat">
              <span className="val accent">{stats.awaitingGate}</span>
              <span className="lab">At Gate</span>
            </div>
            {stats.guardHeld > 0 && (
              <div className="mini-stat">
                <span className="val held">{stats.guardHeld}</span>
                <span className="lab">Held</span>
              </div>
            )}
            <div className="mini-stat">
              <span className="val dim">{stats.gateCleared}</span>
              <span className="lab">Dispatched</span>
            </div>
          </div>
        </div>
      </header>

      {syncMessage && (
        <div className={`sync-banner sync-${syncMessage.type}`}>
          {syncMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <span>{syncMessage.text}</span>
          <button className="sync-close" onClick={() => setSyncMessage(null)}><X size={14} /></button>
        </div>
      )}

      <div className="console-controls">
        <div className="search-wrapper glass-card">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search by challan number, party name, or design..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="filter-group">
          {[
            { key: 'all',       label: 'All Incoming' },
            { key: 'pending',   label: 'Pending' },
            { key: 'completed', label: 'Cleared' },
            { key: 'rejected',  label: 'On Hold' },
            { key: 'issued',    label: 'Issued Challans' },
          ].map(f => (
            <button
              key={f.key}
              className={`console-tab ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="empty-console flex-center">
          <AlertCircle size={48} />
          <h3>No Clearance Requests</h3>
          <p>There are no pending authorization requests for {config.label || 'this department'} at this time.</p>
        </div>
      ) : (
        <div className="clearance-grid">
          {filteredEntries.map(entry => (
            <div key={entry.id} className={`clearance-card glass-card ${entry.status}`}>
              <div className="card-top">
                <div className="challan-info">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="challan-no">CH: {entry.challanNo || entry.challan}</span>
                    <button 
                      className="btn-icon" 
                      onClick={() => setViewEntry(entry)}
                      title="View Full Details"
                      style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                    >
                      <Eye size={16} />
                    </button>
                  </div>
                  <span className="card-date">{entry.date}</span>
                </div>
                <div className={`status-pill ${entry.status}`}>
                  {entry.status === 'completed'
                    ? <><CheckCircle size={11} /> Cleared</>
                    : isGuardAction(entry)
                    ? <><XCircle size={11} /> Held by Guard</>
                    : entry.status === 'rejected'
                    ? <><XCircle size={11} /> On Hold</>
                    : entry.status === 'dept_issued'
                    ? <><Send size={11} /> Awaiting Gate</>
                    : entry.status === 'guard_cleared'
                    ? <><ArrowRightCircle size={11} /> Dispatched</>
                    : <><Clock size={11} /> Pending</>}
                </div>
              </div>

              <div className="card-body">
                <h3 className="party-name">{entry.partyName || entry.party}</h3>
                <div className="material-chips">
                  <div className="detail-chip">
                    <span className="chip-label">Qty</span>
                    <span className="chip-value">{entry.quantity} {entry.unitType || entry.unit}</span>
                  </div>
                  {(entry.designNo || entry.design) && (
                    <div className="detail-chip">
                      <span className="chip-label">Design</span>
                      <span className="chip-value">{entry.designNo || entry.design}</span>
                    </div>
                  )}
                  <div className="detail-chip">
                    <span className="chip-label">Type</span>
                    <span className="chip-value" style={{ textTransform: 'capitalize' }}>{entry.type}</span>
                  </div>
                </div>
                {(entry.description || entry.goodsDescription) && (
                  <p className="card-description">{entry.description || entry.goodsDescription}</p>
                )}
                
                {entry.processName && (
                  <div style={{ marginTop: '6px', fontSize: '0.85rem', color: 'var(--accent)' }}>
                    <strong>Process:</strong> {entry.processName}
                  </div>
                )}
                {isGuardAction(entry) && entry.guardHoldReason && (
                  <div className="guard-hold-reason">
                    <XCircle size={13} />
                    <span><strong>Guard's Reason:</strong> {entry.guardHoldReason}</span>
                  </div>
                )}
                <div className="logistics-row">
                  <RefreshCw size={13} />
                  <span>Transport: {entry.transportName || 'Direct Delivery'}</span>
                </div>
              </div>

              <div className="card-actions">
                {entry.status === 'pending' ? (
                  <>
                    <button className="action-btn approve" onClick={() => requestStatusChange(entry.id, 'completed')}>
                      <CheckCircle size={17} /> Approve
                    </button>
                    <button className="action-btn reject" onClick={() => requestStatusChange(entry.id, 'rejected')}>
                      <XCircle size={17} /> Hold
                    </button>
                  </>
                ) : entry.status === 'completed' ? (
                  <div className="cleared-indicator">
                    <CheckCircle size={18} />
                    <span>Authorized</span>
                  </div>
                ) : entry.status === 'dept_issued' ? (
                  <div className="awaiting-indicator">
                    <Send size={16} />
                    <span>Sent to Gate — Awaiting Guard Clearance</span>
                  </div>
                ) : isGuardAction(entry) ? (
                  <button
                    className="action-btn reissue"
                    onClick={() => { setEditForm({ ...entry }); setEditEntry(entry); }}
                  >
                    <Edit2 size={16} /> Edit &amp; Re-issue to Gate
                  </button>
                ) : entry.status === 'guard_cleared' ? (
                  <div className="dispatched-indicator">
                    <ArrowRightCircle size={16} />
                    <span>Gate Cleared — Dispatched</span>
                  </div>
                ) : (
                  <div className="held-indicator">
                    <XCircle size={18} />
                    <span>On Hold</span>
                    <button
                      className="action-btn approve"
                      style={{ marginLeft: 'auto', flex: 'none', padding: '8px 16px', fontSize: '0.82rem' }}
                      onClick={() => requestStatusChange(entry.id, 'completed')}
                    >
                      <CheckCircle size={14} /> Release
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editEntry && (
        <div className="confirm-overlay">
          <div className="reissue-modal glass-card">
            <div className="reissue-header">
              <div>
                <h3>Edit &amp; Re-issue Challan</h3>
                <p>Correct the details and re-send to gate for guard verification</p>
              </div>
              <button className="sync-close" onClick={() => setEditEntry(null)}><X size={18} /></button>
            </div>

            {editEntry.guardHoldReason && (
              <div className="guard-hold-reason modal-reason">
                <XCircle size={13} />
                <span><strong>Guard held because:</strong> {editEntry.guardHoldReason}</span>
              </div>
            )}

            <div className="reissue-form">
              {[
                { key: 'partyName',     label: 'Party Name' },
                { key: 'challanNo',     label: 'Challan No.' },
                { key: 'designNo',      label: 'Design No.' },
                { key: 'orderNo',       label: 'Order No.' },
                { key: 'transportName', label: 'Transport' },
                { key: 'biltyNo',       label: 'Bilty / LR No.' },
                { key: 'description',   label: 'Description' },
                { key: 'processName',   label: 'Process / Purpose' },
              ].map(({ key, label }) => (
                <div key={key} className="reissue-field">
                  <label>{label}</label>
                  <input
                    value={editForm[key] || ''}
                    onChange={e => setEditForm(prev => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="reissue-qty-row">
                <div className="reissue-field">
                  <label>Quantity</label>
                  <input
                    type="number"
                    value={editForm.quantity || ''}
                    onChange={e => setEditForm(prev => ({ ...prev, quantity: e.target.value }))}
                  />
                </div>
                <div className="reissue-field">
                  <label>Unit</label>
                  <select
                    value={editForm.unitType || 'pcs'}
                    onChange={e => setEditForm(prev => ({ ...prev, unitType: e.target.value }))}
                  >
                    {['pcs', 'pkg', 'parcel', 'kg', 'meter'].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="confirm-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn-cancel" onClick={() => setEditEntry(null)}>Cancel</button>
              <button
                className="action-btn approve"
                style={{ flex: 'none', padding: '12px 28px' }}
                onClick={() => {
                  const fields = {};
                  REISSUE_FIELDS.forEach(f => { if (editForm[f] !== undefined) fields[f] = editForm[f]; });
                  onUpdateStatus(editEntry.id, 'dept_issued', { ...fields, guardHoldReason: '' });
                  setEditEntry(null);
                }}
              >
                <Send size={15} /> Re-issue to Gate
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSyncOpen && (
        <div className="confirm-overlay">
          <div className="confirm-box glass-card">
            <div className="confirm-icon confirm-warn">
              <Database size={28} />
            </div>
            <h3>Verify Challans with CDH?</h3>
            <p>This will look up each pending challan in the Central Data Hub. Matched challans are auto-cleared. Unmatched ones stay pending for manual review.</p>
            <div className="confirm-actions">
              <button className="btn-cancel" onClick={() => setConfirmSyncOpen(false)}>Cancel</button>
              <button
                className="btn-confirm-approve"
                onClick={() => { setConfirmSyncOpen(false); handleDatabaseSync(); }}
              >
                Yes, Verify with CDH
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="confirm-overlay">
          <div className="confirm-box glass-card">
            <h3>Confirm Authorization</h3>
            <p>
              {confirmAction.status === 'completed'
                ? 'This entry will be approved and the gate pass will be authorized for release.'
                : 'This entry will be placed on hold. The gate pass will not be issued until released.'}
            </p>
            <div className="confirm-actions">
              <button className="btn-cancel" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button
                className={`action-btn ${confirmAction.status === 'completed' ? 'approve' : 'reject'}`}
                style={{ flex: 'none', padding: '12px 28px' }}
                onClick={confirmUpdate}
              >
                {confirmAction.status === 'completed'
                  ? <><CheckCircle size={15} /> Approve</>
                  : <><XCircle size={15} /> Put on Hold</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewEntry && (
        <div className="confirm-overlay">
          <div className="reissue-modal glass-card" style={{ maxWidth: '640px' }}>
            <div className="reissue-header">
              <div>
                <h3>Challan Details</h3>
                <p>Full record for CH: {viewEntry.challanNo || viewEntry.challan}</p>
              </div>
              <button className="sync-close" onClick={() => setViewEntry(null)}><X size={18} /></button>
            </div>
            
            <div className="details-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '10px' }}>
               {Object.entries(viewEntry).filter(([k, v]) => v !== null && v !== '' && v !== undefined).map(([key, val]) => (
                 <div key={key} className="detail-item" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                   <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 'bold', letterSpacing: '0.05em' }}>
                     {key.replace(/([A-Z])/g, ' $1').trim()}
                   </div>
                   <div style={{ fontSize: '0.95rem', wordBreak: 'break-word', color: 'white' }}>
                     {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}
                   </div>
                 </div>
               ))}
            </div>
            
            <div className="confirm-actions" style={{ marginTop: '24px' }}>
              <button className="btn-cancel" onClick={() => setViewEntry(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .dept-console { display: flex; flex-direction: column; gap: 28px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; }

        .header-tag { display: flex; align-items: center; gap: 6px; color: var(--secondary); font-size: 0.7rem; font-weight: 700; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.08em; }
        .title-area h1 { font-size: 2.2rem; margin-bottom: 4px; letter-spacing: -0.02em; }
        .title-area p { color: var(--text-dim); font-size: 0.95rem; }

        .header-actions { display: flex; align-items: center; gap: 24px; flex-shrink: 0; }
        .btn-db-sync { background: var(--primary); color: white; border: none; padding: 12px 20px; border-radius: 12px; display: flex; align-items: center; gap: 10px; font-weight: 600; cursor: pointer; transition: var(--transition); box-shadow: 0 8px 20px var(--primary-glow); font-size: 0.9rem; }
        .btn-db-sync:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.1); }
        .btn-db-sync:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-db-sync.loading svg { animation: spin 1.5s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .sync-banner { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-radius: 12px; font-size: 0.9rem; font-weight: 500; }
        .sync-success { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); color: var(--secondary); }
        .sync-warn  { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); color: #fbbf24; }
        .sync-error { background: rgba(244,63,94,0.08);  border: 1px solid rgba(244,63,94,0.2);  color: #fb7185; }
        .sync-close { background: none; border: none; color: inherit; cursor: pointer; margin-left: auto; opacity: 0.6; display: flex; }
        .sync-close:hover { opacity: 1; }

        .divider-v { width: 1px; height: 40px; background: var(--border); }
        .quick-stats { display: flex; gap: 28px; }
        .mini-stat { display: flex; flex-direction: column; align-items: center; }
        .mini-stat .val { font-size: 1.6rem; font-weight: 800; }
        .mini-stat .val.success { color: var(--secondary); }
        .mini-stat .val.accent { color: var(--accent); }
        .mini-stat .val.dim { color: var(--text-dim); }
        .mini-stat .lab { font-size: 0.7rem; text-transform: uppercase; color: var(--text-dim); font-weight: 700; letter-spacing: 0.05em; }

        .console-controls { display: flex; gap: 16px; align-items: center; }
        .search-wrapper { flex: 1; display: flex; align-items: center; padding: 13px 20px; gap: 12px; border-radius: 16px; }
        .search-icon { color: var(--text-dim); flex-shrink: 0; }
        .search-wrapper input { background: none; border: none; color: white; width: 100%; font-size: 0.95rem; }
        .search-wrapper input:focus { outline: none; }
        .search-wrapper input::placeholder { color: var(--text-dim); }

        .filter-group { display: flex; gap: 6px; background: rgba(0,0,0,0.3); padding: 5px; border-radius: 12px; border: 1px solid var(--border); }
        .console-tab { padding: 8px 18px; border: none; background: none; color: var(--text-dim); font-size: 0.85rem; font-weight: 600; cursor: pointer; border-radius: 9px; transition: var(--transition); }
        .console-tab.active { background: white; color: #0f172a; }

        .clearance-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; }

        .clearance-card { padding: 24px; display: flex; flex-direction: column; gap: 20px; border: 1px solid var(--border); transition: var(--transition); }
        .clearance-card.completed { border-color: rgba(16,185,129,0.25); }
        .clearance-card.rejected { border-color: rgba(244,63,94,0.2); }

        .card-top { display: flex; justify-content: space-between; align-items: flex-start; }
        .challan-info { display: flex; flex-direction: column; gap: 3px; }
        .challan-no { font-family: monospace; font-size: 0.9rem; color: var(--accent); font-weight: 700; }
        .card-date { font-size: 0.72rem; color: var(--text-dim); }

        .status-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; padding: 5px 12px; border-radius: 30px; letter-spacing: 0.04em; }
        .status-pill.pending { background: rgba(245,158,11,0.1); color: var(--accent); border: 1px solid rgba(245,158,11,0.2); }
        .status-pill.completed { background: rgba(16,185,129,0.1); color: var(--secondary); border: 1px solid rgba(16,185,129,0.2); }
        .status-pill.rejected { background: rgba(244,63,94,0.1); color: #fb7185; border: 1px solid rgba(244,63,94,0.2); }
        .status-pill.dept_issued { background: rgba(99,102,241,0.1); color: var(--primary); border: 1px solid rgba(99,102,241,0.2); }
        .status-pill.guard_cleared { background: rgba(16,185,129,0.12); color: var(--secondary); border: 1px solid rgba(16,185,129,0.3); }

        .party-name { font-size: 1.3rem; font-weight: 700; }
        .material-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
        .detail-chip { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.04); padding: 5px 11px; border-radius: 8px; font-size: 0.82rem; border: 1px solid var(--border); }
        .chip-label { color: var(--text-dim); font-weight: 500; }
        .chip-value { font-weight: 700; }
        .card-description { font-size: 0.88rem; color: var(--text-dim); line-height: 1.5; }
        .logistics-row { display: flex; align-items: center; gap: 7px; font-size: 0.82rem; color: var(--text-dim); border-top: 1px solid var(--border); padding-top: 14px; }

        .card-actions { display: flex; gap: 10px; }
        .action-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; border-radius: 12px; font-weight: 700; cursor: pointer; transition: var(--transition); border: 1px solid transparent; font-size: 0.9rem; }
        .action-btn.approve { background: var(--secondary); color: white; }
        .action-btn.approve:hover { filter: brightness(1.1); }
        .action-btn.reject { background: rgba(255,255,255,0.03); color: var(--text-dim); border-color: var(--border); }
        .action-btn.reject:hover { background: rgba(244,63,94,0.1); color: #fb7185; border-color: rgba(244,63,94,0.25); }

        .cleared-indicator { width: 100%; background: rgba(16,185,129,0.05); color: var(--secondary); padding: 13px; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; font-size: 0.9rem; border: 1px dashed rgba(16,185,129,0.3); }
        .held-indicator { width: 100%; background: rgba(244,63,94,0.04); color: #fb7185; padding: 13px; border-radius: 12px; display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.9rem; border: 1px dashed rgba(244,63,94,0.25); }
        .awaiting-indicator { width: 100%; background: rgba(99,102,241,0.05); color: var(--primary); padding: 13px; border-radius: 12px; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.85rem; border: 1px dashed rgba(99,102,241,0.25); }
        .dispatched-indicator { width: 100%; background: rgba(16,185,129,0.05); color: var(--secondary); padding: 13px; border-radius: 12px; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.85rem; border: 1px dashed rgba(16,185,129,0.3); }
        .action-btn.reissue { background: rgba(245,158,11,0.1); color: #fbbf24; border-color: rgba(245,158,11,0.25); }
        .action-btn.reissue:hover { background: rgba(245,158,11,0.18); }

        .status-pill.guard_held { background: rgba(244,63,94,0.1); color: #fb7185; border: 1px solid rgba(244,63,94,0.25); }
        .mini-stat .val.held { color: #fb7185; }
        .guard-hold-reason { display: flex; align-items: flex-start; gap: 7px; background: rgba(244,63,94,0.06); border: 1px solid rgba(244,63,94,0.15); border-radius: 10px; padding: 10px 12px; font-size: 0.82rem; color: #fca5a5; line-height: 1.5; }
        .guard-hold-reason.modal-reason { margin-bottom: 4px; }

        .reissue-modal { max-width: 560px; width: 100%; padding: 32px; display: flex; flex-direction: column; gap: 20px; }
        .reissue-header { display: flex; justify-content: space-between; align-items: flex-start; }
        .reissue-header h3 { font-size: 1.25rem; margin-bottom: 4px; }
        .reissue-header p { color: var(--text-dim); font-size: 0.88rem; }
        .reissue-form { display: flex; flex-direction: column; gap: 12px; }
        .reissue-field { display: flex; flex-direction: column; gap: 5px; }
        .reissue-field label { font-size: 0.75rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
        .reissue-field input, .reissue-field select { background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 10px; color: white; padding: 10px 14px; font-size: 0.92rem; font-family: inherit; }
        .reissue-field input:focus, .reissue-field select:focus { outline: none; border-color: rgba(245,158,11,0.4); }
        .reissue-field select option { background: #1e293b; }
        .reissue-qty-row { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }

        .empty-console { padding: 100px 40px; flex-direction: column; text-align: center; color: var(--text-dim); gap: 16px; }
        .empty-console h3 { font-size: 1.4rem; color: white; }
        .empty-console p { font-size: 0.9rem; max-width: 360px; }

        .confirm-overlay { position: fixed; inset: 0; background: rgba(7,9,13,0.72); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; z-index: 500; padding: 20px; }
        .confirm-box { max-width: 420px; width: 100%; padding: 32px; display: flex; flex-direction: column; gap: 18px; }
        .confirm-box h3 { font-size: 1.25rem; }
        .confirm-box p { color: var(--text-dim); font-size: 0.92rem; line-height: 1.6; }
        .confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }
        .btn-cancel { background: rgba(255,255,255,0.05); border: 1px solid var(--border); color: var(--text-dim); padding: 11px 22px; border-radius: 11px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
        .btn-cancel:hover { background: rgba(255,255,255,0.09); color: var(--text-main); }
        .confirm-icon { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto; }
        .confirm-warn { background: rgba(245,158,11,0.12); color: #fbbf24; }
        .btn-confirm-approve { background: var(--secondary); color: white; border: none; padding: 11px 24px; border-radius: 11px; font-weight: 700; cursor: pointer; font-size: 0.9rem; }
        .btn-confirm-approve:hover { filter: brightness(1.1); }
      `}</style>
    </div>
  );
};

export default DeptView;
