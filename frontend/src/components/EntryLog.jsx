import React, { useState } from 'react';
import { Search, Filter, Download, Eye, MoreVertical, Truck, Package, X, User, FileText, Trash2, AlertCircle, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getStatusLabel, getStatusBadgeClass, getDeptLabel } from '../constants';

const FIELD_LABELS = {
  partyName: 'Party Name', challanNo: 'Challan No.', biltyNo: 'Bilty No.',
  transportName: 'Transport', designNo: 'Design No.', orderNo: 'Order No.',
  quantity: 'Quantity', parcelFrom: 'From / Destination', description: 'Description',
};

const printEntry = (entry) => {
  const win = window.open('', '_blank', 'width=720,height=620');
  const statusLabel = entry.status === 'completed' ? 'Cleared' : entry.status === 'rejected' ? 'On Hold' : 'Pending';
  win.document.write(`<!DOCTYPE html><html><head>
    <title>Gate Pass — ${entry.challanNo || entry.challan || 'N/A'}</title>
    <style>
      body { font-family: 'Segoe UI', sans-serif; padding: 40px; color: #1e293b; max-width: 620px; margin: 0 auto; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      .meta { color: #64748b; font-size: 13px; margin-bottom: 28px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 32px; }
      .field .lbl { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; margin-bottom: 4px; }
      .field .val { font-size: 15px; font-weight: 600; }
      hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
      .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; }
      .badge.completed { background: #dcfce7; color: #16a34a; }
      .badge.pending { background: #fef9c3; color: #ca8a04; }
      .badge.rejected { background: #fee2e2; color: #dc2626; }
      @media print { body { padding: 20px; } }
    </style>
  </head><body>
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin-bottom:6px">Shree Radha Studio</div>
    <h1>Gate Pass</h1>
    <p class="meta">${entry.type === 'incoming' ? 'Incoming Material' : 'Outgoing Material'} &nbsp;|&nbsp; Date: ${entry.date || 'N/A'}</p>
    <div class="grid">
      <div class="field"><div class="lbl">Party Name</div><div class="val">${entry.partyName || entry.party || 'N/A'}</div></div>
      <div class="field"><div class="lbl">Challan No.</div><div class="val">${entry.challanNo || entry.challan || 'N/A'}</div></div>
      <div class="field"><div class="lbl">Transport</div><div class="val">${entry.transportName || 'Direct Delivery'}</div></div>
      <div class="field"><div class="lbl">Bilty No.</div><div class="val">${entry.biltyNo || 'N/A'}</div></div>
      <div class="field"><div class="lbl">Design No.</div><div class="val">${entry.designNo || entry.design || 'N/A'}</div></div>
      <div class="field"><div class="lbl">Order No.</div><div class="val">${entry.orderNo || 'N/A'}</div></div>
      <div class="field"><div class="lbl">Quantity</div><div class="val">${entry.quantity || 'N/A'} ${entry.unitType || entry.unit || ''}</div></div>
      <div class="field"><div class="lbl">From / Destination</div><div class="val">${entry.parcelFrom || 'N/A'}</div></div>
      <div class="field"><div class="lbl">Department</div><div class="val" style="text-transform:capitalize">${entry.dept || 'N/A'}</div></div>
    </div>
    <hr/>
    <div class="field"><div class="lbl">Description</div><div class="val" style="font-weight:400;font-size:14px;line-height:1.6">${entry.description || 'No description provided.'}</div></div>
    <hr/>
    <div class="field"><div class="lbl">Status</div><span class="badge ${entry.status}">${statusLabel}</span></div>
    <script>setTimeout(function(){ window.print(); window.close(); }, 400);<\/script>
  </body></html>`);
  win.document.close();
};

const DetailModal = ({ entry, onClose }) => {
  if (!entry) return null;
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="detail-modal glass-card"
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">
            <div className={`type-tag ${entry.type}`}>
              {entry.type === 'incoming' ? 'Incoming Material' : 'Outgoing Material'}
            </div>
            <h2>Transaction Details</h2>
          </div>
          <button className="close-modal" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="modal-scroll-content">
          <div className="detail-section">
            <h3 className="section-title"><User size={18} /> Party Information</h3>
            <div className="detail-grid">
              <div className="info-block"><span className="label">Party Name</span><p className="value">{entry.partyName || entry.party}</p></div>
              <div className="info-block"><span className="label">Date of Entry</span><p className="value">{entry.date}</p></div>
              <div className="info-block"><span className="label">Department</span><p className="value" style={{ textTransform: 'capitalize' }}>{entry.dept || 'N/A'}</p></div>
              <div className="info-block"><span className="label">Current Status</span>
                <div className={`status-pill ${entry.status}`}>
                  {entry.status === 'completed' ? 'Cleared' : entry.status === 'rejected' ? 'On Hold' : 'Pending Verification'}
                </div>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h3 className="section-title"><FileText size={18} /> Logistics & Documents</h3>
            <div className="detail-grid">
              <div className="info-block"><span className="label">Challan Number</span><p className="value highlight">#{entry.challanNo || entry.challan}</p></div>
              <div className="info-block"><span className="label">Bilty Number</span><p className="value">{entry.biltyNo || 'Not Provided'}</p></div>
              <div className="info-block"><span className="label">Transport Name</span><p className="value">{entry.transportName || 'Direct Delivery'}</p></div>
              <div className="info-block"><span className="label">Source / From</span><p className="value">{entry.parcelFrom || 'N/A'}</p></div>
            </div>
          </div>

          <div className="detail-section">
            <h3 className="section-title"><Package size={18} /> Material Details</h3>
            <div className="detail-grid">
              <div className="info-block"><span className="label">Quantity</span><p className="value">{entry.quantity} {entry.unitType || entry.unit || 'pcs'}</p></div>
              <div className="info-block"><span className="label">Order Number</span><p className="value">{entry.orderNo || 'N/A'}</p></div>
              <div className="info-block"><span className="label">Design Number</span><p className="value">{entry.designNo || 'N/A'}</p></div>
              <div className="info-block"><span className="label">Process / Purpose</span><p className="value">{entry.processName || 'N/A'}</p></div>
            </div>
            <div className="description-block">
              <span className="label">Goods Description</span>
              <p className="value-box">{entry.description || 'No additional description provided.'}</p>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-print" onClick={() => printEntry(entry)}>
            <Download size={18} /> Export as PDF
          </button>
          <button className="btn-primary" onClick={onClose}>Close Details</button>
        </div>
      </motion.div>

      <style>{`
        .modal-backdrop { position: fixed; inset: 0; background: rgba(7, 9, 13, 0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
        .detail-modal { width: 100%; max-width: 650px; max-height: 90vh; background: #1e293b; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; padding: 0; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
        .modal-header { padding: 24px 32px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); }
        .type-tag { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; padding: 4px 10px; border-radius: 6px; margin-bottom: 8px; display: inline-block; }
        .type-tag.incoming { background: rgba(16, 185, 129, 0.1); color: #10b981; }
        .type-tag.outgoing { background: rgba(99, 102, 241, 0.1); color: #6366f1; }
        .modal-title h2 { font-size: 1.5rem; letter-spacing: -0.02em; }
        .close-modal { background: none; border: none; color: #94a3b8; cursor: pointer; transition: 0.2s; }
        .close-modal:hover { color: white; transform: rotate(90deg); }
        .modal-scroll-content { padding: 32px; overflow-y: auto; display: flex; flex-direction: column; gap: 32px; }
        .section-title { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 20px; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        .info-block .label { display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 6px; font-weight: 600; }
        .info-block .value { font-size: 1rem; font-weight: 600; color: #f1f5f9; }
        .info-block .value.highlight { color: #f59e0b; font-family: monospace; font-size: 1.1rem; }
        .status-pill { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; background: rgba(245,158,11,0.1); color: #fbbf24; }
        .status-pill.completed { background: rgba(16,185,129,0.1); color: #10b981; }
        .status-pill.rejected { background: rgba(244,63,94,0.1); color: #fb7185; }
        .description-block { margin-top: 24px; }
        .value-box { background: rgba(0,0,0,0.2); padding: 16px; border-radius: 12px; font-size: 0.95rem; color: #cbd5e1; line-height: 1.6; border: 1px solid rgba(255,255,255,0.05); }
        .modal-footer { padding: 24px 32px; background: rgba(255,255,255,0.02); border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: flex-end; gap: 12px; }
        .btn-print { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 10px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; }
      `}</style>
    </motion.div>
  );
};

const EntryLog = ({ entries = [], onDeleteEntry }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [showFilter, setShowFilter] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [openOptionsId, setOpenOptionsId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const filteredEntries = entries.filter(entry => {
    const matchSearch =
      (entry.partyName || entry.party || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (entry.challanNo || entry.challan || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (entry.transportName || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchType = typeFilter === 'all' || entry.type === typeFilter;
    const matchStatus = statusFilter === 'all' || entry.status === statusFilter;
    const matchDate = (!dateFrom || entry.date >= dateFrom) && (!dateTo || entry.date <= dateTo);
    return matchSearch && matchType && matchStatus && matchDate;
  });

  const exportCSV = () => {
    const headers = ['Date', 'Type', 'Party Name', 'Challan No', 'Bilty No', 'Transport', 'Design No', 'Order No', 'Quantity', 'Unit', 'Dept', 'Description', 'Status'];
    const rows = filteredEntries.map(e => [
      e.date || '', e.type || '',
      e.partyName || e.party || '',
      e.challanNo || e.challan || '',
      e.biltyNo || '', e.transportName || '',
      e.designNo || e.design || '',
      e.orderNo || '', e.quantity || '',
      e.unitType || e.unit || '',
      e.dept || '', e.description || '', e.status || ''
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `srs-gatepass-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDelete = (id) => {
    setDeleteConfirmId(null);
    setOpenOptionsId(null);
    if (onDeleteEntry) onDeleteEntry(id);
  };

  const activeFiltersCount = (typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);

  return (
    <div className="entry-log" onClick={() => setOpenOptionsId(null)}>
      <header className="page-header">
        <div className="title-area">
          <h1>Material Movement Logs</h1>
          <p>Complete history of all incoming and outgoing material transactions</p>
        </div>
        <div className="log-actions">
          <button className="btn-secondary flex-center gap-2" onClick={exportCSV}>
            <Download size={18} /> Export CSV
          </button>
        </div>
      </header>

      <div className="glass-card table-container">
        <div className="table-header">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search by party, challan, or transport..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            className={`btn-filter ${showFilter ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setShowFilter(v => !v); }}
          >
            <Filter size={18} /> Filter
            {activeFiltersCount > 0 && <span className="filter-count">{activeFiltersCount}</span>}
            <ChevronDown size={14} className={`filter-chevron ${showFilter ? 'open' : ''}`} />
          </button>
        </div>

        {showFilter && (
          <div className="filter-panel" onClick={(e) => e.stopPropagation()}>
            <div className="filter-row">
              <span className="filter-label">Type:</span>
              {['all', 'incoming', 'outgoing'].map(t => (
                <button key={t} className={`filter-chip ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>
                  {t === 'all' ? 'All' : t === 'incoming' ? 'Incoming' : 'Outgoing'}
                </button>
              ))}
            </div>
            <div className="filter-row">
              <span className="filter-label">Status:</span>
              {[
                { val: 'all',           label: 'All' },
                { val: 'pending',       label: 'Pending' },
                { val: 'completed',     label: 'Cleared' },
                { val: 'rejected',      label: 'On Hold' },
                { val: 'dept_issued',   label: 'At Gate' },
                { val: 'guard_held',    label: 'Held by Guard' },
                { val: 'guard_cleared', label: 'Dispatched' },
              ].map(({ val, label }) => (
                <button key={val} className={`filter-chip ${statusFilter === val ? 'active' : ''}`} onClick={() => setStatusFilter(val)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="filter-row">
              <span className="filter-label">Date:</span>
              <input
                type="date"
                className="date-input"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                title="From date"
              />
              <span className="date-sep">→</span>
              <input
                type="date"
                className="date-input"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                title="To date"
              />
              {(dateFrom || dateTo) && (
                <button className="clear-filters" onClick={() => { setDateFrom(''); setDateTo(''); }}>
                  <X size={12} /> Clear
                </button>
              )}
            </div>
            {activeFiltersCount > 0 && (
              <button className="clear-filters" onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setDateFrom(''); setDateTo(''); }}>
                <X size={12} /> Clear All Filters
              </button>
            )}
          </div>
        )}

        {deleteConfirmId && (
          <div className="delete-confirm-bar" onClick={(e) => e.stopPropagation()}>
            <AlertCircle size={16} className="warn-icon" />
            <span>This entry will be permanently deleted. Are you sure?</span>
            <button className="del-confirm-btn" onClick={() => handleDelete(deleteConfirmId)}>Yes, Delete</button>
            <button className="del-cancel-btn" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
          </div>
        )}

        <table className="log-table">
          <thead>
            <tr>
              <th>Date / Party</th>
              <th>Challan / Bilty</th>
              <th>Transport</th>
              <th>Material Details</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <div className="entity-info">
                    <div className={`type-indicator ${entry.type}`}>
                      {entry.type === 'incoming' ? 'IN' : 'OUT'}
                    </div>
                    <div className="entity-text">
                      <p className="name">{entry.partyName || entry.party}</p>
                      <p className="date">{entry.date}</p>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="code-stack">
                    <code className="challan-code">CH: {entry.challanNo || entry.challan}</code>
                    <p className="bilty">Bilty: {entry.biltyNo || 'N/A'}</p>
                  </div>
                </td>
                <td>
                  <div className="transport-info">
                    <Truck size={14} />
                    <span>{entry.transportName || 'Direct'}</span>
                  </div>
                </td>
                <td>
                  <div className="material-info">
                    <div className="qty-tag">
                      <Package size={12} />
                      {entry.quantity} {entry.unitType || entry.unit || 'pcs'}
                    </div>
                    <p className="design">Design: {entry.designNo || entry.design || 'N/A'}</p>
                    {entry.processName && (
                      <p className="design" style={{ color: 'var(--accent)' }}>Process: {entry.processName}</p>
                    )}
                  </div>
                </td>
                <td>
                  <div className="status-col">
                    <div className={`badge ${getStatusBadgeClass(entry.status)}`}>
                      {getStatusLabel(entry.status)}
                    </div>
                    {entry.cdh_verified && (
                      <span className="cdh-verified-tag">CDH</span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="action-cell" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" title="View Details" onClick={() => setSelectedEntry(entry)}>
                      <Eye size={18} />
                    </button>
                    <div className="options-wrap">
                      <button
                        className="icon-btn"
                        title="Options"
                        onClick={() => setOpenOptionsId(openOptionsId === entry.id ? null : entry.id)}
                      >
                        <MoreVertical size={18} />
                      </button>
                      {openOptionsId === entry.id && (
                        <div className="options-dropdown">
                          <button
                            className="opt-item danger"
                            onClick={() => { setDeleteConfirmId(entry.id); setOpenOptionsId(null); }}
                          >
                            <Trash2 size={14} /> Delete Entry
                          </button>
                          <button className="opt-item" onClick={() => { printEntry(entry); setOpenOptionsId(null); }}>
                            <Download size={14} /> Export PDF
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredEntries.length === 0 && (
          <div className="empty-state flex-center">
            <p>No transactions match your current search or filter criteria.</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedEntry && (
          <DetailModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
        )}
      </AnimatePresence>

      <style>{`
        .entry-log { display: flex; flex-direction: column; gap: 24px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-end; }
        .title-area h1 { font-size: 2rem; margin-bottom: 4px; }
        .title-area p { color: var(--text-dim); }

        .table-container { padding: 0; overflow: hidden; }
        .table-header { padding: 20px 24px; border-bottom: 1px solid var(--border); display: flex; gap: 16px; align-items: center; }

        .search-box { flex: 1; position: relative; }
        .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-dim); }
        .search-box input { width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--border); padding: 10px 10px 10px 44px; border-radius: 12px; color: var(--text-main); }
        .search-box input:focus { outline: none; border-color: var(--primary); }

        .btn-filter { background: rgba(255,255,255,0.05); border: 1px solid var(--border); color: var(--text-main); padding: 10px 16px; border-radius: 12px; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: var(--transition); }
        .btn-filter.active { border-color: var(--primary); color: var(--primary); background: rgba(99,102,241,0.08); }
        .filter-count { background: var(--primary); color: white; font-size: 0.7rem; font-weight: 700; padding: 1px 6px; border-radius: 10px; }
        .filter-chevron { transition: transform 0.2s; }
        .filter-chevron.open { transform: rotate(180deg); }

        .filter-panel { padding: 16px 24px; border-bottom: 1px solid var(--border); background: rgba(0,0,0,0.2); display: flex; flex-direction: column; gap: 12px; }
        .filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .filter-label { font-size: 0.8rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; min-width: 50px; }
        .filter-chip { padding: 6px 14px; border-radius: 20px; border: 1px solid var(--border); background: none; color: var(--text-dim); font-size: 0.85rem; cursor: pointer; transition: var(--transition); font-weight: 500; }
        .filter-chip.active { background: var(--primary); color: white; border-color: var(--primary); }
        .filter-chip:hover:not(.active) { border-color: var(--primary); color: var(--text-main); }
        .clear-filters { display: flex; align-items: center; gap: 4px; background: none; border: none; color: #fb7185; font-size: 0.8rem; cursor: pointer; font-weight: 600; padding: 0; }

        .delete-confirm-bar { padding: 14px 24px; border-bottom: 1px solid var(--border); background: rgba(244, 63, 94, 0.05); display: flex; align-items: center; gap: 12px; border-left: 3px solid #fb7185; }
        .warn-icon { color: #fb7185; flex-shrink: 0; }
        .delete-confirm-bar span { flex: 1; font-size: 0.9rem; color: #fb7185; }
        .del-confirm-btn { background: #fb7185; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.85rem; }
        .del-cancel-btn { background: rgba(255,255,255,0.05); border: 1px solid var(--border); color: var(--text-dim); padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.85rem; }

        .log-table { width: 100%; border-collapse: collapse; text-align: left; }
        .log-table th { padding: 16px 24px; background: rgba(255,255,255,0.02); color: var(--text-dim); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; border-bottom: 1px solid var(--border); }
        .log-table td { padding: 16px 24px; border-bottom: 1px solid var(--border); font-size: 0.9rem; vertical-align: middle; }
        .log-table tr:hover { background: rgba(255,255,255,0.02); }

        .entity-info { display: flex; align-items: center; gap: 12px; }
        .type-indicator { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 800; flex-shrink: 0; }
        .type-indicator.incoming { background: rgba(16,185,129,0.1); color: var(--secondary); border: 1px solid rgba(16,185,129,0.2); }
        .type-indicator.outgoing { background: rgba(99,102,241,0.1); color: var(--primary); border: 1px solid rgba(99,102,241,0.2); }

        .entity-text .name { font-weight: 600; margin-bottom: 2px; }
        .entity-text .date { font-size: 0.75rem; color: var(--text-dim); }

        .code-stack { display: flex; flex-direction: column; gap: 4px; }
        .challan-code { font-family: monospace; color: var(--accent); font-weight: 700; font-size: 0.85rem; }
        .bilty { font-size: 0.75rem; color: var(--text-dim); }

        .transport-info { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 0.85rem; }
        .material-info { display: flex; flex-direction: column; gap: 6px; }
        .qty-tag { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.05); padding: 4px 10px; border-radius: 8px; font-weight: 600; font-size: 0.8rem; }
        .design { font-size: 0.75rem; color: var(--text-dim); }

        .action-cell { display: flex; gap: 8px; }
        .icon-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; transition: var(--transition); padding: 6px; border-radius: 8px; }
        .icon-btn:hover { color: var(--text-main); background: rgba(255,255,255,0.05); }

        .options-wrap { position: relative; }
        .options-dropdown { position: absolute; right: 0; top: 100%; z-index: 100; background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 6px; min-width: 160px; box-shadow: 0 16px 40px rgba(0,0,0,0.5); }
        .opt-item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: none; background: none; color: var(--text-dim); font-size: 0.9rem; cursor: pointer; border-radius: 8px; text-align: left; transition: var(--transition); }
        .opt-item:hover { background: rgba(255,255,255,0.05); color: var(--text-main); }
        .opt-item.danger:hover { background: rgba(244,63,94,0.1); color: #fb7185; }

        .empty-state { padding: 80px; color: var(--text-dim); }
        .gap-2 { gap: 8px; }

        .date-input { background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; color: var(--text-main); font-size: 0.82rem; cursor: pointer; }
        .date-input:focus { outline: none; border-color: var(--primary); }
        .date-sep { color: var(--text-dim); font-size: 0.85rem; }

        .status-col { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; }
        .cdh-verified-tag { font-size: 0.62rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 7px; border-radius: 10px; background: rgba(16,185,129,0.1); color: var(--secondary); border: 1px solid rgba(16,185,129,0.2); }

        @media (max-width: 768px) {
          .page-header { flex-direction: column; align-items: flex-start; gap: 12px; }
          .title-area h1 { font-size: 1.6rem; }
          .log-actions { width: 100%; }
          .log-actions button { width: 100%; justify-content: center; }
          .table-header { flex-direction: column; align-items: stretch; gap: 12px; padding: 16px; }
          .btn-filter { justify-content: center; width: 100%; }
          .filter-panel { padding: 16px; }
          .filter-row { gap: 8px; }
          
          .log-table, .log-table thead, .log-table tbody, .log-table th, .log-table td, .log-table tr {
            display: block;
          }
          
          .log-table thead {
            display: none;
          }
          
          .log-table tr {
            border: 1px solid var(--border);
            background: rgba(255, 255, 255, 0.02);
            border-radius: 16px;
            padding: 16px;
            margin: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          }
          
          .log-table tr:hover {
            background: rgba(255, 255, 255, 0.04);
          }
          
          .log-table td {
            padding: 0 !important;
            border-bottom: none !important;
            width: 100%;
          }
          
          .log-table td:nth-child(1) {
            border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
            padding-bottom: 12px !important;
          }
          
          .log-table td:nth-child(2), .log-table td:nth-child(3), .log-table td:nth-child(4) {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          
          .log-table td:nth-child(2)::before {
            content: "Challan / Bilty";
            font-size: 0.75rem;
            color: var(--text-dim);
            font-weight: 600;
            text-transform: uppercase;
          }
          
          .log-table td:nth-child(3)::before {
            content: "Transport";
            font-size: 0.75rem;
            color: var(--text-dim);
            font-weight: 600;
            text-transform: uppercase;
          }
          
          .log-table td:nth-child(4)::before {
            content: "Material Info";
            font-size: 0.75rem;
            color: var(--text-dim);
            font-weight: 600;
            text-transform: uppercase;
          }
          
          .log-table td:nth-child(5) {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-top: 1px solid rgba(255, 255, 255, 0.05) !important;
            padding-top: 10px !important;
          }
          .log-table td:nth-child(5)::before {
            content: "Status";
            font-size: 0.75rem;
            color: var(--text-dim);
            font-weight: 600;
            text-transform: uppercase;
          }
          
          .log-table td:nth-child(6) {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.05) !important;
            padding-top: 12px !important;
          }
          
          .action-cell {
            width: 100%;
            justify-content: space-between;
            align-items: center;
          }
          
          .code-stack, .material-info {
            text-align: right;
            align-items: flex-end;
          }
          
          .transport-info {
            justify-content: flex-end;
          }
        }
      `}</style>
    </div>
  );
};

export default EntryLog;
