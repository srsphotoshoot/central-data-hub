import React from 'react';
import { ChevronRight, Package, Calculator, Cog, Truck, ArrowLeft } from 'lucide-react';
import { DEPT_CONFIG } from '../constants';

const DEPT_ICONS = {
  godown:     Package,
  accounts:   Calculator,
  production: Cog,
  dispatch:   Truck,
};

const DeptSelector = ({ onSelect, onBack }) => {
  const departments = Object.entries(DEPT_CONFIG);

  return (
    <div className="dept-selector-overlay">
      <div className="dept-selector-container">
        <button className="back-btn" onClick={onBack}>
          <ArrowLeft size={18} /> Back
        </button>

        <div className="selector-header">
          <h1>Select Your Department</h1>
          <p>Choose the department you are authorized to access</p>
        </div>

        <div className="dept-grid">
          {departments.map(([key, config]) => {
            const Icon = DEPT_ICONS[key];
            return (
              <button
                key={key}
                className="dept-card"
                style={{ '--dept-color': config.color, '--dept-bg': config.bg, '--dept-border': config.border, '--dept-glow': config.glow }}
                onClick={() => onSelect(key)}
              >
                <div className="dept-card-icon">
                  <Icon size={28} />
                </div>
                <div className="dept-card-info">
                  <h3>{config.label}</h3>
                  <p>{config.description}</p>
                </div>
                <ChevronRight className="dept-card-arrow" size={20} />
              </button>
            );
          })}
        </div>
      </div>

      <style>{`
        .dept-selector-overlay {
          position: fixed;
          inset: 0;
          background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 24px;
        }

        .dept-selector-container {
          width: 100%;
          max-width: 560px;
          animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .back-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          color: var(--text-dim);
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          margin-bottom: 32px;
          padding: 8px 0;
          transition: var(--transition);
        }
        .back-btn:hover { color: var(--text-main); }

        .selector-header {
          margin-bottom: 36px;
        }
        .selector-header h1 {
          font-size: 2rem;
          margin-bottom: 8px;
          background: linear-gradient(to right, #fff, #94a3b8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .selector-header p {
          color: var(--text-dim);
          font-size: 1rem;
        }

        .dept-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .dept-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--dept-border, var(--border));
          border-radius: 20px;
          padding: 20px 24px;
          display: flex;
          align-items: center;
          gap: 20px;
          cursor: pointer;
          transition: all 0.25s ease;
          text-align: left;
          width: 100%;
        }

        .dept-card:hover {
          background: var(--dept-bg);
          border-color: var(--dept-color);
          transform: translateX(6px);
          box-shadow: 0 0 30px var(--dept-glow);
        }

        .dept-card-icon {
          width: 56px;
          height: 56px;
          border-radius: 16px;
          background: var(--dept-bg);
          border: 1px solid var(--dept-border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--dept-color);
          flex-shrink: 0;
          transition: var(--transition);
        }

        .dept-card:hover .dept-card-icon {
          background: var(--dept-color);
          color: white;
          box-shadow: 0 8px 20px var(--dept-glow);
        }

        .dept-card-info {
          flex: 1;
        }
        .dept-card-info h3 {
          font-size: 1.1rem;
          color: var(--text-main);
          margin-bottom: 4px;
          font-weight: 700;
        }
        .dept-card-info p {
          font-size: 0.85rem;
          color: var(--text-dim);
          line-height: 1.4;
        }

        .dept-card-arrow {
          color: var(--text-dim);
          opacity: 0;
          transition: 0.25s;
          flex-shrink: 0;
        }
        .dept-card:hover .dept-card-arrow {
          opacity: 1;
          color: var(--dept-color);
          transform: translateX(4px);
        }
      `}</style>
    </div>
  );
};

export default DeptSelector;
