import React, { useState, useEffect } from 'react';
import { 
  Activity, AlertTriangle, TrendingUp, Users, Layers, RotateCw, 
  Boxes, AlertCircle, CheckCircle, Clock, ArrowRight, ShieldCheck, HelpCircle
} from 'lucide-react';

const ProductionDashboard = ({ selectedDept, userRole, showToast, API_URL }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [randomizing, setRandomizing] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('pipeline');
  const [error, setError] = useState(null);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/production/overview`, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const payload = await res.json();
      setData(payload);
      setError(null);
    } catch (err) {
      console.error('Error fetching dashboard:', err);
      setError('Unable to load production planning data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
    // Refresh data every 20 seconds
    const interval = setInterval(fetchOverview, 20000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line

  const handleRandomize = async () => {
    try {
      setRandomizing(true);
      const res = await fetch(`${API_URL}/production/randomize`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (!res.ok) throw new Error('Randomization failed');
      showToast('Scenarios simulated and randomized!', 'success');
      await fetchOverview();
    } catch (err) {
      showToast('Failed to randomize data', 'error');
    } finally {
      setRandomizing(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="dashboard-loading">
        <div className="spinner-glow" />
        <span>Loading production analytics...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="dashboard-error">
        <AlertCircle size={48} className="error-icon" />
        <h2>Connection Interrupted</h2>
        <p>{error}</p>
        <button onClick={fetchOverview} className="retry-btn">
          <RotateCw size={16} /> Try Reconnecting
        </button>
      </div>
    );
  }

  // Fallback defaults in case of empty lists
  const plans = data?.production_plans || [];
  const attention = data?.attention_scores || [];
  const stockInventory = data?.inventory || [];
  const subpartInventory = data?.subpart_inventory || {};
  const karigars = data?.karigar_report || [];
  const offline = data?.offline ?? true;

  // Compute key stats
  const activePlansCount = plans.filter(p => p.status === 'Running').length;
  const criticalPlansCount = attention.filter(a => a.attention_score >= 60).length;
  const completedPlansCount = plans.filter(p => p.status === 'Completed').length;
  
  // Find low/missing stock
  const lowMaterials = Object.entries(subpartInventory)
    .filter(([_, qty]) => qty <= 50)
    .map(([name, qty]) => ({ name, qty }));

  return (
    <div className="production-dashboard-wrapper">
      
      {/* ── Dashboard Top Header ── */}
      <div className="dashboard-header-banner glass-card">
        <div className="banner-left">
          <div className="badge-row">
            <span className="live-pill active">
              <span className="pulse-dot" />
              PRODUCTION CONTROL
            </span>
            {offline ? (
              <span className="offline-pill">
                SIMULATED DATA (OFFLINE FALLBACK)
              </span>
            ) : (
              <span className="online-pill">
                LIVE CDH SYNCED
              </span>
            )}
          </div>
          <h1 className="banner-title">Radha Studio Production Flow</h1>
          <p className="banner-desc">
            Direct CDH API pipeline integration overseeing Sales demand, material logs, and Karigar pipelines.
          </p>
        </div>
        
        <div className="banner-right">
          <button 
            className={`simulator-btn ${randomizing ? 'loading' : ''}`}
            onClick={handleRandomize}
            disabled={randomizing}
            title="Inject different karigar scenarios & overdue metrics"
          >
            <RotateCw size={16} className={randomizing ? 'spin' : ''} />
            <span>{randomizing ? 'Simulating...' : 'Simulate Scenarios'}</span>
          </button>
        </div>
      </div>

      {/* ── Quick Stats Metric Row ── */}
      <div className="metric-row-grid">
        <div className="metric-card glass-card hover-glow">
          <div className="metric-icon-wrap primary-gradient">
            <Activity size={22} />
          </div>
          <div className="metric-details">
            <span className="metric-label">Active Pipelines</span>
            <h3 className="metric-value">{activePlansCount} <span className="value-total">/ {plans.length}</span></h3>
            <p className="metric-subtext">Currently running on workshop floor</p>
          </div>
        </div>

        <div className="metric-card glass-card hover-glow danger-border">
          <div className="metric-icon-wrap red-gradient">
            <AlertTriangle size={22} />
          </div>
          <div className="metric-details">
            <span className="metric-label">Critical Risks</span>
            <h3 className="metric-value text-red">{criticalPlansCount}</h3>
            <p className="metric-subtext">Attention Score exceeding 60%</p>
          </div>
        </div>

        <div className="metric-card glass-card hover-glow warning-border">
          <div className="metric-icon-wrap amber-gradient">
            <Boxes size={22} />
          </div>
          <div className="metric-details">
            <span className="metric-label">Material Deficits</span>
            <h3 className="metric-value text-amber">{lowMaterials.length}</h3>
            <p className="metric-subtext">
              {lowMaterials.length > 0 ? `${lowMaterials.map(m => m.name).join(', ')} low` : 'All materials healthy'}
            </p>
          </div>
        </div>

        <div className="metric-card glass-card hover-glow success-border">
          <div className="metric-icon-wrap green-gradient">
            <CheckCircle size={22} />
          </div>
          <div className="metric-details">
            <span className="metric-label">Completed Units</span>
            <h3 className="metric-value text-green">{completedPlansCount}</h3>
            <p className="metric-subtext">Finished jobs archived in database</p>
          </div>
        </div>
      </div>

      {/* ── Sub Navigation Tabs ── */}
      <div className="dashboard-nav-tabs glass-card">
        <button 
          className={`tab-btn ${activeSubTab === 'pipeline' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('pipeline')}
        >
          <Layers size={18} />
          <span>Active Plans ({plans.length})</span>
        </button>
        <button 
          className={`tab-btn ${activeSubTab === 'attention' ? 'active' : ''} ${criticalPlansCount > 0 ? 'alert' : ''}`}
          onClick={() => setActiveSubTab('attention')}
        >
          <AlertCircle size={18} />
          <span>Attention Engine ({attention.length})</span>
        </button>
        <button 
          className={`tab-btn ${activeSubTab === 'stock' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('stock')}
        >
          <Boxes size={18} />
          <span>Stock vs Reserves</span>
        </button>
        <button 
          className={`tab-btn ${activeSubTab === 'karigars' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('karigars')}
        >
          <Users size={18} />
          <span>Karigar Standings</span>
        </button>
      </div>

      {/* ── Tab Content Area ── */}
      <div className="dashboard-content-window">
        
        {/* 1. PIPELINE TAB */}
        {activeSubTab === 'pipeline' && (
          <div className="pipeline-grid animate-fade-in">
            {plans.length === 0 ? (
              <div className="empty-state glass-card">
                <HelpCircle size={36} />
                <p>No active production plans in Central Data Hub.</p>
              </div>
            ) : (
              plans.map(plan => {
                const attObj = attention.find(a => String(a.production_code) === String(plan.product_id));
                const attScore = attObj?.attention_score ?? 0;
                
                let scoreClass = 'score-low';
                if (attScore >= 60) scoreClass = 'score-high';
                else if (attScore >= 30) scoreClass = 'score-mid';
                
                return (
                  <div 
                    key={plan.product_id} 
                    className={`pipeline-card glass-card hover-glow ${plan.status === 'Completed' ? 'success-card' : ''} ${attScore >= 60 ? 'critical-glow' : ''}`}
                  >
                    <div className="card-header">
                      <div className="prod-title">
                        <span className="prod-code">#{plan.product_id}</span>
                        <h4>{plan.product_name}</h4>
                      </div>
                      <div className="badge-stack">
                        {plan.status === 'Completed' ? (
                          <span className="status-badge status-completed">COMPLETED</span>
                        ) : plan.status === 'Running' ? (
                          <span className="status-badge status-running">RUNNING</span>
                        ) : (
                          <span className="status-badge status-pending">PENDING</span>
                        )}
                        {attScore > 0 && (
                          <span className={`att-score-badge ${scoreClass}`}>
                            Risk: {attScore}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="progress-section">
                      <div className="progress-labels">
                        <span>Progress ({plan.progress}%)</span>
                        <span className="qty-fraction">{plan.ready} / {plan.target} Pcs</span>
                      </div>
                      <div className="progress-bar-bg">
                        <div 
                          className={`progress-bar-fill ${plan.status === 'Completed' ? 'bg-green' : plan.progress < 30 ? 'bg-orange' : 'bg-primary'}`} 
                          style={{ width: `${plan.progress}%` }} 
                        />
                      </div>
                    </div>

                    <div className="card-footer-metrics">
                      <div className="footer-metric">
                        <span className="f-label">Assignee / Karigar</span>
                        <span className="f-value text-glow">{plan.karigar_name}</span>
                      </div>
                      <div className="footer-metric">
                        <span className="f-label">Promise Date</span>
                        <span className={`f-value ${attObj?.is_delivery_overdue ? 'text-red font-bold' : ''}`}>
                          {plan.promise_date ? new Date(plan.promise_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A'}
                        </span>
                      </div>
                    </div>

                    {attObj && attObj.reasons && attObj.reasons.length > 0 && attScore >= 30 && (
                      <div className="card-alert-banner">
                        <AlertTriangle size={14} />
                        <span>{attObj.reasons[0]}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 2. ATTENTION ENGINE TAB */}
        {activeSubTab === 'attention' && (
          <div className="attention-panel animate-fade-in">
            <div className="panel-intro-alert glass-card">
              <div className="intro-icon">
                <Activity size={24} className="pulse-icon text-glow" />
              </div>
              <div className="intro-text">
                <h4>Dynamic Attention Scoring Engine</h4>
                <p>
                  Evaluates delayed starts, AI-estimated finish date conflicts, overdue handoffs, sales surges, and stockout indicators. Ordered by immediate operational priority.
                </p>
              </div>
            </div>

            <div className="attention-list-grid">
              {attention.filter(a => a.needs_attention).length === 0 ? (
                <div className="empty-state glass-card">
                  <CheckCircle size={36} className="text-green" />
                  <p>All pipelines running optimally. Zero high-priority concerns.</p>
                </div>
              ) : (
                attention.map(att => {
                  const plan = plans.find(p => String(p.product_id) === String(att.production_code));
                  if (!plan) return null;

                  let scoreClass = 'high-score';
                  let borderClass = 'border-high';
                  if (att.attention_score < 30) {
                    scoreClass = 'low-score';
                    borderClass = 'border-low';
                  } else if (att.attention_score < 60) {
                    scoreClass = 'mid-score';
                    borderClass = 'border-mid';
                  }

                  return (
                    <div key={att.production_code} className={`attention-card glass-card hover-glow ${borderClass}`}>
                      <div className="att-left">
                        <div className={`score-circle ${scoreClass}`}>
                          <span className="score-num">{att.attention_score}</span>
                          <span className="score-lbl">Risk</span>
                        </div>
                      </div>

                      <div className="att-mid">
                        <div className="att-header-row">
                          <span className="att-code">#{att.production_code}</span>
                          <h4 className="att-title">{plan.product_name}</h4>
                          <span className="att-karigar font-mono">Assigned to: {plan.karigar_name}</span>
                        </div>

                        <div className="reasons-bullet-box">
                          {att.reasons.map((reason, idx) => {
                            const isSpike = reason.includes('HIGH ORDERS') || reason.includes('demand');
                            const isPurple = reason.includes('reproduction');
                            return (
                              <div key={idx} className={`reason-item ${isSpike ? 'spike-reason' : isPurple ? 'reproduction-reason' : ''}`}>
                                <ArrowRight size={12} />
                                <span>{reason}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="att-right">
                        <div className="att-mini-stats">
                          <div className="mini-stat-item">
                            <span className="m-lbl">Avg Sales</span>
                            <span className="m-val">{att.avg_sales} Pcs</span>
                          </div>
                          <div className="mini-stat-item">
                            <span className="m-lbl">Current Orders</span>
                            <span className={`m-val ${att.is_sales_spike ? 'text-red font-bold animate-pulse' : ''}`}>{att.sale_qty} Pcs</span>
                          </div>
                          <div className="mini-stat-item">
                            <span className="m-lbl">Days Left</span>
                            <span className={`m-val ${att.days_to_delivery <= 0 ? 'text-red font-bold' : ''}`}>
                              {att.days_to_delivery !== null ? `${att.days_to_delivery}d` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 3. STOCK & DEMAND TAB */}
        {activeSubTab === 'stock' && (
          <div className="stock-panel animate-fade-in">
            {/* Top row: raw materials list */}
            <div className="raw-material-grid">
              <div className="raw-header-card glass-card">
                <Boxes size={24} className="text-primary" />
                <div>
                  <h4>Raw Fabric & Trim Stocks</h4>
                  <p>Central Warehouse levels tracked via CDH REST APIs</p>
                </div>
              </div>

              {Object.entries(subpartInventory).map(([name, qty]) => {
                const isOutOfStock = qty === 0;
                const isLow = qty > 0 && qty <= 100;
                
                return (
                  <div key={name} className={`material-pill-card glass-card ${isOutOfStock ? 'out-of-stock-card' : isLow ? 'low-stock-card' : ''}`}>
                    <span className="mat-name">{name}</span>
                    <h3 className={`mat-qty ${isOutOfStock ? 'text-red animate-pulse' : isLow ? 'text-amber' : ''}`}>
                      {qty} <span className="mat-unit">units</span>
                    </h3>
                    <span className="mat-status">
                      {isOutOfStock ? '⚠️ Out of Stock' : isLow ? '⚡ Reorder Immediately' : '✓ Sufficient'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Demands Table and Reproduction alerts */}
            <div className="demands-comparison-box">
              <div className="table-header-row">
                <h3>Stock Reserves & Demand Ratios</h3>
                <span className="table-subtitle">Comparing local inventory against active sales reserves</span>
              </div>

              <div className="reserves-list">
                {stockInventory.length === 0 ? (
                  <div className="empty-state glass-card">
                    <p>No active reservations available.</p>
                  </div>
                ) : (
                  stockInventory.map(stock => {
                    const plan = plans.find(p => String(p.product_id) === String(stock.product_id));
                    if (!plan) return null;

                    const avail = stock.available_stock;
                    const res = stock.reserved_stock;
                    const isDeficit = avail < res;
                    const isCriticalDeficit = avail === 0 && res > 0;
                    const isRunning = plan.status === 'Running';
                    
                    // Trigger purple alert if deficit and not running
                    const triggerPurpleAlert = isDeficit && !isRunning;

                    return (
                      <div 
                        key={stock.product_id} 
                        className={`reserve-item-row glass-card ${isCriticalDeficit ? 'critical-stock' : triggerPurpleAlert ? 'purple-reproduction-row' : isDeficit ? 'orange-deficit' : ''}`}
                      >
                        <div className="res-main">
                          <span className="res-code">#{stock.product_id}</span>
                          <span className="res-title">{plan.product_name}</span>
                        </div>

                        <div className="res-bars">
                          <div className="res-bar-container">
                            <span className="b-label">Available: {avail}</span>
                            <div className="b-bar-bg">
                              <div className="b-bar-fill avail-fill" style={{ width: `${Math.min(100, (avail / Math.max(1, avail + res)) * 100)}%` }} />
                            </div>
                          </div>
                          
                          <div className="res-bar-container">
                            <span className="b-label">Reserved: {res}</span>
                            <div className="b-bar-bg">
                              <div className="b-bar-fill reserved-fill" style={{ width: `${Math.min(100, (res / Math.max(1, avail + res)) * 100)}%` }} />
                            </div>
                          </div>
                        </div>

                        <div className="res-status-wrap">
                          {triggerPurpleAlert ? (
                            <span className="res-badge purple-glow">PURPLE: REPRODUCE</span>
                          ) : isCriticalDeficit ? (
                            <span className="res-badge red-glow">RED: CRITICAL STOCK</span>
                          ) : isDeficit ? (
                            <span className="res-badge orange-glow">ORANGE: LOW STOCK</span>
                          ) : (
                            <span className="res-badge green-glow">STOCK OPTIMAL</span>
                          )}
                          <span className="res-action-status">
                            {isRunning ? '🛠 Manufacturing Active' : '⏸ Idle in Warehouse'}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4. KARIGAR STANDINGS TAB */}
        {activeSubTab === 'karigars' && (
          <div className="karigar-panel animate-fade-in">
            <div className="karigar-report-grid">
              {karigars.length === 0 ? (
                <div className="empty-state glass-card">
                  <p>No karigar activity records found.</p>
                </div>
              ) : (
                karigars.map(kar => {
                  let badgeClass = 'tag-ok';
                  let shadowClass = '';
                  let label = 'Healthy Standings';

                  if (kar.status === 'overloaded') {
                    badgeClass = 'tag-overloaded';
                    shadowClass = 'shadow-overloaded';
                    label = '⚠️ OVERLOADED';
                  } else if (kar.status === 'critical') {
                    badgeClass = 'tag-critical';
                    shadowClass = 'shadow-critical';
                    label = '🔥 CRITICAL DELAYS';
                  } else if (kar.status === 'at_risk') {
                    badgeClass = 'tag-at-risk';
                    shadowClass = 'shadow-at-risk';
                    label = '⚡ AT RISK';
                  } else if (kar.status === 'idle') {
                    badgeClass = 'tag-idle';
                    shadowClass = 'shadow-idle';
                    label = '⏸ IDLE CAPACITIES';
                  }

                  return (
                    <div key={kar.name} className={`karigar-profile-card glass-card ${shadowClass}`}>
                      <div className="kar-header">
                        <div className="kar-avatar">{kar.name.slice(0, 2).toUpperCase()}</div>
                        <div className="kar-main">
                          <h4>{kar.name}</h4>
                          <span className={`kar-status-badge ${badgeClass}`}>{label}</span>
                        </div>
                      </div>

                      <div className="kar-metrics">
                        <div className="kar-m-item">
                          <span className="val">{kar.active_jobs}</span>
                          <span className="lbl">Active Jobs</span>
                        </div>
                        <div className="kar-m-item">
                          <span className="val text-red">{kar.overdue_count}</span>
                          <span className="lbl">Overdue Jobs</span>
                        </div>
                        <div className="kar-m-item">
                          <span className="val text-amber">{kar.zero_progress_count}</span>
                          <span className="lbl">Zero Progress</span>
                        </div>
                      </div>

                      <div className="kar-footer">
                        <div className="avg-delay-row">
                          <Clock size={14} />
                          <span>Avg Job Delay: <strong>{kar.avg_days_overdue} days</strong></span>
                        </div>
                        <span className="job-scope">Oversees {kar.unique_productions} unique items</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

      </div>

      {/* ── Internal Embedded Styles ── */}
      <style>{`
        .production-dashboard-wrapper {
          display: flex;
          flex-direction: column;
          gap: 24px;
          animation: fadeIn 0.4s ease-out;
        }

        .dashboard-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          height: 350px;
          color: var(--text-dim);
        }

        .spinner-glow {
          width: 48px;
          height: 48px;
          border: 3px solid rgba(99, 102, 241, 0.1);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          box-shadow: 0 0 15px var(--primary-glow);
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .dashboard-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          height: 350px;
          text-align: center;
        }

        .error-icon {
          color: var(--accent-red);
          animation: pulse 2s infinite;
        }

        .retry-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--primary);
          border: none;
          color: white;
          padding: 8px 16px;
          border-radius: 10px;
          cursor: pointer;
          font-weight: 600;
          transition: transform 0.2s;
        }
        .retry-btn:hover {
          transform: translateY(-1px);
        }

        /* ── Banner ── */
        .dashboard-header-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 30px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.8) 100%);
          position: relative;
          overflow: hidden;
        }

        .banner-left {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .badge-row {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .live-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(99, 102, 241, 0.15);
          color: var(--primary);
          font-size: 0.7rem;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 20px;
          letter-spacing: 0.05em;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }

        .live-pill .pulse-dot {
          width: 6px;
          height: 6px;
          background: var(--primary);
          border-radius: 50%;
          box-shadow: 0 0 8px var(--primary);
          animation: pulse 1.5s infinite;
        }

        .online-pill {
          background: rgba(34, 197, 94, 0.15);
          color: var(--accent-green);
          font-size: 0.7rem;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 20px;
          letter-spacing: 0.05em;
          border: 1px solid rgba(34, 197, 94, 0.2);
        }

        .offline-pill {
          background: rgba(245, 158, 11, 0.15);
          color: var(--accent-amber);
          font-size: 0.7rem;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 20px;
          letter-spacing: 0.05em;
          border: 1px solid rgba(245, 158, 11, 0.2);
        }

        .banner-title {
          font-size: 1.8rem;
          font-weight: 800;
          letter-spacing: -0.5px;
          background: linear-gradient(to right, #ffffff, #c7d2fe);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .banner-desc {
          color: var(--text-dim);
          font-size: 0.9rem;
          max-width: 550px;
          line-height: 1.4;
        }

        .simulator-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(79, 70, 229, 0.2));
          border: 1px solid rgba(99, 102, 241, 0.4);
          color: var(--text-main);
          padding: 12px 20px;
          border-radius: 14px;
          cursor: pointer;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.3s ease;
          box-shadow: 0 4px 15px rgba(99, 102, 241, 0.1);
        }

        .simulator-btn:hover {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.4), rgba(79, 70, 229, 0.4));
          transform: translateY(-1px);
          box-shadow: 0 8px 25px rgba(99, 102, 241, 0.2);
        }

        .simulator-btn:active {
          transform: translateY(0);
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        /* ── Metrics Row ── */
        .metric-row-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }

        .metric-card {
          display: flex;
          align-items: center;
          gap: 18px;
          padding: 20px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .metric-card:hover {
          transform: translateY(-2px);
        }

        .metric-icon-wrap {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          flex-shrink: 0;
        }

        .primary-gradient { background: linear-gradient(135deg, #6366f1, #4f46e5); box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3); }
        .red-gradient { background: linear-gradient(135deg, #ef4444, #dc2626); box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3); }
        .amber-gradient { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3); }
        .green-gradient { background: linear-gradient(135deg, #22c55e, #16a34a); box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3); }

        .metric-details {
          display: flex;
          flex-direction: column;
        }

        .metric-label {
          color: var(--text-dim);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .metric-value {
          font-size: 1.5rem;
          font-weight: 800;
          color: var(--text-main);
          line-height: 1.2;
        }

        .value-total {
          font-size: 0.9rem;
          color: var(--text-dim);
          font-weight: 500;
        }

        .metric-subtext {
          color: var(--text-dim);
          font-size: 0.75rem;
          margin-top: 2px;
        }

        .danger-border:hover { border-color: rgba(239, 68, 68, 0.4); }
        .warning-border:hover { border-color: rgba(245, 158, 11, 0.4); }
        .success-border:hover { border-color: rgba(34, 197, 94, 0.4); }

        .text-red { color: #f87171 !important; }
        .text-amber { color: #fbbf24 !important; }
        .text-green { color: #34d399 !important; }

        /* ── Tabs bar ── */
        .dashboard-nav-tabs {
          display: flex;
          padding: 8px;
          gap: 8px;
          overflow-x: auto;
          scrollbar-width: none;
        }

        .dashboard-nav-tabs::-webkit-scrollbar { display: none; }

        .tab-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          background: transparent;
          border: none;
          color: var(--text-dim);
          padding: 12px 20px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .tab-btn:hover {
          color: var(--text-main);
          background: rgba(255, 255, 255, 0.03);
        }

        .tab-btn.active {
          color: var(--primary);
          background: rgba(99, 102, 241, 0.1);
        }

        .tab-btn.alert {
          color: #f87171;
          animation: blinkBorder 2s infinite;
        }

        @keyframes blinkBorder {
          0%, 100% { border-bottom: 2px solid transparent; }
          50% { border-bottom: 2px solid #ef4444; }
        }

        /* ── Pipeline Grid ── */
        .pipeline-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
          gap: 20px;
        }

        .pipeline-card {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: 20px;
          transition: all 0.3s ease;
        }

        .pipeline-card.critical-glow {
          border-color: rgba(239, 68, 68, 0.4);
          box-shadow: 0 10px 25px rgba(239, 68, 68, 0.08);
        }

        .pipeline-card.success-card {
          border-color: rgba(34, 197, 94, 0.2);
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }

        .prod-title {
          display: flex;
          flex-direction: column;
        }

        .prod-code {
          font-family: monospace;
          color: var(--text-dim);
          font-size: 0.75rem;
          font-weight: 700;
        }

        .prod-title h4 {
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--text-main);
        }

        .badge-stack {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }

        .status-badge {
          font-size: 0.6rem;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 6px;
          letter-spacing: 0.05em;
        }

        .status-badge.status-running { background: rgba(99, 102, 241, 0.15); color: var(--primary); }
        .status-badge.status-completed { background: rgba(34, 197, 94, 0.15); color: var(--accent-green); }
        .status-badge.status-pending { background: rgba(255, 255, 255, 0.05); color: var(--text-dim); }

        .att-score-badge {
          font-size: 0.65rem;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 6px;
        }

        .score-low { background: rgba(34, 197, 94, 0.15); color: var(--accent-green); }
        .score-mid { background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); }
        .score-high { background: rgba(239, 68, 68, 0.15); color: #f87171; font-weight: 800; animation: badgePulse 2s infinite; }

        .progress-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .progress-labels {
          display: flex;
          justify-content: space-between;
          font-size: 0.8rem;
          color: var(--text-dim);
          font-weight: 500;
        }

        .qty-fraction {
          color: var(--text-main);
          font-weight: 600;
        }

        .progress-bar-bg {
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.5s ease;
        }

        .bg-primary { background: linear-gradient(90deg, var(--primary), #4f46e5); }
        .bg-green { background: linear-gradient(90deg, var(--accent-green), #16a34a); }
        .bg-orange { background: linear-gradient(90deg, #f59e0b, #ef4444); }

        .card-footer-metrics {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          border-top: 1px solid var(--border);
          padding-top: 14px;
        }

        .footer-metric {
          display: flex;
          flex-direction: column;
        }

        .f-label {
          font-size: 0.7rem;
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .f-value {
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--text-main);
          margin-top: 2px;
        }

        .text-glow {
          text-shadow: 0 0 6px var(--primary-glow);
        }

        .card-alert-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(239, 68, 68, 0.06);
          border: 1px solid rgba(239, 68, 68, 0.15);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 0.75rem;
          color: #f87171;
          margin-top: 4px;
        }

        /* ── Attention panel ── */
        .attention-panel {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .panel-intro-alert {
          display: flex;
          align-items: center;
          gap: 18px;
          padding: 20px;
          border-color: rgba(99, 102, 241, 0.2);
          background: linear-gradient(to right, rgba(99, 102, 241, 0.05), transparent);
        }

        .pulse-icon {
          color: var(--primary);
          animation: heartbeat 2s infinite;
        }

        @keyframes heartbeat {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }

        .intro-text h4 {
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-main);
        }

        .intro-text p {
          font-size: 0.85rem;
          color: var(--text-dim);
          margin-top: 2px;
        }

        .attention-list-grid {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .attention-card {
          display: flex;
          align-items: center;
          gap: 24px;
          padding: 20px;
          transition: transform 0.2s;
        }

        .attention-card:hover {
          transform: translateX(4px);
        }

        .border-high { border-left: 4px solid #ef4444; }
        .border-mid { border-left: 4px solid #f59e0b; }
        .border-low { border-left: 4px solid #22c55e; }

        .score-circle {
          width: 58px;
          height: 58px;
          border-radius: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-weight: 800;
        }

        .high-score {
          background: rgba(239, 68, 68, 0.1);
          border: 2px solid rgba(239, 68, 68, 0.4);
          color: #f87171;
          box-shadow: 0 0 10px rgba(239, 68, 68, 0.1);
        }

        .mid-score {
          background: rgba(245, 158, 11, 0.1);
          border: 2px solid rgba(245, 158, 11, 0.4);
          color: #fbbf24;
        }

        .low-score {
          background: rgba(34, 197, 94, 0.1);
          border: 2px solid rgba(34, 197, 94, 0.4);
          color: #34d399;
        }

        .score-num {
          font-size: 1.3rem;
          line-height: 1.1;
        }

        .score-lbl {
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          opacity: 0.8;
        }

        .att-mid {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .att-header-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .att-code {
          font-family: monospace;
          font-size: 0.75rem;
          background: rgba(255, 255, 255, 0.05);
          padding: 2px 6px;
          border-radius: 4px;
          color: var(--text-dim);
        }

        .att-title {
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--text-main);
        }

        .att-karigar {
          font-size: 0.75rem;
          color: var(--text-dim);
          background: rgba(99, 102, 241, 0.08);
          padding: 2px 8px;
          border-radius: 4px;
        }

        .reasons-bullet-box {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .reason-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.82rem;
          color: var(--text-dim);
        }

        .reason-item svg {
          color: var(--primary);
          flex-shrink: 0;
        }

        .spike-reason {
          color: #fb7185;
          font-weight: 600;
        }
        .spike-reason svg {
          color: #fb7185;
        }

        .reproduction-reason {
          color: #c084fc;
          font-weight: 600;
        }
        .reproduction-reason svg {
          color: #c084fc;
        }

        .att-mini-stats {
          display: flex;
          gap: 16px;
        }

        .mini-stat-item {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }

        .m-lbl {
          font-size: 0.65rem;
          color: var(--text-dim);
          text-transform: uppercase;
        }

        .m-val {
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--text-main);
          margin-top: 2px;
        }

        /* ── Stock Panel ── */
        .stock-panel {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .raw-material-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
        }

        .raw-header-card {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 20px;
        }

        .raw-header-card h4 {
          font-size: 1rem;
          font-weight: 700;
        }

        .raw-header-card p {
          font-size: 0.8rem;
          color: var(--text-dim);
        }

        .material-pill-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 16px;
          position: relative;
        }

        .mat-name {
          font-size: 0.75rem;
          color: var(--text-dim);
          text-transform: uppercase;
          font-weight: 700;
        }

        .mat-qty {
          font-size: 1.5rem;
          font-weight: 800;
          line-height: 1;
        }

        .mat-unit {
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--text-dim);
        }

        .mat-status {
          font-size: 0.7rem;
          color: var(--text-dim);
          font-weight: 600;
        }

        .out-of-stock-card {
          border-color: rgba(239, 68, 68, 0.3);
          background: rgba(239, 68, 68, 0.05);
        }

        .low-stock-card {
          border-color: rgba(245, 158, 11, 0.3);
          background: rgba(245, 158, 11, 0.03);
        }

        .demands-comparison-box {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .table-header-row {
          display: flex;
          flex-direction: column;
        }

        .table-header-row h3 {
          font-size: 1.15rem;
          font-weight: 700;
        }

        .table-subtitle {
          font-size: 0.8rem;
          color: var(--text-dim);
        }

        .reserves-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .reserve-item-row {
          display: grid;
          grid-template-columns: 1.2fr 2fr 1.5fr;
          align-items: center;
          gap: 20px;
          padding: 16px 20px;
          transition: transform 0.2s;
        }

        .reserve-item-row:hover {
          transform: translateY(-1px);
        }

        .res-main {
          display: flex;
          flex-direction: column;
        }

        .res-code {
          font-family: monospace;
          font-size: 0.72rem;
          color: var(--text-dim);
        }

        .res-title {
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--text-main);
        }

        .res-bars {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .res-bar-container {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .b-label {
          font-size: 0.72rem;
          color: var(--text-dim);
          width: 90px;
          font-weight: 600;
        }

        .b-bar-bg {
          flex: 1;
          height: 6px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
          overflow: hidden;
        }

        .b-bar-fill {
          height: 100%;
          border-radius: 3px;
        }

        .avail-fill { background: linear-gradient(90deg, #6366f1, #818cf8); }
        .reserved-fill { background: linear-gradient(90deg, #f59e0b, #fbbf24); }

        .res-status-wrap {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }

        .res-badge {
          font-size: 0.65rem;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 6px;
          letter-spacing: 0.02em;
        }

        .green-glow { background: rgba(34, 197, 94, 0.15); color: var(--accent-green); }
        .orange-glow { background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); }
        
        /* Critical Stock Out: red glow */
        .red-glow { 
          background: rgba(239, 68, 68, 0.15); 
          color: #f87171; 
          border: 1px solid rgba(239, 68, 68, 0.25);
          box-shadow: 0 0 10px rgba(239, 68, 68, 0.15);
          animation: badgePulse 2s infinite;
        }

        /* Reproduction needed: neon purple glassmorphic glow */
        .purple-glow {
          background: rgba(168, 85, 247, 0.18);
          color: #c084fc;
          border: 1px solid rgba(168, 85, 247, 0.35);
          box-shadow: 0 0 12px rgba(168, 85, 247, 0.25);
          text-shadow: 0 0 5px rgba(168, 85, 247, 0.5);
        }

        .purple-reproduction-row {
          border-color: rgba(168, 85, 247, 0.35);
          background: rgba(168, 85, 247, 0.03);
          box-shadow: inset 0 0 10px rgba(168, 85, 247, 0.02);
        }

        .critical-stock {
          border-color: rgba(239, 68, 68, 0.35);
          background: rgba(239, 68, 68, 0.03);
        }

        .orange-deficit {
          border-color: rgba(245, 158, 11, 0.2);
        }

        .res-action-status {
          font-size: 0.7rem;
          color: var(--text-dim);
          font-weight: 500;
        }

        /* ── Karigar Panel ── */
        .karigar-panel {
          width: 100%;
        }

        .karigar-report-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 20px;
        }

        .karigar-profile-card {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 20px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .karigar-profile-card:hover {
          transform: translateY(-3px);
        }

        /* Karigar specific shadows/glows based on standings */
        .shadow-overloaded {
          border-color: rgba(245, 158, 11, 0.3);
          box-shadow: 0 8px 24px rgba(245, 158, 11, 0.04);
        }
        .shadow-critical {
          border-color: rgba(239, 68, 68, 0.35);
          box-shadow: 0 10px 25px rgba(239, 68, 68, 0.07);
        }
        .shadow-at-risk {
          border-color: rgba(239, 68, 68, 0.2);
        }
        .shadow-idle {
          border-color: rgba(255, 255, 255, 0.08);
        }

        .kar-header {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .kar-avatar {
          width: 42px;
          height: 42px;
          background: linear-gradient(135deg, var(--primary), #4f46e5);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: white;
          font-size: 0.95rem;
          box-shadow: 0 4px 10px var(--primary-glow);
        }

        .kar-main {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .kar-main h4 {
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--text-main);
        }

        .kar-status-badge {
          font-size: 0.62rem;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 4px;
          letter-spacing: 0.02em;
        }

        .tag-ok { background: rgba(34, 197, 94, 0.15); color: var(--accent-green); }
        .tag-overloaded { background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); }
        .tag-critical { background: rgba(239, 68, 68, 0.15); color: #f87171; animation: badgePulse 2s infinite; }
        .tag-at-risk { background: rgba(239, 68, 68, 0.1); color: #f87171; }
        .tag-idle { background: rgba(255, 255, 255, 0.05); color: var(--text-dim); }

        .kar-metrics {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          background: rgba(15, 23, 42, 0.3);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px;
          text-align: center;
        }

        .kar-m-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .kar-m-item .val {
          font-size: 1.05rem;
          font-weight: 800;
          color: var(--text-main);
        }

        .kar-m-item .lbl {
          font-size: 0.6rem;
          color: var(--text-dim);
          text-transform: uppercase;
        }

        .kar-footer {
          display: flex;
          flex-direction: column;
          gap: 6px;
          border-top: 1px solid var(--border);
          padding-top: 12px;
        }

        .avg-delay-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.78rem;
          color: var(--text-dim);
        }

        .avg-delay-row svg {
          color: var(--text-dim);
        }

        .job-scope {
          font-size: 0.72rem;
          color: var(--text-dim);
        }

        /* ── Common Utilities ── */
        .empty-state {
          grid-column: 1 / -1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 40px;
          color: var(--text-dim);
          text-align: center;
        }

        .empty-state p {
          font-size: 0.9rem;
          font-weight: 500;
        }

        .animate-fade-in {
          animation: fadeIn 0.3s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 768px) {
          .dashboard-header-banner {
            flex-direction: column;
            align-items: flex-start;
            gap: 20px;
            padding: 20px;
          }
          
          .simulator-btn {
            width: 100%;
            justify-content: center;
          }

          .reserve-item-row {
            grid-template-columns: 1fr;
            gap: 14px;
            padding: 16px;
          }

          .res-status-wrap {
            align-items: flex-start;
          }
        }
      `}</style>

    </div>
  );
};

export default ProductionDashboard;
