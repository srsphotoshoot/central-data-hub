import React from 'react';
import { ShieldCheck, Building2, ChevronRight, Lock } from 'lucide-react';

const Login = ({ onLogin }) => {
  return (
    <div className="login-overlay">
      <div className="login-container">
        <div className="login-header">
          <div className="logo-badge">
            <ShieldCheck size={40} />
          </div>
          <h1>Shree Radha Studio</h1>
          <p>Gate Pass Management System — Select your portal</p>
        </div>

        <div className="role-grid">
          <div className="role-card" onClick={() => onLogin('guard')}>
            <div className="role-icon guard">
              <ShieldCheck size={32} />
            </div>
            <div className="role-info">
              <h3>Security Gate</h3>
              <p>Register incoming/outgoing materials and manage gate passes.</p>
            </div>
            <ChevronRight className="arrow" size={24} />
          </div>

          <div className="role-card" onClick={() => onLogin('dept')}>
            <div className="role-icon dept">
              <Building2 size={32} />
            </div>
            <div className="role-info">
              <h3>Department Console</h3>
              <p>Review clearance requests and monitor departmental flow.</p>
            </div>
            <ChevronRight className="arrow" size={24} />
          </div>
        </div>

        <div className="login-footer">
          <Lock size={14} />
          <span>Shree Radha Studio — Internal Use Only</span>
        </div>
      </div>

      <style>{`
        .login-overlay {
          position: fixed;
          inset: 0;
          background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }

        .login-container {
          width: 100%;
          max-width: 500px;
          text-align: center;
          animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .logo-badge {
          width: 80px;
          height: 80px;
          background: var(--primary);
          border-radius: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 24px;
          color: white;
          box-shadow: 0 20px 40px var(--primary-glow);
        }

        .login-header h1 {
          font-size: 2.5rem;
          margin-bottom: 8px;
          background: linear-gradient(to right, #fff, #94a3b8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .login-header p {
          color: var(--text-dim);
          font-size: 1.1rem;
          margin-bottom: 48px;
        }

        .role-grid {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .role-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border);
          border-radius: 24px;
          padding: 24px;
          display: flex;
          align-items: center;
          gap: 20px;
          cursor: pointer;
          transition: all 0.3s ease;
          text-align: left;
        }

        .role-card:hover {
          background: rgba(255, 255, 255, 0.07);
          border-color: var(--primary);
          transform: translateX(8px);
        }

        .role-icon {
          width: 64px;
          height: 64px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .role-icon.guard { background: linear-gradient(135deg, #6366f1, #4f46e5); }
        .role-icon.dept { background: linear-gradient(135deg, #10b981, #059669); }

        .role-info { flex: 1; }
        .role-info h3 { font-size: 1.25rem; margin-bottom: 4px; }
        .role-info p { font-size: 0.9rem; color: var(--text-dim); line-height: 1.4; }

        .arrow { color: var(--text-dim); opacity: 0; transition: 0.3s; }
        .role-card:hover .arrow { opacity: 1; transform: translateX(4px); color: var(--primary); }

        .login-footer {
          margin-top: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: #475569;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};

export default Login;
