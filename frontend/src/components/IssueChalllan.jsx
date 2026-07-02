import React, { useState } from 'react';
import { CheckCircle, AlertCircle, Send, Package, FileText, Truck } from 'lucide-react';
import { DEPT_OPTIONS, DEPT_CONFIG, getDeptLabel } from '../constants';

const EMPTY_FORM = {
  date: new Date().toISOString().split('T')[0],
  dept: 'godown',
  partyName: '',
  challanNo: '',
  orderNo: '',
  biltyNo: '',
  designNo: '',
  transportName: '',
  quantity: '',
  unitType: 'pcs',
  description: '',
  guardNotes: '',
  processName: '',
};

const IssueChalllan = ({ onAddEntry, selectedDept }) => {
  const [formData, setFormData] = useState({ ...EMPTY_FORM, dept: selectedDept || 'godown' });
  const [errors, setErrors] = useState({});
  const [isSuccess, setIsSuccess] = useState(false);

  const config = DEPT_CONFIG[formData.dept]?.formFields || DEPT_CONFIG['godown'].formFields;

  const set = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = () => {
    const newErrors = {};
    if (!formData.partyName.trim()) newErrors.partyName = 'Party Name is required';
    if (!formData.challanNo.trim()) newErrors.challanNo = 'Challan No. is required';
    if (!formData.quantity || formData.quantity === '0') newErrors.quantity = 'Quantity is required';
    if (!formData.description.trim()) newErrors.description = 'Material description is required for gate verification';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const entry = {
      ...formData,
      type: 'outgoing',
      status: 'dept_issued',
      initiatedBy: 'dept',
      timestamp: new Date().toISOString(),
    };

    onAddEntry(entry);
    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setFormData({ ...EMPTY_FORM, dept: selectedDept || 'godown', date: new Date().toISOString().split('T')[0] });
      setErrors({});
    }, 2500);
  };

  if (isSuccess) {
    return (
      <div className="glass-card issue-success-card flex-center">
        <div className="issue-success-content flex-center">
          <CheckCircle size={64} className="success-icon" />
          <h2>Challan Sent to Gate</h2>
          <p>The security guard has been notified. They will verify and issue the gate pass.</p>
        </div>
        <style>{`
          .issue-success-card { height: 400px; max-width: 600px; margin: 0 auto; }
          .issue-success-content { flex-direction: column; gap: 16px; text-align: center; }
          .success-icon { color: var(--secondary); filter: drop-shadow(0 0 20px rgba(16,185,129,0.4)); }
        `}</style>
      </div>
    );
  }

  return (
    <div className="issue-challlan-page">
      <header className="page-header">
        <div className="title-area">
          <div className="header-tag">
            <Send size={14} />
            <span>Department → Security Gate</span>
          </div>
          <h1>Issue Outgoing Challan</h1>
          <p>This challan will appear on the security guard's screen for physical verification before gate pass issuance</p>
        </div>
      </header>

      <div className="glass-card issue-form-card">
        <div className="form-section">
          <h3 className="section-heading"><FileText size={18} /> Basic Details</h3>
          <div className="field-grid">
            <div className="form-group">
              <label>Department <span className="req">*</span></label>
              {selectedDept ? (
                <div className="form-input dept-locked">
                  {DEPT_OPTIONS.find(d => d.value === selectedDept)?.label || selectedDept}
                </div>
              ) : (
                <select className="form-input" value={formData.dept} onChange={e => set('dept', e.target.value)}>
                  {DEPT_OPTIONS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group">
              <label>Date</label>
              <input type="date" className="form-input" value={formData.date} onChange={e => set('date', e.target.value)} />
            </div>

            <div className="form-group">
              <label>Challan No. <span className="req">*</span></label>
              <input
                className={`form-input ${errors.challanNo ? 'input-error' : ''}`}
                placeholder="CH-001"
                value={formData.challanNo}
                onChange={e => set('challanNo', e.target.value)}
              />
              {errors.challanNo && <span className="field-error"><AlertCircle size={12} />{errors.challanNo}</span>}
            </div>

            <div className="form-group">
              <label>{config.partyLabel || 'Party Name'} <span className="req">*</span></label>
              <input
                className={`form-input ${errors.partyName ? 'input-error' : ''}`}
                placeholder={config.partyPlaceholder || 'e.g. Shree Radha Studio'}
                value={formData.partyName}
                onChange={e => set('partyName', e.target.value)}
              />
              {errors.partyName && <span className="field-error"><AlertCircle size={12} />{errors.partyName}</span>}
            </div>

            {config.showProcessName && (
              <div className="form-group full-width">
                <label>Process / Purpose <span className="optional">(Optional)</span></label>
                <input
                  className="form-input"
                  placeholder="e.g. Sample Making, Stitching, Embroidery"
                  value={formData.processName}
                  onChange={e => set('processName', e.target.value)}
                />
              </div>
            )}

            {config.showOrderNo && (
              <div className="form-group">
                <label>Order No. <span className="optional">(Optional)</span></label>
                <input
                  className="form-input"
                  placeholder="SO-2024-001"
                  value={formData.orderNo}
                  onChange={e => set('orderNo', e.target.value)}
                />
              </div>
            )}

            {config.showDesignNo && (
              <div className="form-group">
                <label>Design No. <span className="optional">(Optional)</span></label>
                <input
                  className="form-input"
                  placeholder="D-123"
                  value={formData.designNo}
                  onChange={e => set('designNo', e.target.value)}
                />
              </div>
            )}

            <div className="form-group qty-row">
              <label>{config.quantityLabel} <span className="req">*</span></label>
              <div className="qty-inputs">
                <input
                  type="number"
                  min="1"
                  className={`form-input ${errors.quantity ? 'input-error' : ''}`}
                  placeholder="0"
                  value={formData.quantity}
                  onChange={e => set('quantity', e.target.value)}
                />
                <select className="form-input unit-select" value={formData.unitType} onChange={e => set('unitType', e.target.value)}>
                  {config.unitOptions.map(u => (
                    <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                  ))}
                </select>
              </div>
              {errors.quantity && <span className="field-error"><AlertCircle size={12} />{errors.quantity}</span>}
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3 className="section-heading"><Package size={18} /> Gate Verification Details</h3>
          <p className="section-sub">This information will be displayed on the guard's screen — clearly describe what is being dispatched</p>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label>Material Description <span className="req">*</span></label>
            <textarea
              className={`form-input ${errors.description ? 'input-error' : ''}`}
              rows="3"
              placeholder={config.descriptionPlaceholder}
              value={formData.description}
              onChange={e => set('description', e.target.value)}
            />
            {errors.description && <span className="field-error"><AlertCircle size={12} />{errors.description}</span>}
          </div>

          <div className="form-group">
            <label>Notes for Security Guard <span className="optional">(Optional)</span></label>
            <textarea
              className="form-input"
              rows="2"
              placeholder="e.g. Bags must have red seal, vehicle no. UP-14-XX-1234"
              value={formData.guardNotes}
              onChange={e => set('guardNotes', e.target.value)}
            />
          </div>
        </div>

        {(config.showTransport || config.showBilty) && (
          <div className="form-section">
            <h3 className="section-heading"><Truck size={18} /> Logistics Details</h3>
            <div className="field-grid">
              {config.showTransport && (
                <div className="form-group">
                  <label>Transport Name <span className="optional">(Optional)</span></label>
                  <input
                    className="form-input"
                    placeholder="e.g. Shree Transport Co."
                    value={formData.transportName}
                    onChange={e => set('transportName', e.target.value)}
                  />
                </div>
              )}

              {config.showBilty && (
                <div className="form-group">
                  <label>Bilty / LR No. <span className="optional">(Optional)</span></label>
                  <input
                    className="form-input"
                    placeholder="LR-5678"
                    value={formData.biltyNo}
                    onChange={e => set('biltyNo', e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="preview-box">
          <span className="preview-label">Guard Screen Preview:</span>
          <div className="preview-content">
            <span className="preview-dept">{getDeptLabel(formData.dept)}</span>
            <span className="preview-party">{formData.partyName || 'Party Name...'}</span>
            <span className="preview-desc">{formData.description || 'Material description will appear here...'}</span>
          </div>
        </div>

        <button className="btn-issue" onClick={handleSubmit}>
          <Send size={20} />
          Send Challan to Gate
        </button>
      </div>

      <style>{`
        .issue-challlan-page { display: flex; flex-direction: column; gap: 32px; max-width: 800px; margin: 0 auto; }

        .header-tag { display: flex; align-items: center; gap: 6px; color: #a78bfa; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.1em; }
        .title-area h1 { font-size: 2rem; margin-bottom: 4px; }
        .title-area p { color: var(--text-dim); font-size: 1rem; }

        .issue-form-card { padding: 36px; display: flex; flex-direction: column; gap: 32px; }

        .form-section { display: flex; flex-direction: column; gap: 20px; }
        .section-heading { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
        .section-sub { font-size: 0.85rem; color: var(--text-dim); margin-top: -12px; }

        .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 0.85rem; font-weight: 600; color: var(--text-dim); }

        .qty-row { grid-column: span 1; }
        .qty-inputs { display: grid; grid-template-columns: 1fr 120px; gap: 10px; width: 100%; }
        .unit-select { width: 100%; }

        .dept-locked { color: var(--text-dim); cursor: not-allowed; opacity: 0.75; font-weight: 600; }
        .req { color: #fb7185; margin-left: 2px; }
        .optional { font-weight: 400; opacity: 0.6; font-size: 0.8rem; }
        .input-error { border-color: rgba(244, 63, 94, 0.5) !important; }
        .field-error { display: flex; align-items: center; gap: 4px; font-size: 0.78rem; color: #fb7185; font-weight: 500; }

        .preview-box {
          background: rgba(139, 92, 246, 0.05);
          border: 1px dashed rgba(139, 92, 246, 0.3);
          border-radius: 16px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .preview-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #a78bfa; letter-spacing: 0.08em; }
        .preview-content { display: flex; flex-direction: column; gap: 6px; }
        .preview-dept { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #a78bfa; background: rgba(139,92,246,0.1); display: inline-block; padding: 3px 10px; border-radius: 20px; width: fit-content; }
        .preview-party { font-size: 1.1rem; font-weight: 700; color: white; }
        .preview-desc { font-size: 0.9rem; color: var(--text-dim); line-height: 1.5; }

        .btn-issue {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 16px;
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
          color: white;
          border: none;
          border-radius: var(--radius-lg);
          font-size: 1.05rem;
          font-weight: 700;
          cursor: pointer;
          transition: var(--transition);
          box-shadow: 0 10px 20px rgba(139, 92, 246, 0.3);
        }
        .btn-issue:hover { transform: translateY(-2px); filter: brightness(1.1); }
        .btn-issue:active { transform: translateY(0); }

        @media (max-width: 768px) {
          .issue-challlan-page { gap: 20px; }
          .issue-form-card { padding: 20px; gap: 24px; }
          .title-area h1 { font-size: 1.6rem; }
          .field-grid { grid-template-columns: 1fr; gap: 16px; }
          .qty-row { grid-column: span 1; }
        }
      `}</style>
    </div>
  );
};

export default IssueChalllan;
