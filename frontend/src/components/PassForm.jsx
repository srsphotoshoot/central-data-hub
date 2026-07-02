import React, { useState, useEffect } from 'react';
import { Mic, Download, Truck, FileText, CheckCircle, AlertCircle, Search, ShieldCheck, Database, ChevronRight } from 'lucide-react';
import { DEPT_OPTIONS, DEPT_CONFIG } from '../constants';
import { lookupChallan, mapChallanToForm } from '../services/cdh';

const makeEmptyForm = (dept = '') => ({
  date: new Date().toISOString().split('T')[0],
  partyName: '',
  challanNo: '',
  orderNo: '',
  dept,
  unitType: 'pcs',
  quantity: '',
  biltyNo: '',
  transportName: '',
  designNo: '',
  parcelFrom: '',
  description: '',
  processName: '',
});

const PassForm = ({ onAddEntry, onVoiceClick, selectedDept }) => {

  const [formData, setFormData] = useState(() => makeEmptyForm(selectedDept || ''));
  const [step, setStep] = useState(1);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errors, setErrors] = useState({});
  const [lookupQuery, setLookupQuery] = useState('');
  const [cdhStatus, setCdhStatus] = useState('idle'); // idle | loading | found | not_found | unavailable
  const [cdhRecord, setCdhRecord] = useState(null);

  const config = DEPT_CONFIG[formData.dept]?.formFields || DEPT_CONFIG['godown'].formFields;

  useEffect(() => {
    const handleVoiceResult = (e) => {
      const { target, text } = e.detail;
      setFormData(prev => ({ ...prev, [target]: text }));
    };
    window.addEventListener('voice-result', handleVoiceResult);
    return () => window.removeEventListener('voice-result', handleVoiceResult);
  }, []);

  const handleLookup = async () => {
    if (!lookupQuery.trim()) return;
    setCdhStatus('loading');
    try {
      const record = await lookupChallan(lookupQuery.trim());
      if (record && (record.challan_no || record.challanNo || record.customer_name)) {
        setCdhRecord(record);
        setFormData(prev => ({ ...prev, ...mapChallanToForm(record) }));
        setCdhStatus('found');
        setErrors({});
      } else {
        setCdhStatus('not_found');
      }
    } catch (err) {
      setCdhStatus(err.message === 'CDH_UNAVAILABLE' ? 'unavailable' : 'not_found');
    }
  };

  const handleNext = () => {
    const newErrors = {};
    if (!formData.challanNo.trim()) newErrors.challanNo = 'Challan No. required hai';
    if (!formData.partyName.trim()) newErrors.partyName = 'Party Name required hai';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setStep(2);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!formData.quantity || formData.quantity === '0') newErrors.quantity = 'Quantity required hai';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const isCdhVerified = cdhStatus === 'found';
    const entry = {
      ...formData,
      type: 'incoming',
      status: isCdhVerified ? 'completed' : 'pending',
      cdh_verified: isCdhVerified,
      timestamp: new Date().toISOString()
    };

    onAddEntry(entry);
    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setFormData(makeEmptyForm(selectedDept || ''));
      setStep(1);
      setErrors({});
      setCdhStatus('idle');
      setCdhRecord(null);
      setLookupQuery('');
    }, 2000);
  };

  const set = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  if (isSuccess) {
    return (
      <div className="glass-card pass-success-card flex-center">
        <div className="pass-success-content flex-center">
          {cdhStatus === 'found'
            ? <ShieldCheck size={64} className="success-icon" />
            : <CheckCircle size={64} className="success-icon" />
          }
          <h2>
            {cdhStatus === 'found' ? 'CDH Verified & Cleared' : 'Incoming Registered'}
          </h2>
          <p>
            {cdhStatus === 'found'
              ? 'Challan matched in Central Data Hub. Entry auto-cleared.'
              : 'Entry logged. Pending department verification.'}
          </p>
        </div>
        <style>{`
          .pass-success-card { height: 400px; max-width: 600px; margin: 0 auto; }
          .pass-success-content { flex-direction: column; gap: 16px; text-align: center; }
          .success-icon { color: var(--secondary); filter: drop-shadow(0 0 20px rgba(16,185,129,0.4)); }
        `}</style>
      </div>
    );
  }

  const renderFormStep = () => {
    if (step === 1) {
      return (
        <div className="step-content">
          <h3 className="step-title"><FileText size={20} /> Basic Info</h3>
          <div className="input-grid">
            <div className="form-group">
              <label>Transaction Date</label>
              <input
                type="date"
                className="form-input"
                value={formData.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Challan No. <span className="req">*</span></label>
              <div className="input-with-mic">
                <input
                  className={`form-input ${errors.challanNo ? 'input-error' : ''}`}
                  placeholder="SR-001"
                  value={formData.challanNo}
                  onChange={(e) => set('challanNo', e.target.value)}
                />
                <button type="button" className="mic-btn-small" onClick={() => onVoiceClick('challanNo')}><Mic size={16} /></button>
              </div>
              {errors.challanNo && <span className="field-error"><AlertCircle size={12} />{errors.challanNo}</span>}
            </div>
            <div className="form-group full-width">
              <label>{config.partyLabel || 'Party Name'} <span className="req">*</span></label>
              <div className="input-with-mic">
                <input
                  className={`form-input ${errors.partyName ? 'input-error' : ''}`}
                  placeholder={config.partyPlaceholder || 'e.g. Shree Radha Studio'}
                  value={formData.partyName}
                  onChange={(e) => set('partyName', e.target.value)}
                />
                <button type="button" className="mic-btn-small" onClick={() => onVoiceClick('partyName')}><Mic size={16} /></button>
              </div>
              {errors.partyName && <span className="field-error"><AlertCircle size={12} />{errors.partyName}</span>}
            </div>
            <div className="form-group">
              <label>Department</label>
              <select
                className="form-input"
                value={formData.dept}
                onChange={(e) => set('dept', e.target.value)}
              >
                {DEPT_OPTIONS.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            {config.showOrderNo && (
              <div className="form-group">
                <label>Order No. <span className="optional">(Optional)</span></label>
                <input
                  className="form-input"
                  placeholder="ORD-99"
                  value={formData.orderNo}
                  onChange={(e) => set('orderNo', e.target.value)}
                />
              </div>
            )}
            {config.showDesignNo && (
              <div className="form-group full-width">
                <label>Design No.</label>
                <input
                  className="form-input"
                  placeholder="D-123"
                  value={formData.designNo}
                  onChange={(e) => set('designNo', e.target.value)}
                />
              </div>
            )}
            
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
          </div>
          <button className="btn-primary next-btn" onClick={handleNext}>
            Next: Transport Details <ChevronRight size={18} />
          </button>
        </div>
      );
    }

    return (
      <div className="step-content">
        <h3 className="step-title"><Truck size={20} /> Logistics & Material</h3>
        <div className="input-grid">
          {config.showTransport && (
            <div className="form-group">
              <label>Transport Name</label>
              <div className="input-with-mic">
                <input
                  className="form-input"
                  placeholder="e.g. BlueDart"
                  value={formData.transportName}
                  onChange={(e) => set('transportName', e.target.value)}
                />
                <button type="button" className="mic-btn-small" onClick={() => onVoiceClick('transportName')}><Mic size={16} /></button>
              </div>
            </div>
          )}
          {config.showBilty && (
            <div className="form-group">
              <label>Bilty Number</label>
              <input
                className="form-input"
                placeholder="B-100234"
                value={formData.biltyNo}
                onChange={(e) => set('biltyNo', e.target.value)}
              />
            </div>
          )}
          <div className="form-group">
            <label>Unit Type</label>
            <select
              className="form-input"
              value={formData.unitType}
              onChange={(e) => set('unitType', e.target.value)}
            >
              {config.unitOptions.map(u => (
                <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{config.quantityLabel} <span className="req">*</span></label>
            <input
              type="number"
              className={`form-input ${errors.quantity ? 'input-error' : ''}`}
              placeholder="0"
              min="1"
              value={formData.quantity}
              onChange={(e) => set('quantity', e.target.value)}
            />
            {errors.quantity && <span className="field-error"><AlertCircle size={12} />{errors.quantity}</span>}
          </div>
          <div className="form-group full-width">
            <label>Parcel From / Destination</label>
            <input
              className="form-input"
              placeholder="City / Warehouse Location"
              value={formData.parcelFrom}
              onChange={(e) => set('parcelFrom', e.target.value)}
            />
          </div>
          <div className="form-group full-width">
            <label>Description of Goods</label>
            <textarea
              className="form-input"
              rows="2"
              placeholder={config.descriptionPlaceholder}
              value={formData.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </div>
        <div className="button-row">
          <button className="btn-secondary" onClick={() => { setStep(1); setErrors({}); }}>Back</button>
          <button className="btn-primary" onClick={handleSubmit}>
            Register Incoming
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="glass-card pass-form-container">
      <header className="form-header">
        <div className="form-title">
          <div className="title-icon incoming">
            <Download size={20} />
          </div>
          <div>
                <h2>Incoming Material Entry</h2>
                <p>Register movement of goods between departments</p>
              </div>
            </div>
            <div className="step-indicator">
              <div className={`step-dot ${step === 1 ? 'active' : ''}`} />
              <div className={`step-dot ${step === 2 ? 'active' : ''}`} />
            </div>
          </header>

          <div className={`cdh-lookup-bar ${cdhStatus !== 'idle' ? `cdh-${cdhStatus}` : ''}`}>
              <div className="lookup-row">
                <Database size={16} className="lookup-db-icon" />
                <input
                  className="lookup-input"
                  placeholder="Enter Challan No. to auto-fill from CDH..."
                  value={lookupQuery}
                  onChange={e => setLookupQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLookup()}
                />
                <button
                  className="lookup-btn"
                  onClick={handleLookup}
                  disabled={cdhStatus === 'loading' || !lookupQuery.trim()}
                >
                  {cdhStatus === 'loading' ? (
                    <span className="lookup-spinner" />
                  ) : (
                    <Search size={15} />
                  )}
                  {cdhStatus === 'loading' ? 'Searching...' : 'Lookup'}
                </button>
              </div>

              {cdhStatus === 'found' && (
                <div className="cdh-found-banner">
                  <ShieldCheck size={14} />
                  <span>CDH Verified — Challan <strong>{cdhRecord?.challan_no || cdhRecord?.challanNo}</strong> matched for <strong>{cdhRecord?.customer_name || cdhRecord?.partyName}</strong></span>
                  <span className="cdh-badge">Auto-filled</span>
                </div>
              )}

              {cdhStatus === 'not_found' && (
                <div className="cdh-warn-banner">
                  <AlertCircle size={14} />
                  <span>No CDH record found — manual entry will be marked <strong>pending</strong> for dept review</span>
                </div>
              )}

              {cdhStatus === 'unavailable' && (
                <div className="cdh-warn-banner">
                  <AlertCircle size={14} />
                  <span>CDH is currently unreachable — proceed with manual entry</span>
                </div>
              )}
            </div>

        <form onSubmit={(e) => e.preventDefault()}>
          {renderFormStep()}
        </form>

      <style>{`
        .pass-form-container {
          max-width: 700px;
          margin: 0 auto;
          padding: 32px;
          min-height: 500px;
          position: relative;
          overflow: hidden;
        }

        .form-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
          padding-bottom: 24px;
          border-bottom: 1px solid var(--border);
        }

        .form-title { display: flex; gap: 16px; align-items: center; }
        .title-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
        .title-icon.incoming { background: rgba(16, 185, 129, 0.1); color: var(--secondary); }
        .title-icon.outgoing { background: rgba(99, 102, 241, 0.1); color: var(--primary); }

        .form-title h2 { font-size: 1.4rem; margin-bottom: 2px; }
        .form-title p { font-size: 0.85rem; color: var(--text-dim); }

        .step-indicator { display: flex; gap: 8px; padding-top: 10px; }
        .step-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.1); transition: var(--transition); }
        .step-dot.active { background: var(--primary); width: 24px; border-radius: 4px; }

        .step-title { display: flex; align-items: center; gap: 8px; font-size: 1rem; color: var(--text-dim); margin-bottom: 24px; text-transform: uppercase; letter-spacing: 0.05em; }

        .input-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group.full-width { grid-column: span 2; }
        .form-group label { font-size: 0.85rem; font-weight: 600; color: var(--text-dim); }

        .req { color: #fb7185; margin-left: 2px; }
        .optional { font-weight: 400; opacity: 0.6; font-size: 0.8rem; }

        .input-error { border-color: rgba(244, 63, 94, 0.5) !important; }

        .field-error {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.78rem;
          color: #fb7185;
          font-weight: 500;
          margin-top: 2px;
        }

        .input-with-mic { position: relative; display: flex; align-items: center; }
        .mic-btn-small { position: absolute; right: 10px; width: 32px; height: 32px; border-radius: 8px; background: var(--primary); border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: var(--transition); }
        .mic-btn-small:hover { background: var(--primary-hover); transform: scale(1.05); }

        .button-row { display: flex; justify-content: space-between; gap: 16px; }
        .next-btn { width: 100%; height: 54px; font-size: 1rem; }
        .btn-secondary { background: rgba(255,255,255,0.05); color: var(--text-main); border: 1px solid var(--border); padding: 12px 24px; border-radius: var(--radius-lg); font-weight: 600; cursor: pointer; }

        @media (max-width: 768px) {
          .pass-form-container { padding: 20px; min-height: unset; }
          .form-header { margin-bottom: 20px; padding-bottom: 16px; }
          .form-title h2 { font-size: 1.1rem; }
          .form-title p { font-size: 0.78rem; }
          .input-grid { grid-template-columns: 1fr; gap: 14px; margin-bottom: 20px; }
          .form-group.full-width { grid-column: span 1; }
          .button-row { gap: 10px; }
          .btn-secondary, .next-btn, .btn-primary { height: 52px; font-size: 1rem; }
          .cdh-lookup-bar { padding: 12px; }
          .lookup-row { flex-wrap: wrap; gap: 8px; }
          .lookup-btn { width: 100%; justify-content: center; }
        }

        /* CDH Lookup Bar */
        .cdh-lookup-bar {
          margin-bottom: 24px;
          padding: 14px 16px;
          border-radius: 14px;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 10px;
          transition: border-color 0.2s;
        }
        .cdh-lookup-bar.cdh-found { border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.04); }
        .cdh-lookup-bar.cdh-not_found,
        .cdh-lookup-bar.cdh-unavailable { border-color: rgba(245,158,11,0.25); background: rgba(245,158,11,0.03); }

        .lookup-row { display: flex; align-items: center; gap: 10px; }
        .lookup-db-icon { color: var(--text-dim); flex-shrink: 0; }

        .lookup-input {
          flex: 1;
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 9px 14px;
          color: var(--text-main);
          font-size: 0.9rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .lookup-input:focus { border-color: var(--primary); }
        .lookup-input::placeholder { color: var(--text-dim); }

        .lookup-btn {
          display: flex; align-items: center; gap: 7px;
          padding: 9px 18px;
          background: rgba(99,102,241,0.12);
          border: 1px solid rgba(99,102,241,0.25);
          border-radius: 10px;
          color: var(--primary);
          font-size: 0.85rem;
          font-weight: 700;
          cursor: pointer;
          transition: var(--transition);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .lookup-btn:hover:not(:disabled) { background: rgba(99,102,241,0.2); }
        .lookup-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .lookup-spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(99,102,241,0.3);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        .cdh-found-banner {
          display: flex; align-items: center; gap: 8px;
          font-size: 0.82rem; color: var(--secondary);
          padding: 6px 10px;
          background: rgba(16,185,129,0.08);
          border-radius: 8px;
          border: 1px solid rgba(16,185,129,0.15);
        }
        .cdh-found-banner strong { font-weight: 700; }

        .cdh-badge {
          margin-left: auto;
          background: rgba(16,185,129,0.15);
          border: 1px solid rgba(16,185,129,0.2);
          color: var(--secondary);
          font-size: 0.68rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 2px 8px;
          border-radius: 20px;
          flex-shrink: 0;
        }

        .cdh-warn-banner {
          display: flex; align-items: center; gap: 8px;
          font-size: 0.82rem; color: #fbbf24;
          padding: 6px 10px;
          background: rgba(245,158,11,0.06);
          border-radius: 8px;
          border: 1px solid rgba(245,158,11,0.15);
        }
        .cdh-warn-banner strong { font-weight: 700; }
      `}</style>
    </div>
  );
};

export default PassForm;
