import React, { useState, useEffect } from 'react';
import axios from 'axios';

// Inject admin key so the frontend can access the backend admin endpoints
axios.defaults.headers.common['X-API-KEY'] = '22d3b2c0dae1ac2c50df8ce8be3c36c2159ab8cd0856eacb';

import { 
  Database, 
  Activity, 
  Layers, 
  RefreshCw, 
  Play, 
  ChevronRight, 
  Clock, 
  FileJson,
  CheckCircle2,
  AlertCircle,
  History,
  Terminal,
  ArrowRight,
  Camera,
  Search,
  ImagePlus,
  Trash2,
  ShieldCheck,
  Building2,
  PlusCircle,
  Plus,
  LogOut,
  Send,
  XCircle,
  Edit2,
  Eye,
  Info,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  Package,
  Image
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';




const getApiBase = () => {
  const host = window.location.hostname;
  // On any localhost/LAN port, talk directly to CDH backend (admin endpoints are blocked by nginx)
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
    return 'http://localhost:8000/api/v1';
  }
  // External URL (ngrok / tailscale) → route through Nginx /cdh-api/ (admin blocked intentionally)
  return `${window.location.protocol}//${window.location.host}/cdh-api/api/v1`;
};

const API_BASE = getApiBase();




function App() {
  const [stats, setStats] = useState({ raw_count: 0, processed_count: 0, categories: [], uptime: '100%', db_status: 'unknown' });
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const [view, setView] = useState('dashboard'); // 'dashboard', 'integrations', 'rules', 'ecosystem'
  


  const [keys, setKeys] = useState([]);
  const [rules, setRules] = useState([]);
  const [newKeyProject, setNewKeyProject] = useState('');
  const [newKeyScope, setNewKeyScope] = useState('');
  const [newKeyCallback, setNewKeyCallback] = useState('');
  
  const [newRuleSource, setNewRuleSource] = useState('');
  const [newRuleTarget, setNewRuleTarget] = useState('');
  const [newRuleMapping, setNewRuleMapping] = useState('');
  
  const [transactions, setTransactions] = useState([]);
  const [filterSource, setFilterSource] = useState('all');

  // Ecosystem Control Hub states
  const [pm2Processes, setPm2Processes] = useState([]);
  const [tunnelDetails, setTunnelDetails] = useState({ public_url: '', proxy_port: 8080, mappings: [] });
  const [selectedLogProcess, setSelectedLogProcess] = useState('');
  const [logType, setLogType] = useState('out');
  const [processLogs, setProcessLogs] = useState([]);

  const fetchEcosystemData = async () => {
    try {
      const [pm2Res, tunnelRes] = await Promise.all([
        axios.get(`${API_BASE}/admin/pm2/list`),
        axios.get(`${API_BASE}/admin/tunnel/status`)
      ]);
      setPm2Processes(pm2Res.data);
      setTunnelDetails(tunnelRes.data);
      if (!selectedLogProcess && pm2Res.data.length > 0) {
        setSelectedLogProcess(pm2Res.data[0].name);
      }
    } catch (err) {
      console.error("Failed to fetch ecosystem data:", err);
    }
  };

  const handlePm2Action = async (name, action) => {
    try {
      await axios.post(`${API_BASE}/admin/pm2/action`, null, { params: { name, action } });
      await fetchEcosystemData();
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    }
  };

  const fetchProcessLogs = async () => {
    if (!selectedLogProcess) return;
    try {
      const res = await axios.get(`${API_BASE}/admin/pm2/logs`, {
        params: { name: selectedLogProcess, log_type: logType }
      });
      setProcessLogs(res.data.logs || []);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    }
  };

  useEffect(() => {
    if (view === 'ecosystem') {
      fetchEcosystemData();
      const interval = setInterval(fetchEcosystemData, 5000);
      return () => clearInterval(interval);
    }
  }, [view]);

  useEffect(() => {
    if (view === 'ecosystem' && selectedLogProcess) {
      fetchProcessLogs();
      const interval = setInterval(fetchProcessLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [view, selectedLogProcess, logType]);

  const fetchData = async () => {
    try {
      const [statsRes, rawRes, keysRes, rulesRes, transRes] = await Promise.allSettled([
        axios.get(`${API_BASE}/admin/stats`),
        axios.get(`${API_BASE}/admin/raw`),
        axios.get(`${API_BASE}/admin/keys`),
        axios.get(`${API_BASE}/admin/rules`),
        axios.get(`${API_BASE}/admin/transactions`)
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
      if (rawRes.status === 'fulfilled') setRawData(rawRes.value.data);
      if (keysRes.status === 'fulfilled') setKeys(keysRes.value.data);
      if (rulesRes.status === 'fulfilled') setRules(rulesRes.value.data);
      if (transRes.status === 'fulfilled') setTransactions(transRes.value.data);
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    try {
      const scope = newKeyScope ? newKeyScope.split(',').map(s => s.trim()) : null;
      await axios.post(`${API_BASE}/admin/keys`, null, { 
        params: { project_name: newKeyProject, scope: scope, callback_url: newKeyCallback } 
      });
      setNewKeyProject('');
      setNewKeyScope('');
      setNewKeyCallback('');
      await fetchData();
    } catch (err) {
      alert("Key creation failed");
    }
  };

  const handleCreateRule = async (e) => {
    e.preventDefault();
    try {
      const mappings = newRuleMapping ? JSON.parse(newRuleMapping) : null;
      await axios.post(`${API_BASE}/admin/rules`, {
        source: newRuleSource,
        target_category: newRuleTarget,
        field_mappings: mappings
      });
      setNewRuleSource('');
      setNewRuleTarget('');
      setNewRuleMapping('');
      await fetchData();
    } catch (err) {
      alert("Rule creation failed: " + err.message);
    }
  };

  const handleRevokeKey = async (id) => {
    if (!confirm("Revoke this key?")) return;
    try {
      await axios.delete(`${API_BASE}/admin/keys/${id}`);
      await fetchData();
    } catch (err) {
      alert("Revocation failed");
    }
  };

  const handleDeleteRule = async (id) => {
    if (!confirm("Delete this rule?")) return;
    try {
      await axios.delete(`${API_BASE}/admin/rules/${id}`);
      await fetchData();
    } catch (err) {
      alert("Rule deletion failed");
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // refresh every 10s
    return () => {
      clearInterval(interval);
    };
  }, []);


  const handleSync = async () => {
    setSyncing(true);
    try {
      await axios.post(`${API_BASE}/admin/ingest`, null, { params: { endpoint: '/api/v1/test' } });
      await fetchData();
    } catch (err) {
      alert("Sync failed: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleProcess = async () => {
    setProcessing(true);
    try {
      await axios.post(`${API_BASE}/admin/process`);
      await fetchData();
    } catch (err) {
      alert("Processing failed: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // Mock trend data for chart
  const trendData = [65, 45, 75, 55, 90, 60, 40, 85, 95, 70, 50, 45];

  return (
    <div className="min-h-screen p-6 md:p-12 text-white/90">
      {/* Navigation Tabs */}
      <nav className="flex gap-4 mb-10 overflow-x-auto pb-4">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: <Database size={18}/> },
          { id: 'operations', label: 'Operations', icon: <History size={18}/> },
          { id: 'integrations', label: 'Integrations', icon: <Layers size={18}/> },
          { id: 'rules', label: 'Processing Rules', icon: <Play size={18}/> },
          { id: 'catalog', label: 'Product Catalog', icon: <Package size={18}/> },
          { id: 'matcher', label: 'Dress Matcher', icon: <Camera size={18}/> },
          { id: 'ecosystem', label: 'Ecosystem Control', icon: <Terminal size={18}/> }
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => setView(tab.id)}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-bold transition-all whitespace-nowrap ${view === tab.id ? 'bg-blue-600 shadow-lg shadow-blue-600/30 ring-2 ring-blue-400/20' : 'bg-white/5 hover:bg-white/10 text-white/60'}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {view === 'dashboard' ? (
        <>
          {/* Header */}
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12">
            <div>
              <h1 className="text-5xl font-black bg-gradient-to-r from-blue-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent tracking-tighter">
                Central Data Hub
              </h1>
              <p className="text-white/30 mt-2 font-medium tracking-wide">Intelligent Data Orchestrator v2.0</p>
            </div>
            <div className="flex gap-4 mt-6 md:mt-0">
               <button 
                onClick={handleSync}
                disabled={syncing}
                className={`flex items-center gap-2 px-6 py-4 rounded-2xl font-bold transition-all shadow-xl ${syncing ? 'bg-amber-500/50 cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-400 active:scale-95 shadow-amber-500/20'}`}
              >
                <RefreshCw size={20} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing...' : 'Sync Active'}
              </button>
              <button 
                onClick={handleProcess}
                disabled={processing}
                className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold transition-all shadow-xl ${processing ? 'bg-teal-500/50 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-500 active:scale-95 shadow-teal-500/20'}`}
              >
                <Play size={20} className={processing ? 'animate-pulse' : ''} />
                {processing ? 'Processing...' : 'Run Processing'}
              </button>
            </div>
          </header>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
            <StatCard icon={<Database className="text-blue-400" />} label="Storage - Raw" value={stats.raw_count} color="blue" />
            <StatCard icon={<Layers className="text-teal-400" />} label="Storage - Processed" value={stats.processed_count} color="teal" />
            <StatCard icon={<Activity className="text-purple-400" />} label="System Pulse" value="Optimized" color="purple" />
            <StatCard icon={<RefreshCw className="text-emerald-400" />} label="Active Scopes" value={stats.categories?.length || 0} color="emerald" />
          </div>

          {/* Charts & Main Content */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-8">
              <div className="glass-panel rounded-[2.5rem] p-10 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
                  <Database size={200} />
                </div>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 gap-6">
                  <div>
                    <h2 className="text-2xl font-black mb-1">Ingestion Trends</h2>
                    <p className="text-white/30 text-sm">Real-time data flow velocity (last 12h)</p>
                  </div>
                  <div className="flex gap-1 items-end h-20">
                    {trendData.map((val, i) => (
                      <div 
                        key={i} 
                        style={{ height: `${val}%` }} 
                        className="w-3 bg-gradient-to-t from-blue-600 to-teal-400 rounded-t-sm opacity-60 hover:opacity-100 transition-opacity"
                      />
                    ))}
                  </div>
                </div>
                
                <div className="space-y-4 overflow-y-auto max-h-[500px] pr-4 custom-scrollbar">
                  <AnimatePresence>
                    {rawData.length === 0 && (
                      <p className="text-center text-white/20 py-20 italic">Awaiting synchronization...</p>
                    )}
                    {rawData.map((item, idx) => (
                      <motion.div 
                        key={item.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.03 }}
                        onClick={() => setSelectedItem(item)}
                        className="glass-card p-5 rounded-2xl flex items-center justify-between cursor-pointer group border-l-4 border-l-blue-500/30 hover:border-l-blue-400"
                      >
                        <div className="flex items-center gap-5">
                          <div className={`p-4 rounded-xl ${item.method === 'WEBHOOK' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                            {item.method === 'WEBHOOK' ? <Activity size={22} /> : <RefreshCw size={22} />}
                          </div>
                          <div>
                            <div className="font-black text-white/90 group-hover:text-blue-400 transition-colors uppercase text-sm tracking-widest">{item.endpoint}</div>
                            <div className="text-xs text-white/20 font-bold mt-1 uppercase tracking-tighter">{new Date(item.received_at).toLocaleString()}</div>
                          </div>
                        </div>
                        <ChevronRight size={20} className="group-hover:translate-x-2 transition-transform opacity-30 group-hover:opacity-100" />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            <div className="space-y-8">
              <div className="glass-panel rounded-[2.5rem] p-10 h-full min-h-[500px] border-t border-t-white/5">
                 <h2 className="text-2xl font-black mb-10 flex items-center gap-3">
                  <FileJson size={28} className="text-amber-400" />
                  Payload Inspector
                </h2>
                {selectedItem ? (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                    <div className="mb-8 space-y-4">
                      <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Origin Source</div>
                        <div className="text-lg font-bold text-blue-400">{selectedItem.source}</div>
                      </div>
                      <div className="flex gap-4">
                        <div className="flex-1 p-4 rounded-2xl bg-white/5 border border-white/5">
                          <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Method</div>
                          <div className="font-bold text-teal-400">{selectedItem.method}</div>
                        </div>
                        <div className="flex-1 p-4 rounded-2xl bg-white/5 border border-white/5">
                          <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Record ID</div>
                          <div className="font-bold text-emerald-400">#{selectedItem.id}</div>
                        </div>
                      </div>
                    </div>
                    <div className="glass-panel bg-black/50 rounded-2xl p-8 font-mono text-xs max-h-[450px] overflow-auto shadow-inner border border-white/10 group">
                      <pre className="text-white/60 leading-relaxed overflow-x-hidden group-hover:text-white/80 transition-colors whitespace-pre-wrap">
                        {JSON.stringify(selectedItem.data, null, 2)}
                      </pre>
                    </div>
                  </motion.div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center py-20 px-8">
                      <div className="w-24 h-24 rounded-3xl bg-white/5 flex items-center justify-center mb-8 rotate-3 transition-transform hover:rotate-0">
                        <FileJson size={48} className="text-white/5" />
                      </div>
                      <p className="text-white/20 font-medium text-sm leading-relaxed tracking-wide">Select an entry to drill down into the synchronized data cluster.</p>
                    </div>
                )}
              </div>
            </div>
          </div>
        </>

      ) : view === 'operations' ? (
        /* Operations/Transactions View */
        <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
            <div>
              <h2 className="text-4xl font-black italic uppercase tracking-tighter text-blue-400">Transaction Pulse</h2>
              <p className="text-white/30 font-medium">Global Audit Log & Activity Timeline</p>
            </div>
            <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/5 overflow-x-auto no-scrollbar">
              {['all', ...new Set(transactions.map(t => t.content?._source || 'unknown'))].map(source => (
                <button
                  key={source}
                  onClick={() => setFilterSource(source)}
                  className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${filterSource === source ? 'bg-blue-600 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                >
                  {source}
                </button>
              ))}
            </div>
          </header>

          <div className="grid grid-cols-1 gap-6 relative">
            <div className="absolute left-[39px] top-10 bottom-10 w-px bg-gradient-to-b from-blue-500/50 via-teal-500/20 to-transparent hidden md:block" />
            
            {transactions
              .filter(t => filterSource === 'all' || (t.content?._source || 'unknown') === filterSource)
              .map((t, idx) => (
              <motion.div 
                key={t.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="flex items-start gap-8 group"
              >
                <div className="w-20 hidden md:flex flex-col items-end pt-4 opacity-30 group-hover:opacity-60 transition-opacity">
                  <div className="text-[10px] font-black uppercase tracking-tighter">{new Date(t.updated_at).toLocaleDateString()}</div>
                  <div className="text-xs font-mono">{new Date(t.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>

                <div className={`relative z-10 w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg ${
                  t.category === 'sales' ? 'bg-emerald-500 shadow-emerald-500/20 text-emerald-950' : 
                  t.category === 'products' ? 'bg-blue-500 shadow-blue-500/20 text-blue-950' : 
                  'bg-purple-500 shadow-purple-500/20 text-purple-950'
                }`}>
                  {t.category === 'sales' ? <CheckCircle2 size={24} /> : t.category === 'products' ? <Terminal size={24} /> : <Layers size={24} />}
                </div>

                <div className="flex-1 glass-panel p-8 rounded-[2rem] border border-white/5 hover:bg-white/[0.04] transition-all group-hover:translate-x-1 outline outline-transparent hover:outline-blue-500/20">
                  <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-6">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                          t.category === 'sales' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                          t.category === 'products' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 
                          'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                        }`}>
                          {t.category}
                        </span>
                        <span className="text-white/20 text-[10px] uppercase font-bold tracking-tighter">PROJECT: {t.content?._source || 'DEFAULT'}</span>
                      </div>
                      <h3 className="text-xl font-black tracking-tight text-white/90">
                        {t.category === 'sales' ? `Order ${t.entity_id} processed for ${t.content?.customer?.name}` : 
                         t.category === 'products' ? `Product Cluster ${t.entity_id} Synchronized` :
                         `Transaction ${t.entity_id} final verification complete`}
                      </h3>
                      {t.category === 'sales' && (
                        <div className="mt-4 flex flex-wrap gap-4">
                           <div className="bg-emerald-500/10 px-4 py-2 rounded-xl border border-emerald-500/10">
                              <div className="text-[10px] uppercase font-bold text-emerald-400/60 leading-none mb-1">Items</div>
                              <div className="font-mono text-emerald-300">{(t.content?.cart || []).length} items</div>
                           </div>
                           <div className="bg-emerald-500/10 px-4 py-2 rounded-xl border border-emerald-500/10">
                              <div className="text-[10px] uppercase font-bold text-emerald-400/60 leading-none mb-1">Value</div>
                              <div className="font-mono text-emerald-300">₹{t.content?.totalValue?.toLocaleString()}</div>
                           </div>
                        </div>
                      )}
                      {t.category === 'products' && (
                        <div className="mt-4 flex flex-wrap gap-4">
                           <div className="bg-blue-500/10 px-4 py-2 rounded-xl border border-blue-500/10">
                              <div className="text-[10px] uppercase font-bold text-blue-400/60 leading-none mb-1">Identity</div>
                              <div className="font-mono text-blue-300">{t.content?.name}</div>
                           </div>
                           <div className="bg-blue-500/10 px-4 py-2 rounded-xl border border-blue-500/10">
                              <div className="text-[10px] uppercase font-bold text-blue-400/60 leading-none mb-1">Stock Position</div>
                              <div className="font-mono text-blue-300">{t.content?.pcs} PCS</div>
                           </div>
                        </div>
                      )}
                    </div>
                    <div className="flex lg:flex-col items-center lg:items-end gap-6 lg:gap-2">
                       <ArrowRight className="text-white/10 group-hover:text-blue-500 transition-colors" />
                       <div className="block md:hidden text-xs text-white/20 font-bold">{new Date(t.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            {transactions.length === 0 && (
              <div className="text-center py-40 bg-white/5 rounded-[3rem] border-2 border-dashed border-white/5">
                <History size={64} className="text-white/5 mx-auto mb-6" />
                <p className="text-white/20 font-black italic uppercase tracking-widest">Awaiting First Global Transaction Signal...</p>
              </div>
            )}
          </div>
        </div>
      ) : view === 'integrations' ? (
        /* Integrations View */
        <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
          <div className="glass-panel rounded-[2.5rem] p-12">
            <h2 className="text-3xl font-black mb-10 flex items-center gap-4 italic uppercase tracking-tighter">
              <Layers size={36} className="text-blue-500" />
              External Projects
            </h2>
            <form onSubmit={handleCreateKey} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12 items-end">
              <div className="space-y-3">
                <label className="text-xs font-black uppercase tracking-widest text-white/30 ml-2">Project Identity</label>
                <input 
                  type="text" 
                  value={newKeyProject}
                  onChange={(e) => setNewKeyProject(e.target.value)}
                  placeholder="e.g. Mobile App"
                  required
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-blue-500/20 text-sm transition-all focus:bg-white/10"
                />
              </div>
              <div className="space-y-3">
                <label className="text-xs font-black uppercase tracking-widest text-white/30 ml-2">Allowed Scopes</label>
                <input 
                  type="text" 
                  value={newKeyScope}
                  onChange={(e) => setNewKeyScope(e.target.value)}
                  placeholder="orders, inventory"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-blue-500/20 text-sm transition-all focus:bg-white/10"
                />
              </div>
              <div className="space-y-3">
                <label className="text-xs font-black uppercase tracking-widest text-white/30 ml-2">Callback URL (Auto-Dispatch)</label>
                <input 
                  type="text" 
                  value={newKeyCallback}
                  onChange={(e) => setNewKeyCallback(e.target.value)}
                  placeholder="https://app.com/webhook"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-blue-500/20 text-sm transition-all focus:bg-white/10"
                />
              </div>
              <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-8 py-4 rounded-2xl font-black transition-all shadow-2xl shadow-blue-600/30 active:scale-95 uppercase tracking-widest">
                Deploy Key
              </button>
            </form>

            <div className="space-y-6">
              <h3 className="text-xs font-black uppercase tracking-[0.3em] text-white/20 mb-8 ml-2">Project Clusters</h3>
              {keys.map((k) => (
                <div key={k.id} className="glass-card p-8 rounded-3xl flex flex-col lg:flex-row lg:items-center justify-between gap-8 border-r-4 border-r-blue-500/40">
                  <div className="space-y-3">
                    <div className="font-black text-2xl tracking-tight">{k.project_name}</div>
                    <div className="flex flex-wrap gap-2">
                      {k.scope ? k.scope.map(s => (
                        <span key={s} className="px-3 py-1 bg-blue-500/10 rounded-lg text-[10px] uppercase font-black tracking-widest text-blue-400 border border-blue-400/20">{s}</span>
                      )) : <span className="text-[10px] text-white/20 font-bold uppercase italic tracking-widest">Global Access Priority</span>}
                    </div>
                    {k.callback_url && (
                        <div className="text-[10px] font-mono text-emerald-400 break-all opacity-60">📡 Dispatching to: {k.callback_url}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="bg-black/60 px-6 py-4 rounded-2xl font-mono text-sm text-blue-400/80 border border-white/10 select-all shadow-inner">
                      {k.key}
                    </div>
                    <button 
                      onClick={() => handleRevokeKey(k.id)}
                      className="p-4 hover:bg-rose-500/20 text-rose-500 rounded-2xl transition-all"
                    >
                      <AlertCircle size={24} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : view === 'matcher' ? (
        /* Dress Matcher View */
        <MatcherDashboard apiBase={API_BASE} />
      ) : view === 'rules' ? (
          /* Rules View */
          <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <div className="glass-panel rounded-[2.5rem] p-12">
              <h2 className="text-3xl font-black mb-10 flex items-center gap-4 italic uppercase tracking-tighter text-teal-400">
                <Play size={36} />
                Transformation Rules
              </h2>
              
              <form onSubmit={handleCreateRule} className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                <div className="space-y-4">
                  <div className="space-y-3">
                    <label className="text-xs font-black uppercase tracking-widest text-white/30 ml-2">Source Identifier</label>
                    <input 
                      type="text" 
                      value={newRuleSource}
                      onChange={(e) => setNewRuleSource(e.target.value)}
                      placeholder="e.g. decent_erp"
                      required
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-teal-500/20 text-sm transition-all text-teal-100"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-black uppercase tracking-widest text-white/30 ml-2">Target Category</label>
                    <input 
                      type="text" 
                      value={newRuleTarget}
                      onChange={(e) => setNewRuleTarget(e.target.value)}
                      placeholder="e.g. orders"
                      required
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-teal-500/20 text-sm transition-all text-teal-100"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-widest text-white/30 ml-2">Field Mappings (JSON)</label>
                  <textarea 
                    value={newRuleMapping}
                    onChange={(e) => setNewRuleMapping(e.target.value)}
                    placeholder='{"decent_field": "mapped_field"}'
                    className="w-full h-[155px] bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-teal-500/20 text-sm transition-all font-mono text-teal-100 resize-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <button type="submit" className="w-full bg-teal-600 hover:bg-teal-500 px-8 py-5 rounded-2xl font-black transition-all shadow-2xl shadow-teal-600/30 active:scale-95 uppercase tracking-widest">
                    Activate Rule
                  </button>
                </div>
              </form>

              <div className="space-y-6">
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-white/20 mb-8 ml-2">Active Logic Engines</h3>
                {rules.map((r) => (
                  <div key={r.id} className="glass-card p-10 rounded-[2rem] border-l-8 border-l-teal-500/40 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity rotate-12">
                      <Play size={100} />
                    </div>
                    <div className="flex flex-col md:flex-row justify-between gap-10">
                      <div className="space-y-6">
                        <div className="flex items-center gap-8">
                          <div>
                             <div className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">Source</div>
                             <div className="text-3xl font-black">{r.source}</div>
                          </div>
                          <ChevronRight size={32} className="text-teal-500 rotate-0 transition-transform group-hover:rotate-12"/>
                          <div>
                             <div className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">Target</div>
                             <div className="text-3xl font-black text-teal-400">{r.target_category}</div>
                          </div>
                        </div>
                        {r.field_mappings && (
                          <div className="space-y-3">
                             <div className="text-[10px] font-black uppercase tracking-widest text-white/30 ml-1">Field Mappings</div>
                             <div className="flex flex-wrap gap-3">
                                {Object.entries(r.field_mappings).map(([src, dst]) => (
                                  <div key={src} className="px-4 py-2 bg-black/60 rounded-xl border border-white/5 text-xs font-mono">
                                    <span className="text-white/30">{src}</span>
                                    <span className="mx-3 text-teal-500">→</span>
                                    <span className="text-teal-300">{dst}</span>
                                  </div>
                                ))}
                             </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-start">
                        <button 
                          onClick={() => handleDeleteRule(r.id)}
                          className="p-4 hover:bg-rose-500/20 text-rose-500 rounded-3xl transition-all ring-1 ring-white/5"
                        >
                          <AlertCircle size={28} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {rules.length === 0 && (
                   <div className="text-center py-20 bg-white/5 rounded-3xl border border-dashed border-white/10">
                      <p className="text-white/20 font-bold italic tracking-widest uppercase text-sm">No active transformation logic found.</p>
                   </div>
                )}
              </div>
            </div>
          </div>
      ) : view === 'catalog' ? (
        <CatalogDashboard apiBase={API_BASE} />
      ) : (
        /* Ecosystem View */
        <EcosystemDashboard 
          processes={pm2Processes}
          tunnel={tunnelDetails}
          selectedProcess={selectedLogProcess}
          setSelectedProcess={setSelectedLogProcess}
          logType={logType}
          setLogType={setLogType}
          logs={processLogs}
          onAction={handlePm2Action}
          onRefresh={fetchEcosystemData}
          onFetchLogs={fetchProcessLogs}
        />
      )}
    </div>
  );
}

function MatcherDashboard({ apiBase }) {
  const [verifyFiles, setVerifyFiles] = useState([]);
  const [addFiles, setAddFiles] = useState([]);
  const [productName, setProductName] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ total_images_indexed: 0, unique_products: 0, model_loaded: false });
  const [products, setProducts] = useState([]);
  const [productToDelete, setProductToDelete] = useState(null);
  const [botLogs, setBotLogs] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [expandedStyle, setExpandedStyle] = useState(null);

  useEffect(() => {
    fetchMatcherData();
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await axios.get(`${apiBase}/admin/pm2/logs`, {
        params: { name: 'cdh-telegram-bot', log_type: 'err', limit: 50 }
      });
      setBotLogs(res.data.logs || []);
    } catch (err) {
      console.error("Failed to fetch bot logs:", err);
    }
  };

  const fetchMatcherData = async () => {
    try {
      const [statsRes, prodRes] = await Promise.all([
        axios.get(`${apiBase}/matcher/stats`),
        axios.get(`${apiBase}/matcher/products`)
      ]);
      setStats(statsRes.data);
      setProducts(prodRes.data.products);
    } catch (err) {
      console.error("Failed to fetch matcher data:", err);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (verifyFiles.length === 0) return;
    setLoading(true);
    const formData = new FormData();
    for (let i = 0; i < verifyFiles.length; i++) {
      formData.append('files', verifyFiles[i]);
    }
    try {
      const res = await axios.post(`${apiBase}/matcher/verify`, formData);
      setResults(res.data);
    } catch (err) {
      alert("Verification failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (addFiles.length === 0 || !productName) return;
    setLoading(true);
    const formData = new FormData();
    formData.append('product_name', productName);
    for (let i = 0; i < addFiles.length; i++) {
        formData.append('files', addFiles[i]);
    }
    try {
      await axios.post(`${apiBase}/matcher/add`, formData);
      alert("Product added successfully!");
      setProductName('');
      setAddFiles([]);
      fetchMatcherData();
    } catch (err) {
      alert("Add failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProduct = (productName) => {
    setProductToDelete(productName);
  };

  const confirmDelete = async () => {
    if (!productToDelete) return;
    setLoading(true);
    try {
      await axios.delete(`${apiBase}/matcher/products/${encodeURIComponent(productToDelete)}`);
      setProductToDelete(null);
      fetchMatcherData();
    } catch (err) {
      alert("Delete failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
        <div>
          <h2 className="text-4xl font-black italic uppercase tracking-tighter text-blue-400">Dress Matcher AI</h2>
          <p className="text-white/30 font-medium">Offline CLIP-based Vector Identification</p>
        </div>
        <div className="flex gap-4">
           <div className="glass-panel px-6 py-4 rounded-2xl border border-white/10">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Index Size</div>
              <div className="text-xl font-bold text-teal-400">{stats.total_images_indexed} Vectors</div>
           </div>
           <div className="glass-panel px-6 py-4 rounded-2xl border border-white/10">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Styles</div>
              <div className="text-xl font-bold text-blue-400">{new Set(products.map(p => p.name.split('-').slice(0,2).join('-'))).size} Styles</div>
           </div>
           <div className="glass-panel px-6 py-4 rounded-2xl border border-white/10">
              <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Variants</div>
              <div className="text-xl font-bold text-purple-400">{stats.unique_products} Colors</div>
           </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Verification Column */}
        <div className="space-y-8">
          <div className="glass-panel rounded-[2.5rem] p-10 border-t border-t-white/5">
            <h3 className="text-2xl font-black mb-6 flex items-center gap-3">
              <Search size={24} className="text-blue-400" />
              Verify Match
            </h3>
            <form onSubmit={handleVerify} className="space-y-6">
              <div className="relative group">
                <input 
                  type="file" 
                  multiple 
                  onChange={(e) => setVerifyFiles(e.target.files)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="border-2 border-dashed border-white/10 group-hover:border-blue-500/50 rounded-2xl p-8 text-center transition-all bg-white/5">
                  <Camera size={40} className="mx-auto mb-4 text-white/20 group-hover:text-blue-400" />
                  <p className="text-sm font-bold text-white/40 group-hover:text-white/60">
                    {verifyFiles.length > 0 ? `${verifyFiles.length} images selected` : "Upload 1-4 photos for verification"}
                  </p>
                </div>
              </div>
              <button 
                type="submit" 
                disabled={loading || verifyFiles.length === 0}
                className={`w-full py-5 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl ${loading ? 'bg-blue-600/50 animate-pulse' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20 active:scale-95'}`}
              >
                {loading ? 'Analyzing...' : 'Run Identification'}
              </button>
            </form>

            {results && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-10 p-8 rounded-3xl bg-white/5 border border-white/10 overflow-hidden relative">
                 <div className={`absolute top-0 right-0 w-32 h-32 blur-3xl rounded-full -mr-16 -mt-16 opacity-20 ${results.match ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                 <div className="flex justify-between items-end mb-6">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Match Identification</div>
                      <div className={`text-3xl font-black tracking-tighter ${results.match ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {results.matched_product}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Confidence</div>
                      <div className="text-2xl font-black font-mono">{(results.similarity * 100).toFixed(1)}%</div>
                    </div>
                 </div>
                 <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }} 
                      animate={{ width: `${results.similarity * 100}%` }} 
                      className={`h-full ${results.match ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`}
                    />
                 </div>
                 <div className="mt-6 flex items-center gap-2">
                    {results.match ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : (
                      <AlertCircle size={16} className="text-rose-400" />
                    )}
                    <span className={`text-[10px] font-black uppercase tracking-widest ${results.match ? 'text-emerald-400' : 'text-rose-400'}`}>
                       {results.match ? 'Verified Genuine' : 'Imposter Detected'}
                    </span>
                 </div>
              </motion.div>
            )}
          </div>

          <div className="glass-panel rounded-[2.5rem] p-10 border-t border-t-white/5">
            <h3 className="text-2xl font-black mb-6 flex items-center gap-3">
              <Terminal size={24} className="text-emerald-400" />
              Telegram Bot Activity
            </h3>
            <div className="bg-black/60 rounded-2xl p-6 font-mono text-[10px] sm:text-xs text-emerald-400 h-[300px] overflow-auto shadow-inner border border-white/5 flex flex-col-reverse relative group">
              <div className="absolute top-4 right-4 flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Live Feed</span>
              </div>
              <pre className="whitespace-pre-wrap leading-relaxed mt-auto">
                {botLogs.length > 0 ? botLogs.join('\n') : 'Awaiting telegram bot activity...'}
              </pre>
            </div>
          </div>
        </div>

        {/* Ingestion/Catalog Column */}
        <div className="space-y-8">
           <div className="glass-panel rounded-[2.5rem] p-10 border-t border-t-white/5">
            <h3 className="text-2xl font-black mb-6 flex items-center gap-3">
              <ImagePlus size={24} className="text-teal-400" />
              Add to Catalog
            </h3>
            <form onSubmit={handleAdd} className="space-y-6">
              <input 
                type="text" 
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Unique Product Name"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-teal-500/20 text-sm transition-all focus:bg-white/10"
              />
              <div className="relative group">
                <input 
                  type="file" 
                  multiple 
                  onChange={(e) => setAddFiles(e.target.files)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="border-2 border-dashed border-white/10 group-hover:border-teal-500/50 rounded-2xl p-8 text-center transition-all bg-white/5">
                  <ImagePlus size={40} className="mx-auto mb-4 text-white/20 group-hover:text-teal-400" />
                  <p className="text-sm font-bold text-white/40 group-hover:text-white/60">
                    {addFiles.length > 0 ? `${addFiles.length} images selected` : "Upload reference photos"}
                  </p>
                </div>
              </div>
              <button 
                type="submit" 
                disabled={loading || addFiles.length === 0 || !productName}
                className={`w-full py-5 rounded-2xl font-black uppercase tracking-widest transition-all shadow-xl ${loading ? 'bg-teal-600/50 animate-pulse' : 'bg-teal-600 hover:bg-teal-500 shadow-teal-600/20 active:scale-95'}`}
              >
                {loading ? 'Processing...' : 'Ingest to Index'}
              </button>
            </form>
          </div>

          <div className="glass-panel rounded-[2.5rem] p-10 border-t border-t-white/5">
            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-white/20 mb-4 border-b border-white/5 pb-4">Indexed Products</h3>
            <div className="relative mb-4">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search product... (e.g. 8706, GOLD)"
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white/10 transition-all placeholder:text-white/20"
              />
            </div>
            <div className="space-y-2 overflow-y-auto max-h-[400px] pr-2 custom-scrollbar">
              {(() => {
                const filtered = products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()));
                const grouped = filtered.reduce((acc, p) => {
                  const styleKey = p.name.split('-').slice(0, 2).join('-');
                  if (!acc[styleKey]) acc[styleKey] = [];
                  acc[styleKey].push(p);
                  return acc;
                }, {});
                const entries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

                if (products.length === 0)
                  return <p className="text-center text-white/10 py-10 italic text-sm tracking-wide">Index is currently empty.</p>;
                if (entries.length === 0)
                  return <p className="text-center text-white/20 py-10 italic text-sm tracking-wide">No products matching "{productSearch}"</p>;

                return entries.map(([styleKey, variants]) => {
                  const isOpen = expandedStyle === styleKey;
                  const totalVecs = variants.reduce((s, v) => s + v.embeddings, 0);
                  return (
                    <div key={styleKey} className="rounded-2xl border border-white/5 overflow-hidden">
                      {/* Style row — click to expand */}
                      <div
                        onClick={() => setExpandedStyle(isOpen ? null : styleKey)}
                        className="flex justify-between items-center p-4 bg-white/5 hover:bg-white/10 cursor-pointer transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          {isOpen
                            ? <ChevronDown size={14} className="text-blue-400 shrink-0" />
                            : <ChevronRightIcon size={14} className="text-white/30 group-hover:text-blue-400 shrink-0 transition-colors" />
                          }
                          <div className="flex items-center gap-2">
                            <Package size={13} className="text-white/20 group-hover:text-blue-400 transition-colors" />
                            <span className="font-black text-white/80 group-hover:text-white transition-colors">{styleKey}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-[10px] font-mono bg-black/40 px-2.5 py-1 rounded-lg text-blue-400">
                            {variants.length} {variants.length === 1 ? 'color' : 'colors'}
                          </div>
                          <div className="text-[10px] font-mono bg-black/40 px-2.5 py-1 rounded-lg text-white/30">
                            {totalVecs} vecs
                          </div>
                        </div>
                      </div>

                      {/* Expanded color variants */}
                      {isOpen && (
                        <div className="border-t border-white/5 bg-black/20 divide-y divide-white/5">
                          {variants.sort((a, b) => a.name.localeCompare(b.name)).map(v => {
                            const color = v.name.split('-').slice(2).join('-');
                            return (
                              <div key={v.name} className="flex justify-between items-center px-5 py-2.5 hover:bg-white/5 transition-all group/row">
                                <span className="text-sm text-white/60 group-hover/row:text-white transition-colors pl-5">{color}</span>
                                <div className="flex items-center gap-2">
                                  <div className="text-[10px] font-mono bg-black/40 px-2.5 py-1 rounded-lg text-white/20 group-hover/row:text-white/40 transition-colors">
                                    {v.embeddings} vecs
                                  </div>
                                  <button
                                    onClick={() => handleDeleteProduct(v.name)}
                                    disabled={loading}
                                    className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white transition-all active:scale-90"
                                    title={`Delete ${v.name}`}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Premium Glassmorphic Confirmation Modal */}
      <AnimatePresence>
        {productToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop Blur */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setProductToDelete(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            {/* Modal Body */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-900/90 p-8 shadow-2xl backdrop-blur-2xl"
            >
              <div className="absolute top-0 right-0 w-24 h-24 blur-3xl rounded-full -mr-12 -mt-12 bg-rose-500/20" />
              <h4 className="text-xl font-black mb-3 text-white flex items-center gap-2">
                <AlertCircle size={22} className="text-rose-400" />
                Delete Catalog Item?
              </h4>
              <p className="text-sm text-white/60 mb-6 font-medium">
                Are you sure you want to delete <span className="text-white font-bold">"{productToDelete}"</span>? This will permanently remove all of its reference vectors from the matcher AI index. This action is irreversible.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => setProductToDelete(null)}
                  disabled={loading}
                  className="flex-1 py-4 rounded-xl font-black uppercase tracking-widest text-xs border border-white/10 text-white/70 hover:text-white hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={loading}
                  className={`flex-1 py-4 rounded-xl font-black uppercase tracking-widest text-xs transition-all ${loading ? 'bg-rose-600/50 animate-pulse' : 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 active:scale-95'}`}
                >
                  {loading ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EcosystemDashboard({ 
  processes, 
  tunnel, 
  selectedProcess, 
  setSelectedProcess, 
  logType, 
  setLogType, 
  logs, 
  onAction, 
  onRefresh,
  onFetchLogs
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSubTab, setActiveSubTab] = useState('processes'); // 'processes', 'logs', 'explorer'
  const [explorerType, setExplorerType] = useState('processed'); // 'processed', 'raw'
  const [explorerData, setExplorerData] = useState([]);
  const [selectedExpItem, setSelectedExpItem] = useState(null);

  // Fetch direct database data for explorer
  useEffect(() => {
    if (activeSubTab === 'explorer') {
      fetchExplorerData();
    }
  }, [activeSubTab, explorerType]);

  const fetchExplorerData = async () => {
    try {
      const endpoint = explorerType === 'processed' ? 'admin/transactions' : 'admin/raw';
      const res = await axios.get(`http://localhost:8000/api/v1/${endpoint}`);
      setExplorerData(res.data || []);
    } catch (err) {
      console.error("Failed to fetch explorer data:", err);
    }
  };

  const formatUptime = (ms) => {
    if (!ms) return '0s';
    const seconds = Math.floor((Date.now() - ms) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  const formatMemory = (bytes) => {
    if (!bytes) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Filter processes
  const filteredProcesses = processes.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-10 animate-in fade-in duration-500 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-black italic uppercase tracking-tighter text-blue-400 flex items-center gap-3">
            <Activity className="animate-pulse text-blue-500" />
            Ecosystem Control
          </h2>
          <p className="text-white/30 font-medium">Full PM2 Supervision, Reverse Proxy & Activity Terminal</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={onRefresh}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-6 py-3.5 rounded-2xl font-bold transition-all border border-white/5"
          >
            <RefreshCw size={18} />
            Refresh State
          </button>
        </div>
      </header>

      {/* Sub navigation for Ecosystem dashboard */}
      <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 max-w-md">
        {[
          { id: 'processes', label: 'PM2 Processes' },
          { id: 'logs', label: 'Live Logs' },
          { id: 'explorer', label: 'Data Explorer' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeSubTab === tab.id ? 'bg-blue-600 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'processes' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Main PM2 Grid */}
          <div className="xl:col-span-2 glass-panel rounded-[2.5rem] p-10 border-t border-t-white/5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-4">
              <div>
                <h3 className="text-2xl font-black">PM2 Supervisor</h3>
                <p className="text-white/30 text-sm">Active system processes and cluster stats</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-4 top-3.5 text-white/30" size={18} />
                <input 
                  type="text"
                  placeholder="Filter processes..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-blue-500/50"
                />
              </div>
            </div>

            <div className="space-y-4 overflow-y-auto max-h-[600px] pr-2 custom-scrollbar">
              {filteredProcesses.map(p => (
                <div key={p.id} className="glass-card p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 border-l-4 border-l-blue-500/30 hover:border-l-blue-500 transition-all">
                  <div className="flex items-center gap-4">
                    <div className={`w-3.5 h-3.5 rounded-full ${p.status === 'online' ? 'bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500 animate-pulse'}`} />
                    <div>
                      <div className="font-black text-lg text-white/95">{p.name}</div>
                      <div className="text-xs text-white/30 font-semibold uppercase tracking-wider mt-0.5">PM2 ID: {p.id} • RESTARTS: {p.restarts}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-center md:text-left">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-white/30 leading-none mb-1">Uptime</div>
                      <div className="font-mono text-sm font-bold text-blue-400">{formatUptime(p.uptime)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-white/30 leading-none mb-1">CPU</div>
                      <div className="font-mono text-sm font-bold text-teal-400">{p.cpu}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-white/30 leading-none mb-1">Memory</div>
                      <div className="font-mono text-sm font-bold text-purple-400">{formatMemory(p.memory)}</div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button 
                      onClick={() => onAction(p.name, 'restart')}
                      className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                    >
                      Restart
                    </button>
                    {p.status === 'online' ? (
                      <button 
                        onClick={() => onAction(p.name, 'stop')}
                        className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                      >
                        Stop
                      </button>
                    ) : (
                      <button 
                        onClick={() => onAction(p.name, 'start')}
                        className="px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                      >
                        Start
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reverse Proxy bindings & Tunnel status info */}
          <div className="space-y-8">
            <div className="glass-panel rounded-[2.5rem] p-10 border-t border-t-white/5">
              <h3 className="text-2xl font-black mb-6">Ngrok Tunnel</h3>
              <div className="space-y-6">
                <div className="p-5 rounded-2xl bg-white/5 border border-white/5 relative overflow-hidden group">
                  <div className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2">Public Endpoint</div>
                  <a 
                    href={tunnel.public_url} 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-md font-bold text-blue-400 hover:underline break-all block"
                  >
                    {tunnel.public_url}
                  </a>
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-white/20 mb-4 ml-1">Reverse Proxy Routing</div>
                  {tunnel.mappings?.map(m => (
                    <div key={m.path} className="flex justify-between items-center p-4 bg-white/5 rounded-2xl border border-transparent hover:border-white/5 transition-all">
                      <div className="font-mono text-sm text-teal-400 font-bold">{m.path}</div>
                      <div className="text-xs text-white/55 text-right font-semibold">{m.destination}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Project Integration Clusters Card */}
            <div className="glass-panel rounded-[2.5rem] p-10 border-t border-t-white/5">
              <h3 className="text-2xl font-black mb-6">Project Topology</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/10">
                  <div>
                    <div className="font-bold text-emerald-400 text-sm">Passify Gatepass App</div>
                    <div className="text-[10px] text-white/30 uppercase font-black mt-0.5">Category: passify</div>
                  </div>
                  <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-lg text-[10px] font-black uppercase tracking-widest">Active</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-blue-500/10 rounded-2xl border border-blue-500/10">
                  <div>
                    <div className="font-bold text-blue-400 text-sm">Sales SRS App</div>
                    <div className="text-[10px] text-white/30 uppercase font-black mt-0.5">Category: sales</div>
                  </div>
                  <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg text-[10px] font-black uppercase tracking-widest">Active</span>
                </div>
                <div className="flex items-center justify-between p-4 bg-purple-500/10 rounded-2xl border border-purple-500/10">
                  <div>
                    <div className="font-bold text-purple-400 text-sm">Central Data Hub</div>
                    <div className="text-[10px] text-white/30 uppercase font-black mt-0.5">Unified Analytics Engine</div>
                  </div>
                  <span className="px-3 py-1 bg-purple-500/20 text-purple-400 rounded-lg text-[10px] font-black uppercase tracking-widest">Online</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'logs' && (
        <div className="glass-panel rounded-[2.5rem] p-10 border-t border-t-white/5">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
            <div>
              <h3 className="text-2xl font-black">Activity Terminal</h3>
              <p className="text-white/30 text-sm">Real-time standard output and diagnostic feeds</p>
            </div>
            
            <div className="flex flex-wrap gap-4 w-full md:w-auto">
              <select 
                value={selectedProcess}
                onChange={(e) => setSelectedProcess(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50"
              >
                {processes.map(p => (
                  <option key={p.id} value={p.name} className="bg-slate-900 text-white">{p.name}</option>
                ))}
              </select>
              
              <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
                <button
                  onClick={() => setLogType('out')}
                  className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${logType === 'out' ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/60'}`}
                >
                  Stdout
                </button>
                <button
                  onClick={() => setLogType('err')}
                  className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${logType === 'err' ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/60'}`}
                >
                  Stderr
                </button>
              </div>

              <button 
                onClick={onFetchLogs}
                className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
              >
                Fetch Logs
              </button>
            </div>
          </div>

          <div className="glass-panel bg-black/60 rounded-[2rem] p-8 font-mono text-xs max-h-[500px] overflow-auto shadow-inner border border-white/10 relative group min-h-[300px]">
            <div className="absolute top-4 right-4 flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Terminal Live Feed</span>
            </div>
            <pre className="text-emerald-400/90 leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {logs.length > 0 ? logs.join('\n') : "Awaiting logs... Select a microservice or click 'Fetch Logs' to fetch console outputs."}
            </pre>
          </div>
        </div>
      )}

      {activeSubTab === 'explorer' && (
        <div className="glass-panel rounded-[2.5rem] p-10 border-t border-t-white/5">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
            <div>
              <h3 className="text-2xl font-black">Data Explorer</h3>
              <p className="text-white/30 text-sm">Direct sqlite database indexing and raw records viewer</p>
            </div>

            <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setExplorerType('processed')}
                className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${explorerType === 'processed' ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/60'}`}
              >
                Processed
              </button>
              <button
                onClick={() => setExplorerType('raw')}
                className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${explorerType === 'raw' ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/60'}`}
              >
                Raw Data
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            {/* Table layout */}
            <div className="xl:col-span-2 overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[10px] font-black uppercase tracking-widest text-white/30 text-left">
                    <th className="py-4 px-4">ID</th>
                    <th className="py-4 px-4">{explorerType === 'processed' ? 'Category' : 'Source'}</th>
                    <th className="py-4 px-4">{explorerType === 'processed' ? 'Entity ID' : 'Endpoint'}</th>
                    <th className="py-4 px-4">Timestamp</th>
                    <th className="py-4 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {explorerData.map(item => (
                    <tr 
                      key={item.id}
                      onClick={() => setSelectedExpItem(item)}
                      className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer transition-colors"
                    >
                      <td className="py-4 px-4 font-mono font-bold text-sm">#{item.id}</td>
                      <td className="py-4 px-4">
                        <span className="px-3 py-1 bg-blue-500/10 rounded-lg text-[10px] uppercase font-black tracking-widest text-blue-400 border border-blue-400/20">
                          {explorerType === 'processed' ? item.category : item.source}
                        </span>
                      </td>
                      <td className="py-4 px-4 font-bold text-white/80">{explorerType === 'processed' ? item.entity_id : item.endpoint}</td>
                      <td className="py-4 px-4 font-mono text-xs text-white/30">{new Date(item.updated_at || item.received_at).toLocaleTimeString()}</td>
                      <td className="py-4 px-4 text-right">
                        <ChevronRight className="inline-block text-white/20" size={18} />
                      </td>
                    </tr>
                  ))}
                  {explorerData.length === 0 && (
                    <tr>
                      <td colSpan="5" className="text-center py-20 italic text-white/20 text-sm">Database is empty or awaiting synchronization.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Item detail viewer */}
            <div>
              <div className="glass-panel bg-black/30 rounded-3xl p-8 border border-white/5 min-h-[400px]">
                <h4 className="text-md font-black uppercase tracking-wider mb-6 text-white/80 flex items-center gap-2">
                  <FileJson size={18} className="text-blue-400" />
                  JSON Document
                </h4>
                {selectedExpItem ? (
                  <pre className="font-mono text-[10px] leading-relaxed text-blue-300 overflow-x-auto whitespace-pre-wrap max-h-[450px]">
                    {JSON.stringify(selectedExpItem.content || selectedExpItem.data, null, 2)}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-20 opacity-30">
                    <FileJson size={32} className="mb-4" />
                    <p className="text-xs">Select a database row to inspect raw payload values.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  const borderColors = {
    blue: 'neon-border-blue',
    teal: 'neon-border-teal',
    purple: 'neon-border-purple',
    emerald: 'neon-border-emerald'
  };

  return (
    <div className={`glass-panel p-6 rounded-3xl transition-all duration-500 hover:bg-white/[0.06] flex flex-col items-start gap-4 ${borderColors[color]}`}>
      <div className="p-3 rounded-2xl bg-white/5 shadow-inner">
        {icon}
      </div>
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 mb-1">{label}</div>
        <div className="text-3xl font-black">{value}</div>
      </div>
    </div>
  );
}

function CatalogDashboard({ apiBase }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', description: '', price: '', image_url: '', crm_tags: [] });
  const [tagInputs, setTagInputs] = useState({});
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    if (selectedProduct) {
      setEditingProduct({ ...selectedProduct });
    } else {
      setEditingProduct(null);
    }
  }, [selectedProduct]);

  const handleUpdateProduct = async () => {
    if (!editingProduct) return;
    setIsSaving(true);
    try {
      await axios.put(`${apiBase}/catalog/${editingProduct.id}`, {
        ...editingProduct,
        price: parseFloat(editingProduct.price) || 0,
        cost_price: parseFloat(editingProduct.cost_price) || 0,
        mrp: parseFloat(editingProduct.mrp) || 0,
        gst_rate: parseFloat(editingProduct.gst_rate) || 5.0
      });
      fetchProducts();
      // Update selected product state as well
      setSelectedProduct(editingProduct);
      alert("Product details saved successfully!");
    } catch (err) {
      alert("Failed to save product details: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${apiBase}/catalog`);
      setProducts(res.data);
    } catch (err) {
      console.error("Failed to fetch catalog:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${apiBase}/catalog`, {
        ...newProduct,
        price: parseFloat(newProduct.price) || 0.0
      });
      setShowAddModal(false);
      setNewProduct({ name: '', description: '', price: '', image_url: '', crm_tags: [] });
      fetchProducts();
    } catch (err) {
      alert("Failed to create product");
    }
  };

  const handleDeleteProduct = async (id) => {
    if (!confirm("Are you sure you want to delete this product?")) return;
    try {
      await axios.delete(`${apiBase}/catalog/${id}`);
      fetchProducts();
      if (selectedProduct && selectedProduct.id === id) {
        setSelectedProduct(null);
      }
    } catch (err) {
      alert("Failed to delete product");
    }
  };

  const handleAddTag = async (productId, tags, newTag) => {
    if (!newTag.trim()) return;
    const updatedTags = [...tags, newTag.trim()];
    try {
      await axios.put(`${apiBase}/catalog/${productId}`, { crm_tags: updatedTags });
      setTagInputs({ ...tagInputs, [productId]: '' });
      fetchProducts();
    } catch (err) {
      alert("Failed to add tag");
    }
  };

  const handleRemoveTag = async (productId, tags, tagToRemove) => {
    const updatedTags = tags.filter(t => t !== tagToRemove);
    try {
      await axios.put(`${apiBase}/catalog/${productId}`, { crm_tags: updatedTags });
      fetchProducts();
    } catch (err) {
      alert("Failed to remove tag");
    }
  };

  const filteredProducts = products.filter(p => 
    p.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.crm_tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-4xl font-black italic uppercase tracking-tighter text-blue-400 flex items-center gap-4">
            <Package size={36} />
            Product Catalog
          </h2>
          <p className="text-white/30 font-medium">Hierarchical Inventory & AI Imaging</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
            <input 
              type="text" 
              placeholder="Search products..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-white w-64 transition-all"
            />
          </div>
          <button 
            onClick={() => setShowAddModal(true)}
            className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-2xl font-black transition-all shadow-lg active:scale-95 flex items-center gap-2"
          >
            <Plus size={20} /> Add Product
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-white/50">Loading catalog...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProducts.map(p => (
            <div key={p.id} className="glass-panel p-5 rounded-3xl flex flex-col justify-between cursor-pointer hover:bg-white/10 transition-colors relative group border border-white/5 hover:border-blue-500/30" onClick={() => setSelectedProduct(p)}>
              <button 
                onClick={(e) => { e.stopPropagation(); handleDeleteProduct(p.id); }} 
                className="absolute top-4 right-4 text-rose-500/0 group-hover:text-rose-500/50 hover:!text-rose-500 transition-colors p-2 bg-white/5 rounded-xl opacity-0 group-hover:opacity-100 z-10"
                title="Delete Product"
              >
                <Trash2 size={18} />
              </button>
              
              <div className="mb-4 pr-10">
                <h3 className="text-xl font-black text-white/90 truncate" title={p.name}>{p.name}</h3>
                <div className="text-blue-400 text-xs font-bold mt-1 tracking-widest uppercase">{p.variants?.length || 0} Colors</div>
              </div>
              
              <div className="flex flex-wrap gap-1 mt-auto">
                {p.crm_tags && p.crm_tags.slice(0, 3).map(tag => (
                  <span key={tag} className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded-md text-[10px] font-bold border border-purple-500/30 truncate max-w-full">
                    {tag}
                  </span>
                ))}
                {p.crm_tags && p.crm_tags.length > 3 && (
                  <span className="px-2 py-0.5 bg-white/5 text-white/40 rounded-md text-[10px] font-bold">
                    +{p.crm_tags.length - 3}
                  </span>
                )}
                {(!p.crm_tags || p.crm_tags.length === 0) && <span className="text-white/20 text-[10px] italic">No tags</span>}
              </div>
            </div>
          ))}
          {filteredProducts.length === 0 && products.length > 0 && (
            <div className="col-span-full text-center py-20 text-white/50">
              No products found matching "{searchQuery}".
            </div>
          )}
          {products.length === 0 && (
            <div className="col-span-full text-center py-20 bg-white/5 rounded-3xl border border-dashed border-white/10">
              <Package size={48} className="mx-auto text-white/20 mb-4" />
              <p className="text-white/30 font-bold mb-4">No products in the catalog yet.</p>
              <p className="text-sm text-white/20">Run the <code className="bg-black/50 px-2 py-1 rounded">import_catalog_from_drive.py</code> script to populate.</p>
            </div>
          )}
        </div>
      )}

      {/* Selected Product Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-300">
          <div className="bg-[#0f172a] border border-white/10 rounded-[2.5rem] w-full max-w-5xl max-h-[90vh] flex flex-col relative overflow-hidden shadow-2xl shadow-blue-900/20 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center p-6 border-b border-white/10 shrink-0 bg-white/5">
              <div>
                <h2 className="text-3xl font-black text-white">{selectedProduct.name}</h2>
                {selectedProduct.description && <p className="text-white/50">{selectedProduct.description}</p>}
              </div>
              <button onClick={() => setSelectedProduct(null)} className="text-white/50 hover:text-white p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors">
                <XCircle size={28} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              
              {/* Product Basic Info Form */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-black/20 p-5 rounded-2xl border border-white/5">
                <div className="col-span-1 md:col-span-2">
                  <h4 className="text-sm font-black uppercase tracking-widest text-white/40 mb-4 flex items-center gap-2">
                    <Package size={16} className="text-purple-400" /> Basic Details
                  </h4>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Product Code / Name</label>
                  <input type="text" value={editingProduct?.name || ''} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Category</label>
                  <input type="text" value={editingProduct?.category || ''} onChange={e => setEditingProduct({...editingProduct, category: e.target.value})} placeholder="e.g. Kurti, Top" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Fabric</label>
                  <input type="text" value={editingProduct?.fabric || ''} onChange={e => setEditingProduct({...editingProduct, fabric: e.target.value})} placeholder="e.g. Cotton, Rayon" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Status</label>
                  <select value={editingProduct?.status || 'Active'} onChange={e => setEditingProduct({...editingProduct, status: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 text-white">
                    <option value="Active">Active</option>
                    <option value="Discontinued">Discontinued</option>
                  </select>
                </div>
                <div className="col-span-1 md:col-span-2">
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Description</label>
                  <textarea value={editingProduct?.description || ''} onChange={e => setEditingProduct({...editingProduct, description: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 h-20 resize-none" />
                </div>
              </div>

              {/* Pricing & Tax */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 bg-black/20 p-5 rounded-2xl border border-white/5">
                <div className="col-span-2 md:col-span-4">
                  <h4 className="text-sm font-black uppercase tracking-widest text-white/40 mb-4 flex items-center gap-2">
                    <span className="text-emerald-400 font-bold">$</span> Pricing & Tax
                  </h4>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Cost Price</label>
                  <input type="number" value={editingProduct?.cost_price || ''} onChange={e => setEditingProduct({...editingProduct, cost_price: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Selling Price</label>
                  <input type="number" value={editingProduct?.price || ''} onChange={e => setEditingProduct({...editingProduct, price: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">MRP</label>
                  <input type="number" value={editingProduct?.mrp || ''} onChange={e => setEditingProduct({...editingProduct, mrp: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">GST Rate (%)</label>
                  <input type="number" value={editingProduct?.gst_rate || '5'} onChange={e => setEditingProduct({...editingProduct, gst_rate: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">HSN Code</label>
                  <input type="text" value={editingProduct?.hsn_code || ''} onChange={e => setEditingProduct({...editingProduct, hsn_code: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div className="col-span-2 md:col-span-3">
                  <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Sizes (Comma separated)</label>
                  <input type="text" value={editingProduct?.sizes?.join(', ') || ''} onChange={e => {
                    const s = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
                    setEditingProduct({...editingProduct, sizes: s});
                  }} placeholder="S, M, L, XL" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500" />
                </div>
              </div>

              {/* Tags Section inside Modal */}
              <div className="space-y-3 bg-black/20 p-5 rounded-2xl border border-white/5">
                <label className="text-xs font-black uppercase tracking-widest text-white/40">CRM Match Tags</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {editingProduct?.crm_tags && editingProduct.crm_tags.map(tag => (
                    <span key={tag} className="px-3 py-1 bg-purple-500/20 text-purple-300 rounded-lg text-xs font-bold border border-purple-500/30 flex items-center gap-2">
                      {tag}
                      <button onClick={async () => {
                        const updatedTags = editingProduct.crm_tags.filter(t => t !== tag);
                        setEditingProduct({ ...editingProduct, crm_tags: updatedTags });
                        await handleRemoveTag(editingProduct.id, editingProduct.crm_tags, tag);
                      }} className="hover:text-white transition-colors">
                        <XCircle size={14} />
                      </button>
                    </span>
                  ))}
                  {(!editingProduct?.crm_tags || editingProduct.crm_tags.length === 0) && <span className="text-white/20 text-xs italic">No tags assigned</span>}
                </div>
                <input 
                  type="text"
                  value={tagInputs[selectedProduct.id] || ''}
                  onChange={(e) => setTagInputs({ ...tagInputs, [selectedProduct.id]: e.target.value })}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      const newTag = tagInputs[selectedProduct.id]?.trim();
                      if (newTag && !editingProduct.crm_tags?.includes(newTag)) {
                        const updatedTags = [...(editingProduct.crm_tags || []), newTag];
                        setEditingProduct({ ...editingProduct, crm_tags: updatedTags });
                        await handleAddTag(editingProduct.id, editingProduct.crm_tags || [], newTag);
                      }
                    }
                  }}
                  placeholder="Type tag & press Enter..."
                  className="w-full max-w-md bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500/50 text-purple-100"
                />
              </div>

              {/* Variants inside Modal */}
              <div className="bg-black/20 p-5 rounded-2xl border border-white/5">
                <h4 className="text-sm font-black uppercase tracking-widest text-white/40 mb-4 flex items-center gap-2">
                  <Image size={16} className="text-blue-400" />
                  Color Variants (AI Images)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {editingProduct?.variants && editingProduct.variants.length > 0 ? editingProduct.variants.map((variant, idx) => (
                    <div key={idx} className="bg-white/5 rounded-2xl p-4 border border-white/5 flex flex-col gap-4">
                      <div className="flex items-center gap-3 border-b border-white/10 pb-3">
                        <div className="w-4 h-4 rounded-full bg-gradient-to-br from-white/20 to-white/5 border border-white/20"></div>
                        <span className="font-black uppercase tracking-widest text-blue-300">{variant.color}</span>
                        <span className="ml-auto text-xs font-bold text-white/30">{variant.images?.length || 0} images</span>
                      </div>
                      <div className="flex gap-4 overflow-x-auto pb-2 snap-x">
                        {variant.images && variant.images.map(imgId => (
                          <div key={imgId} className="w-32 h-40 shrink-0 snap-start rounded-xl overflow-hidden bg-black/60 relative group border border-white/10">
                            <img 
                              src={`${apiBase}/catalog/image/${imgId}?w=300`} 
                              alt={variant.color}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                              loading="lazy"
                            />
                          </div>
                        ))}
                        {(!variant.images || variant.images.length === 0) && (
                          <div className="w-full h-32 rounded-xl bg-black/40 border border-dashed border-white/10 flex items-center justify-center text-white/20 text-xs text-center p-2 italic">
                            No AI Images
                          </div>
                        )}
                      </div>
                    </div>
                  )) : (
                    <div className="text-white/20 italic text-sm col-span-full bg-white/5 p-6 rounded-2xl text-center border border-dashed border-white/10">No color variants available for this product.</div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Sticky Footer */}
            <div className="p-4 md:p-6 border-t border-white/10 bg-black/40 flex justify-end gap-4 shrink-0">
              <button 
                onClick={() => setSelectedProduct(null)} 
                className="px-6 py-3 rounded-xl font-bold text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleUpdateProduct}
                disabled={isSaving}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-8 py-3 rounded-xl font-black transition-all shadow-lg active:scale-95 flex items-center gap-2"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-white/10 rounded-[2.5rem] p-8 max-w-md w-full relative">
            <button onClick={() => setShowAddModal(false)} className="absolute top-6 right-6 text-white/50 hover:text-white">
              <XCircle size={24} />
            </button>
            <h2 className="text-2xl font-black mb-6">New Product</h2>
            <form onSubmit={handleCreateProduct} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Product Code</label>
                <input required type="text" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-white/40 mb-1 block">Description</label>
                <textarea value={newProduct.description} onChange={e => setNewProduct({...newProduct, description: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 resize-none h-24" />
              </div>
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-xl font-black mt-4 transition-all">Create Product</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
