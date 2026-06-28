import { useState, useEffect, useRef, useCallback } from 'react';
import { Power, Activity, DollarSign, RotateCcw, Brain, Download } from 'lucide-react';

const API_URL = '/api';
const FETCH_TIMEOUT_MS = 4000;
const ACTION_TIMEOUT_MS = 20000;
const RESET_TIMEOUT_MS = 120000;

async function apiFetch(path, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_URL}${path}`, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatLadder(tiers) {
  if (!Array.isArray(tiers)) return '';
  return tiers
    .map((tier, i) => `T${i + 1}: ${tier.map((n) => `$${n}`).join(' → ')}`)
    .join(' | ');
}

/** Match dropdown to the active IQ balance (required when multiple tournaments exist). */
function resolveActiveAccountId(status, accounts) {
  if (!accounts?.length) return '';
  if (status?.balance_id != null && status.balance_id !== '') {
    const byBalance = accounts.find((a) => String(a.id) === String(status.balance_id));
    if (byBalance) return String(byBalance.id);
  }
  if (status?.account_key?.startsWith('TOURNAMENT_')) {
    const tid = status.account_key.replace('TOURNAMENT_', '');
    const byKey = accounts.find((a) => String(a.id) === tid);
    if (byKey) return String(byKey.id);
  }
  const byType = accounts.find((a) => a.type === status?.account_type);
  return byType ? String(byType.id) : '';
}

function App() {
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [isToggling, setIsToggling] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [actionError, setActionError] = useState('');
  const [showRealConfirm, setShowRealConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [clearLogOnReset, setClearLogOnReset] = useState(true);
  const [trades, setTrades] = useState([]);
  const [assetList, setAssetList] = useState([]);
  const [saveMessage, setSaveMessage] = useState('');
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [aiKeyVisible, setAiKeyVisible] = useState(false);
  const [aiSaveMsg, setAiSaveMsg] = useState('');
  const [patternAnalysis, setPatternAnalysis] = useState(null);
  const [patternLoading, setPatternLoading] = useState(false);
  const [backtest, setBacktest] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [learnLoading, setLearnLoading] = useState(false);
  const [editTiers, setEditTiers] = useState(null);
  const [tierSaveMsg, setTierSaveMsg] = useState('');
  const [aiComparison, setAiComparison] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [optLogs, setOptLogs] = useState(null);
  const [optLoading, setOptLoading] = useState(false);
  const [evalLogs, setEvalLogs] = useState(null);
  const [todAnalytics, setTodAnalytics] = useState(null);
  const [todLoading, setTodLoading] = useState(false);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [heatmap, setHeatmap] = useState(null);
  const [gateLog, setGateLog] = useState([]);
  const [assetBreakdown, setAssetBreakdown] = useState(null);
  const [expandedTradeIndex, setExpandedTradeIndex] = useState(null);
  const [sequentialAmountsInput, setSequentialAmountsInput] = useState('');
  const [dailyPnl, setDailyPnl] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [newWinStart, setNewWinStart] = useState('08:00');
  const [newWinEnd, setNewWinEnd] = useState('12:00');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const prevRunningRef = useRef(null);

  const [adminTokens, setAdminTokens] = useState(null);
  const [adminStats, setAdminStats] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [adminSuccess, setAdminSuccess] = useState('');
  const [newTokenDays, setNewTokenDays] = useState(30);
  const [newTokenKey, setNewTokenKey] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [copiedToken, setCopiedToken] = useState('');

  const [setupStatus, setSetupStatus] = useState(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [wizardData, setWizardData] = useState({ iq_email: '', iq_password: '', iq_account_type: 'PRACTICE' });
  const [wizardLoading, setWizardLoading] = useState(false);
  const [wizardError, setWizardError] = useState('');
  const [wizardDone, setWizardDone] = useState(false);

  const loadAssetList = async () => {
    try {
      const res = await apiFetch('/assets');
      if (!res.ok) return;
      const data = await res.json();
      const list = data.open_assets || [];
      if (list.length) setAssetList(list);
    } catch (_) { /* ignore */ }
  };

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await apiFetch('/status');
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        if (err.name !== 'AbortError') console.error('status:', err);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await apiFetch('/setup-status', {}, 5000);
        if (!res.ok) return;
        const data = await res.json();
        setSetupStatus(data);
        if (data.needs_setup) setShowSetupWizard(true);
      } catch (_) {}
    };
    checkSetup();
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const [configRes, accountsRes, tradesRes] = await Promise.all([
          apiFetch('/config'),
          apiFetch('/accounts'),
          apiFetch('/trades?limit=15'),
        ]);
        const cfg = await configRes.json();
        setConfig(cfg);
        setAccounts((await accountsRes.json()).accounts || []);
        setTrades((await tradesRes.json()).trades || []);
        const assetsRes = await apiFetch('/assets');
        if (assetsRes.ok) {
          const data = await assetsRes.json();
          setAssetList(data.open_assets || []);
        }
      } catch (err) {
        console.error('init load:', err);
      }
    };
    load();
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch('/trades?limit=15');
        if (res.ok) setTrades((await res.json()).trades || []);
      } catch (_) { /* ignore */ }
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = status.running;
    if (wasRunning && !status.running) {
      apiFetch('/accounts').then((r) => r.json()).then((d) => setAccounts(d.accounts || []));
    }
    loadAssetList();
  }, [status?.connected, status?.running]);

  useEffect(() => {
    if (!status?.connected) return;
    const refreshAccounts = async () => {
      try {
        const res = await apiFetch('/accounts');
        if (res.ok) setAccounts((await res.json()).accounts || []);
      } catch (_) {}
    };
    const interval = setInterval(refreshAccounts, 30000);
    return () => clearInterval(interval);
  }, [status?.connected]);

  const refreshStatus = async () => {
    try {
      const res = await apiFetch('/status');
      if (res.ok) setStatus(await res.json());
    } catch (_) { /* ignore */ }
  };

  const refreshBalance = async () => {
    if (!status?.connected) {
      setActionError('Connect to IQ Option first');
      return;
    }
    setIsRefreshingBalance(true);
    setActionError('');
    try {
      const res = await apiFetch('/balance/refresh', { method: 'POST' }, ACTION_TIMEOUT_MS);
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.detail || 'Balance refresh failed');
        return;
      }
      setAccounts(data.accounts || []);
      setStatus((prev) =>
        prev ? { ...prev, balance: data.balance, balance_id: data.active_balance_id } : prev
      );
      await refreshStatus();
    } catch (err) {
      setActionError(
        err.name === 'AbortError' ? 'Balance refresh timed out' : 'Balance refresh failed'
      );
    } finally {
      setIsRefreshingBalance(false);
    }
  };

  const loadAdminData = async () => {
    setAdminLoading(true);
    setAdminError('');
    try {
      const [tokRes, stRes] = await Promise.all([
        apiFetch('/admin/tokens', {}, 8000),
        apiFetch('/admin/stats', {}, 8000),
      ]);
      if (tokRes.ok) setAdminTokens((await tokRes.json()).tokens || []);
      else setAdminError((await tokRes.json()).detail || 'Failed to load tokens');
      if (stRes.ok) setAdminStats(await stRes.json());
    } catch (err) {
      setAdminError('Could not reach admin API');
    } finally {
      setAdminLoading(false);
    }
  };

  const createToken = async () => {
    setAdminError(''); setAdminSuccess('');
    try {
      const res = await apiFetch('/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_days: Number(newTokenDays), token_key: newTokenKey.trim() }),
      }, 8000);
      const data = await res.json();
      if (!res.ok) { setAdminError(data.detail || 'Failed to create token'); return; }
      setAdminSuccess(`Created: ${data.token_key}`);
      setNewTokenKey('');
      await loadAdminData();
    } catch (err) {
      setAdminError('Failed to create token');
    }
  };

  const revokeToken = async (key) => {
    setAdminError(''); setAdminSuccess('');
    try {
      const res = await apiFetch(`/admin/tokens/${encodeURIComponent(key)}/revoke`, { method: 'POST' }, 8000);
      const data = await res.json();
      if (!res.ok) { setAdminError(data.detail || 'Revoke failed'); return; }
      setAdminSuccess(`Revoked: ${key}`);
      await loadAdminData();
    } catch (err) {
      setAdminError('Revoke failed');
    }
  };

  const unrevokeToken = async (key) => {
    setAdminError(''); setAdminSuccess('');
    try {
      const res = await apiFetch(`/admin/tokens/${encodeURIComponent(key)}/unrevoke`, { method: 'POST' }, 8000);
      const data = await res.json();
      if (!res.ok) { setAdminError(data.detail || 'Unrevoke failed'); return; }
      setAdminSuccess(`Restored: ${key}`);
      await loadAdminData();
    } catch (err) {
      setAdminError('Unrevoke failed');
    }
  };

  const deleteToken = async (key) => {
    if (!window.confirm(`Delete token ${key}? This cannot be undone.`)) return;
    setAdminError(''); setAdminSuccess('');
    try {
      const res = await apiFetch(`/admin/tokens/${encodeURIComponent(key)}`, { method: 'DELETE' }, 8000);
      const data = await res.json();
      if (!res.ok) { setAdminError(data.detail || 'Delete failed'); return; }
      setAdminSuccess(`Deleted: ${key}`);
      await loadAdminData();
    } catch (err) {
      setAdminError('Delete failed');
    }
  };

  const copyToken = (key) => {
    navigator.clipboard.writeText(key).then(() => {
      setCopiedToken(key);
      setTimeout(() => setCopiedToken(''), 2000);
    }).catch(() => {});
  };

  const forcePairLearningRefresh = async () => {
    setLearnLoading(true);
    try {
      await apiFetch('/learn-pattern', { method: 'POST' }, 15000);
      await refreshStatus();
    } catch (err) {
      console.error('pair learning refresh:', err);
    } finally {
      setLearnLoading(false);
    }
  };

  const runPatternAnalysis = async () => {
    setPatternLoading(true);
    setPatternAnalysis(null);
    try {
      const res = await apiFetch('/pattern-analysis?limit=40&days=14', {}, 45000);
      if (res.ok) setPatternAnalysis(await res.json());
      else setPatternAnalysis({ error: (await res.json()).detail || 'Analysis failed' });
    } catch (err) {
      setPatternAnalysis({ error: err.message || 'Analysis failed' });
    } finally {
      setPatternLoading(false);
    }
  };

  const fetchAiComparison = useCallback(async () => {
    try {
      setAiLoading(true);
      const res = await fetch('/api/ai-comparison');
      const data = await res.json();
      setAiComparison(data);
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  }, []);

  const fetchTodAnalytics = useCallback(async () => {
    try {
      setTodLoading(true);
      const res = await fetch('/api/trade-history-analytics');
      const data = await res.json();
      if (!data || !data.trades) {
        setTodAnalytics(null);
        return;
      }
      const trades = data.trades;
      // Group by local hour
      const hourlyStats = Array.from({ length: 24 }, (_, i) => ({ hour: i, trades: 0, wins: 0, losses: 0, pnl: 0 }));
      
      trades.forEach(t => {
        if (!t.entry_ts) return;
        const d = new Date(Number(t.entry_ts) * 1000);
        const hr = d.getHours(); // Local timezone hour
        if (isNaN(hr)) return;

        const profit = Number(t.round_profit || 0);
        const isWin = profit > 0;
        
        hourlyStats[hr].trades += 1;
        hourlyStats[hr].pnl += profit;
        if (isWin) hourlyStats[hr].wins += 1;
        else hourlyStats[hr].losses += 1;
      });

      // Calculate win rates and sort
      hourlyStats.forEach(st => {
        st.winRate = st.trades > 0 ? (st.wins / st.trades) * 100 : 0;
      });
      
      setTodAnalytics({
        totalAnalyzed: trades.length,
        hours: hourlyStats
      });
    } catch (err) {
      console.error("Failed to load TOD analytics", err);
    } finally {
      setTodLoading(false);
    }
  }, []);

  const loadOptLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-optimization-logs');
      const data = await res.json();
      setOptLogs(data);
    } catch (err) {
      console.error("Failed to load AI Opt logs", err);
    }
  }, []);

  const loadEvalLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-evaluator-logs');
      const data = await res.json();
      setEvalLogs(data);
    } catch (err) {
      console.error("Failed to load AI Eval logs", err);
    }
  }, []);

  const triggerOptimization = async () => {
    try {
      setOptLoading(true);
      await fetch('/api/trigger-optimization', { method: 'POST' });
      // Poll a few times to see if log updates
      setTimeout(() => { loadOptLogs(); loadEvalLogs(); }, 5000);
      setTimeout(() => { loadOptLogs(); loadEvalLogs(); }, 10000);
    } catch (e) {
      console.error(e);
    } finally {
      setOptLoading(false);
    }
  };

  useEffect(() => {
    if (status?.connected) {
      loadOptLogs();
      loadEvalLogs();
      fetchTodAnalytics();
    }
  }, [status?.connected, loadOptLogs, loadEvalLogs, fetchTodAnalytics]);

  const fetchHeatmap = useCallback(async () => {
    try {
      const res = await apiFetch('/session-heatmap', {}, 8000);
      if (res.ok) setHeatmap(await res.json());
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchHeatmap();
    const interval = setInterval(fetchHeatmap, 30000);
    return () => clearInterval(interval);
  }, [fetchHeatmap]);

  const fetchGateLog = useCallback(async () => {
    try {
      const res = await apiFetch('/gate-log', {}, 5000);
      if (res.ok) {
        const data = await res.json();
        setGateLog(data.entries || []);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchGateLog();
    const interval = setInterval(fetchGateLog, 5000);
    return () => clearInterval(interval);
  }, [fetchGateLog]);

  const fetchAssetBreakdown = useCallback(async () => {
    try {
      const res = await apiFetch('/asset-breakdown', {}, 8000);
      if (res.ok) setAssetBreakdown(await res.json());
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchAssetBreakdown();
    const interval = setInterval(fetchAssetBreakdown, 60000);
    return () => clearInterval(interval);
  }, [fetchAssetBreakdown]);

  const fetchDailyPnl = useCallback(async () => {
    try {
      const res = await apiFetch('/daily-pnl', {}, 8000);
      if (res.ok) setDailyPnl(await res.json());
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchDailyPnl();
    const interval = setInterval(fetchDailyPnl, 120000);
    return () => clearInterval(interval);
  }, [fetchDailyPnl]);

  const fetchSchedule = useCallback(async () => {
    try {
      const res = await apiFetch('/schedule', {}, 5000);
      if (res.ok) setSchedule(await res.json());
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchSchedule();
    const interval = setInterval(fetchSchedule, 30000);
    return () => clearInterval(interval);
  }, [fetchSchedule]);

  const saveSchedule = useCallback(async (enabled, windows) => {
    setScheduleSaving(true);
    try {
      const res = await apiFetch('/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, windows }),
      }, 6000);
      if (res.ok) await fetchSchedule();
    } catch (_) {}
    setScheduleSaving(false);
  }, [fetchSchedule]);

  const runBacktest = async (asset) => {
    setBacktestLoading(true);
    try {
      const res = await apiFetch(`/backtest?asset=${encodeURIComponent(asset)}&lookback=30`, {}, 15000);
      if (res.ok) setBacktest(await res.json());
      else setBacktest({ error: (await res.json()).detail || 'Backtest failed' });
    } catch (err) {
      setBacktest({ error: err.message || 'Backtest failed' });
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleAccountChange = async (e) => {
    const selectedId = e.target.value;
    const acc = accounts.find((a) => String(a.id) === selectedId);
    if (!acc) return;
    try {
      await apiFetch('/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_type: acc.type, balance_id: acc.id }),
      });
      await refreshStatus();
    } catch (err) {
      console.error('account switch:', err);
    }
  };

  const handleResetProgress = async () => {
    if (!status || isResetting) return;
    setIsResetting(true);
    setActionError('');
    try {
      const needsReal = status.account_type === 'REAL' || status.is_real_account;
      const res = await apiFetch('/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear_trade_log: clearLogOnReset, confirm: needsReal }),
      }, RESET_TIMEOUT_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.detail || 'Reset failed');
        return;
      }
      setShowResetConfirm(false);
      await refreshStatus();
    } catch (err) {
      setActionError(err.name === 'AbortError' ? 'Reset timed out' : 'Cannot reach server');
    } finally {
      setIsResetting(false);
    }
  };

  const doStart = async (confirmReal = false) => {
    setIsToggling(true);
    setActionError('');
    setShowRealConfirm(false);
    try {
      const res = await apiFetch('/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_real: confirmReal }),
      }, ACTION_TIMEOUT_MS);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.detail || 'Start failed');
        await refreshStatus();
        return;
      }
      await refreshStatus();
    } catch (err) {
      setActionError(err.name === 'AbortError' ? 'Start timed out — check status' : 'Cannot reach server');
      await refreshStatus();
    } finally {
      setIsToggling(false);
    }
  };

  const handleStartStop = async () => {
    if (!status || isToggling) return;
    if (status.running) {
      setIsToggling(true);
      setActionError('');
      try {
        const res = await apiFetch('/stop', { method: 'POST' }, ACTION_TIMEOUT_MS);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setActionError(data.detail || 'Stop failed');
        }
        await refreshStatus();
      } catch (err) {
        setActionError('Cannot reach server');
      } finally {
        setIsToggling(false);
      }
      return;
    }
    if (status.account_type === 'REAL' || status.is_real_account) {
      setShowRealConfirm(true);
      return;
    }
    await doStart(false);
  };

  const handlePauseResume = async () => {
    if (!status?.running || isToggling) return;
    setIsToggling(true);
    try {
      const endpoint = status.paused ? '/resume' : '/pause';
      const res = await apiFetch(endpoint, { method: 'POST' }, ACTION_TIMEOUT_MS);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.detail || 'Pause/resume failed');
      }
      await refreshStatus();
    } finally {
      setIsToggling(false);
    }
  };

  const saveAiSettings = async ({ keys, enabled, shadowMode } = {}) => {
    setAiSaveMsg('');
    const payload = {};
    if (keys !== undefined && keys !== '') payload.gemini_api_keys = keys;
    if (enabled !== undefined) payload.ai_enabled = enabled;
    if (shadowMode !== undefined) payload.ai_shadow_mode = shadowMode;
    if (Object.keys(payload).length === 0) return;
    try {
      const res = await apiFetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const d = err.detail;
        setAiSaveMsg(typeof d === 'string' ? d : Array.isArray(d) ? d.map(e => e.msg || JSON.stringify(e)).join('; ') : 'Save failed');
        return;
      }
      setAiSaveMsg('Saved');
      setAiKeyInput('');
      await refreshStatus();
    } catch (e) {
      setAiSaveMsg('Save failed — check connection');
    }
  };

  const saveConfig = async () => {
    setSaveMessage('');
    try {
      const res = await apiFetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: (config.asset || '').trim(),
          auto_select_asset: config.auto_select_asset === true,
          simulation_mode: !!config.simulation_mode,
          ai_shadow_mode: !!config.ai_shadow_mode,
          sim_win_rate: parseFloat(config.sim_win_rate || 0.55),
          avoid_markets: typeof config.avoid_markets === 'string'
            ? config.avoid_markets.split(',').map((s) => s.trim()).filter(Boolean)
            : config.avoid_markets || [],
          blocked_hours: Array.isArray(config.blocked_hours) ? config.blocked_hours : [],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const d = err.detail;
        setSaveMessage(typeof d === 'string' ? d : Array.isArray(d) ? d.map(e => e.msg || JSON.stringify(e)).join('; ') : 'Save failed');
        return;
      }
      setSaveMessage('Saved — manual pair is a fallback when auto-pick is off.');
      await refreshStatus();
      await loadAssetList();
    } catch (err) {
      console.error('save config:', err);
      setSaveMessage('Could not reach server');
    }
  };

  const initTierEditor = () => {
    const current = config?.budget_tiers || status?.budget_tiers || [[5,11,25],[10,22,50],[20,45,100],[40,90,200]];
    setEditTiers(current.map(t => [...t]));
    setTierSaveMsg('');
  };

  const saveTiers = async () => {
    if (!editTiers) return;
    setTierSaveMsg('');
    try {
      const res = await apiFetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget_tiers: editTiers }),
      }, ACTION_TIMEOUT_MS);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setTierSaveMsg(err.detail || 'Save failed');
        return;
      }
      setTierSaveMsg('Tiers saved!');
      setConfig({ ...config, budget_tiers: editTiers });
      setTimeout(() => setTierSaveMsg(''), 3000);
    } catch (err) {
      setTierSaveMsg('Could not reach server');
    }
  };

  const loadAiComparison = async () => {
    setAiLoading(true);
    setAiComparison(null);
    try {
      const res = await apiFetch('/ai-comparison', {}, 15000);
      if (res.ok) setAiComparison(await res.json());
      else setAiComparison({ error: (await res.json().catch(() => ({}))).detail || 'Failed to load' });
    } catch (err) {
      setAiComparison({ error: err.message || 'Failed to load' });
    } finally {
      setAiLoading(false);
    }
  };

  const exportTradeHistory = async (format = 'json') => {
    try {
      const res = await apiFetch(`/trades/export?format=${format}&limit=10000`, {}, 60000);
      if (!res.ok) return;
      const date = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trade_history_${date}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trade_history_${date}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('export trade history:', err);
    }
  };

  const tradeEval = (t) => t.bot_evaluation || {};
  const fmtConf = (v) => (v != null && v !== '' ? `${Math.round(Number(v) * 100)}%` : '—');

  const exportAiComparison = () => {
    if (!aiComparison?.trades) return;
    const header = 'Time,Asset,Tier,Step,Bet,Bot Direction,Bot P/L,Bot Won,AI Approved,AI Confidence,AI Reason,AI Direction,Verdict\n';
    const rows = aiComparison.trades.map(t =>
      [t.ts, t.asset, t.tier, t.step, t.bet, t.bot_direction, t.bot_profit, t.bot_won, t.ai_approved, t.ai_confidence ? (t.ai_confidence * 100).toFixed(0) + '%' : '', `"${(t.ai_reason || '').replace(/"/g, "'")}"`  , t.ai_direction, t.ai_result].join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_vs_bot_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleWizardSubmit = async (e) => {
    e.preventDefault();
    setWizardLoading(true);
    setWizardError('');
    try {
      const res = await fetch(`${API_URL}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wizardData),
      });
      const data = await res.json();
      if (!res.ok) { setWizardError(data.detail || 'Setup failed'); return; }
      if (data.mode === 'railway') {
        setWizardDone(true);
        return;
      }
      setShowSetupWizard(false);
      setWizardDone(false);
    } catch (err) {
      setWizardError('Could not reach server');
    } finally {
      setWizardLoading(false);
    }
  };


  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, padding: '1rem',
  };
  const cardStyle = {
    background: '#0f172a', border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: '16px', padding: '2.5rem', maxWidth: '480px', width: '100%',
    boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
  };
  const inputStyle = {
    width: '100%', padding: '0.75rem 1rem', borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.07)',
    color: '#e2e8f0', fontSize: '0.9rem', boxSizing: 'border-box', marginBottom: '0.75rem',
  };
  const btnPrimaryStyle = {
    width: '100%', padding: '0.875rem', borderRadius: '8px',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white',
    fontWeight: 700, fontSize: '0.95rem', border: 'none', cursor: 'pointer',
  };

  if (showSetupWizard) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <h2 style={{ color: '#e2e8f0', margin: '0 0 0.5rem', fontSize: '1.5rem', fontWeight: 700 }}>
            Welcome to Besta Bot 👋
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            {setupStatus?.is_railway
              ? 'Running on Railway. Set your credentials via Railway Variables and redeploy.'
              : 'Connect your IQ Option account to get started.'}
          </p>
          {wizardDone ? (
            <div>
              <div style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: '8px', padding: '1rem', color: '#34d399', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                <strong>Running on Railway</strong><br/>
                Go to your Railway project → Variables tab → set <code>IQ_EMAIL</code>, <code>IQ_PASSWORD</code>, and <code>IQ_ACCOUNT_TYPE</code>, then click Redeploy.
              </div>
              <button style={btnPrimaryStyle} onClick={() => setShowSetupWizard(false)}>Close</button>
            </div>
          ) : (
            <form onSubmit={handleWizardSubmit}>
              <label style={{ color: '#94a3b8', fontSize: '0.8rem' }}>IQ Option Email</label>
              <input style={inputStyle} type="email" placeholder="your@email.com" value={wizardData.iq_email}
                onChange={e => setWizardData(d => ({ ...d, iq_email: e.target.value }))} required />
              <label style={{ color: '#94a3b8', fontSize: '0.8rem' }}>IQ Option Password</label>
              <input style={inputStyle} type="password" placeholder="••••••••" value={wizardData.iq_password}
                onChange={e => setWizardData(d => ({ ...d, iq_password: e.target.value }))} required />
              <label style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Account Type</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={wizardData.iq_account_type}
                onChange={e => setWizardData(d => ({ ...d, iq_account_type: e.target.value }))}>
                <option value="PRACTICE">Practice (Recommended)</option>
                <option value="REAL">Real</option>
              </select>
              {wizardError && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0 0 0.75rem' }}>{wizardError}</p>}
              <button style={{ ...btnPrimaryStyle, opacity: wizardLoading ? 0.7 : 1 }} type="submit" disabled={wizardLoading}>
                {wizardLoading ? 'Connecting…' : 'Connect & Start'}
              </button>
              <button type="button" onClick={() => setShowSetupWizard(false)}
                style={{ width: '100%', marginTop: '0.75rem', padding: '0.75rem', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem' }}>
                Skip — I'll configure manually
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }


  if (!status || !config) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'white' }}>
        Connecting…
      </div>
    );
  }

  const tiers = config.budget_tiers || status.budget_tiers || [];
  const tierNum = (status.current_tier_index || 0) + 1;
  const assignedTier = status.assigned_tier || tierNum;
  const stepNum = status.current_step || (status.session_round_count || 0) + 1;
  const ladderSteps = status.ladder_steps || (tiers[status.current_tier_index]?.length) || 3;

  return (
    <div className="dashboard-container">
      {(status.is_real_account || status.account_type === 'REAL') && (
        <div style={{ background: '#7f1d1d', color: '#fecaca', textAlign: 'center', padding: '0.5rem', fontWeight: 700 }}>
          REAL MONEY — live orders
        </div>
      )}
      {status.simulation_mode && (
        <div style={{ background: '#1e3a5f', color: '#93c5fd', textAlign: 'center', padding: '0.5rem', fontWeight: 600 }}>
          SIMULATION — no real orders
        </div>
      )}

      {showRealConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="glass-panel" style={{ maxWidth: 400, padding: '1.5rem' }}>
            <h3 style={{ color: '#fca5a5' }}>Start REAL trading?</h3>
            <p style={{ margin: '1rem 0' }}>Live balance will be used.</p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" className="btn-save" onClick={() => doStart(true)} disabled={isToggling}>Confirm</button>
              <button type="button" onClick={() => setShowRealConfirm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <header className="header">
        <div className="header-title">
          <Activity size={26} color="#3b82f6" />
          IQ Martingale Bot
        </div>
        <div className="header-controls">
          <span style={{ fontSize: '0.85rem', color: status.connected ? '#10b981' : '#f59e0b' }}>
            {status.connecting ? 'Connecting…' : status.connected ? 'Connected' : 'Disconnected'}
          </span>
          <select
            onChange={handleAccountChange}
            value={resolveActiveAccountId(status, accounts)}
          >
            {accounts.length === 0 ? (
              <option value="">Loading…</option>
            ) : (
              accounts.map((acc) => (
                <option key={acc.id} value={String(acc.id)}>
                  {acc.label} — ${acc.amount.toFixed(2)}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className={`header-refresh-balance-btn${isRefreshingBalance ? ' spinning' : ''}`}
            onClick={refreshBalance}
            disabled={isRefreshingBalance || !status.connected}
            title="Refresh balance from IQ Option"
            aria-label="Refresh balance from IQ Option"
          >
            <RotateCcw size={16} />
            Refresh balance
          </button>
          <div className="balance-badge">
            <DollarSign size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} />
            {status.balance.toFixed(2)}
          </div>
        </div>
      </header>

      <div className="main-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
          <div className="glass-panel control-section">
            <div className={`status-badge ${status.running && !status.paused ? 'active' : 'idle'}`}>
              {status.running ? (status.paused ? 'PAUSED' : 'RUNNING') : status.connected ? 'STOPPED' : 'DISCONNECTED'}
            </div>
            <button
              className={`power-btn ${status.running ? 'stop' : 'start'}`}
              onClick={handleStartStop}
              disabled={isToggling || (!status.running && !status.connected)}
            >
              <Power size={48} />
            </button>
            {status.running && (
              <button type="button" onClick={handlePauseResume} disabled={isToggling} style={{ marginTop: '0.75rem' }}>
                {status.paused ? 'Resume' : 'Pause'}
              </button>
            )}
            
            {/* AI Status Card */}
            <div style={{ marginTop: '1.5rem', background: config.ai_active ? 'rgba(167,139,250,0.12)' : 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: config.ai_active ? '1px solid rgba(167,139,250,0.35)' : '1px solid rgba(255,255,255,0.05)', transition: 'all 0.3s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1.1rem' }}>🤖</span>
                <span style={{ fontWeight: 600, fontSize: '0.95rem', color: config.ai_active ? '#e2e8f0' : 'var(--text-muted)' }}>AI Trade Analysis</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', padding: '0.15rem 0.5rem', borderRadius: '4px', background: config.ai_active ? (config.ai_shadow_mode ? '#7c3aed' : '#059669') : '#374151', color: '#fff' }}>
                  {config.ai_active ? (config.ai_shadow_mode ? 'SHADOW' : 'ACTIVE') : 'OFF'}
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {config.ai_active
                  ? config.ai_shadow_mode
                    ? 'AI analyses every trade but never blocks it — observe-only mode.'
                    : 'AI is live. It approves, rejects, or skips trades based on market context.'
                  : 'AI is off. Bot uses rule-based signal gates only.'}
              </div>
              {config.ai_error_msg ? (
                <div style={{ marginTop: '0.6rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '6px', padding: '0.5rem 0.65rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#fca5a5', fontWeight: 600, marginBottom: '0.25rem' }}>⚠️ AI Disabled — Key Error</div>
                  <div style={{ fontSize: '0.7rem', color: '#fca5a5', lineHeight: 1.45 }}>{config.ai_error_msg}</div>
                  <button
                    type="button"
                    onClick={() => document.getElementById('ai-analysis-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    style={{ marginTop: '0.4rem', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '5px', padding: '0.25rem 0.6rem', color: '#fca5a5', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Fix AI Key ↓
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: '0.6rem' }}>
                  <button
                    type="button"
                    onClick={() => document.getElementById('ai-analysis-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    style={{ background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(167,139,250,0.4)', borderRadius: '6px', padding: '0.3rem 0.75rem', color: '#a78bfa', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.02em' }}
                  >
                    ⚙️ Go to AI Settings ↓
                  </button>
                </div>
              )}
            </div>

            {actionError && <p style={{ color: '#f87171', fontSize: '0.9rem', marginTop: '1rem' }}>{actionError}</p>}
            {!status.running && (status.cumulative_debt > 0 || stepNum > 1) && (
              <p style={{ color: '#93c5fd', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                Resume: Tier {tierNum} step {stepNum}/{ladderSteps}
                {status.cumulative_debt > 0 ? ` · debt $${status.cumulative_debt.toFixed(2)}` : ''}
              </p>
            )}
          </div>

          <div className="glass-panel">
            <h2 className="panel-title">Status</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">Pair</span>
                <span className="stat-value" style={{ fontSize: '0.95rem' }}>{status.asset}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Tier / step</span>
                <span className="stat-value">T{tierNum} · {stepNum}/{ladderSteps}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Next bet (per leg)</span>
                <span className="stat-value" style={{ color: '#60a5fa' }}>${status.current_bet?.toFixed(2) ?? '—'}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Recovery debt</span>
                <span className={`stat-value ${(status.cumulative_debt || 0) <= 0 ? 'profit' : 'loss'}`}>
                  ${(status.cumulative_debt || 0).toFixed(2)}
                </span>
              </div>
              <div className="stat-card" title="Round 1 = normal play (T0+T1). Round 2 = escalation (T2+T3). Round 3 = last resort (T4+T5). After any recovery the bot always returns to Round 1.">
                <span className="stat-label">Round</span>
                <span className="stat-value" style={{ color: status.active_round === 1 ? '#34d399' : status.active_round === 2 ? '#fbbf24' : '#f87171' }}>
                  {status.active_round ?? 1}
                  {status.active_round > 1 ? ' ⚠' : ''}
                </span>
              </div>
              {status.is_reserve_tier && (
                <div className="stat-card" title="Wins still needed on this reserve tier before returning to Round 1. Each step win counts more: S1=1, S2=2, S3=3.">
                  <span className="stat-label">Wins to recover</span>
                  <span className="stat-value" style={{ color: '#fbbf24' }}>
                    {status.reserve_wins_needed ?? 3} left
                  </span>
                </div>
              )}
              {status.is_mopup_phase && (
                <div className="stat-card" title={`T${status.mopup_tier} is recovering prior-round losses. Once this debt hits $0 the bot returns to Round 1 (T0).`} style={{ gridColumn: '1 / -1' }}>
                  <span className="stat-label" style={{ color: '#fb923c' }}>🔄 Mop-up Phase · T{status.mopup_tier}</span>
                  <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        borderRadius: 4,
                        background: 'linear-gradient(90deg, #f97316, #fb923c)',
                        width: status.mopup_initial_debt > 0
                          ? `${Math.max(0, Math.min(100, ((status.mopup_initial_debt - status.cumulative_debt) / status.mopup_initial_debt) * 100))}%`
                          : '0%',
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <span className="stat-value" style={{ color: '#fb923c', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                      ${(status.cumulative_debt || 0).toFixed(2)} left
                    </span>
                  </div>
                  <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Prior-round losses: ${(status.mopup_initial_debt || 0).toFixed(2)} · Recovered: ${Math.max(0, (status.mopup_initial_debt || 0) - (status.cumulative_debt || 0)).toFixed(2)}
                  </div>
                </div>
              )}
              {status.slope_flip_blocked && Object.keys(status.slope_flip_blocked).length > 0 && (
                <div className="stat-card" title="Assets temporarily blocked because the 3-bar short-term slope reversed against the 15-bar medium slope. Bot switches to next best asset or waits. Block expires in ~12 min." style={{ gridColumn: '1 / -1' }}>
                  <span className="stat-label" style={{ color: '#a78bfa' }}>⚡ Slope-flip Cooldowns</span>
                  <div style={{ marginTop: '0.4rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {Object.entries(status.slope_flip_blocked).map(([asset, secsLeft]) => {
                      const minsLeft = Math.ceil(secsLeft / 60);
                      const pct = Math.max(0, Math.min(100, (secsLeft / 720) * 100));
                      return (
                        <div key={asset} style={{
                          background: 'rgba(139,92,246,0.12)',
                          border: '1px solid rgba(139,92,246,0.30)',
                          borderRadius: 6,
                          padding: '0.3rem 0.55rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                          minWidth: 110,
                        }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#a78bfa' }}>{asset}</span>
                          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 2, background: '#a78bfa', width: `${pct}%`, transition: 'width 1s linear' }} />
                          </div>
                          <span style={{ fontSize: '0.70rem', color: 'var(--text-muted)' }}>{minsLeft}m left</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="stat-card">
                <span className="stat-label">Window P/L</span>
                <span className={`stat-value ${(status.window_profit || 0) >= 0 ? 'profit' : 'loss'}`}>
                  ${(status.window_profit || 0).toFixed(2)}
                </span>
              </div>
              {(status.tier_failure_streak > 0 || status.tier_exhaustion_cooldown_until) && (
                <div className="stat-card">
                  <span className="stat-label">Protection</span>
                  <span className="stat-value" style={{ fontSize: '0.85rem' }}>
                    {status.tier_exhaustion_cooldown_until ? 'Cooldown' : `Fail ${status.tier_failure_streak}`}
                  </span>
                </div>
              )}
              <div className="stat-card" title={`Pauses trading for 30 min after ${status.consec_ladder_loss_limit ?? 2} back-to-back full-ladder losses. Resets on any win.`}>
                <span className="stat-label">Full-ladder losses</span>
                <span
                  className="stat-value"
                  style={{
                    color:
                      (status.consecutive_full_ladder_losses ?? 0) === 0
                        ? '#34d399'
                        : (status.consecutive_full_ladder_losses ?? 0) >= (status.consec_ladder_loss_limit ?? 2)
                        ? '#f87171'
                        : '#fbbf24',
                  }}
                >
                  {status.consecutive_full_ladder_losses ?? 0} / {status.consec_ladder_loss_limit ?? 2}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Session P/L</span>
                <span className={`stat-value ${(status.session_profit || 0) >= 0 ? 'profit' : 'loss'}`}>
                  ${(status.session_profit || 0).toFixed(2)}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Total P/L</span>
                <span className={`stat-value ${(status.total_profit || 0) >= 0 ? 'profit' : 'loss'}`}>
                  ${(status.total_profit || 0).toFixed(2)}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">W / L</span>
                <span className="stat-value">{status.wins} / {status.losses}</span>
              </div>
            </div>
            {status.pair_quality && status.pair_quality.tradeable === false && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  background: 'rgba(248, 113, 113, 0.12)',
                  border: '1px solid rgba(248, 113, 113, 0.35)',
                  fontSize: '0.85rem',
                  color: '#fecaca',
                }}
              >
                <strong>Pair not suitable for straddle</strong>
                <p style={{ margin: '0.35rem 0 0', color: '#fca5a5' }}>
                  {status.pair_quality.reason || 'Market conditions failed quality gates.'}
                </p>
                {status.pair_quality.efficiency_ratio != null && (
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#fcd34d' }}>
                    ER {status.pair_quality.efficiency_ratio} · slope {status.pair_quality.abs_slope}
                    {status.auto_select_asset
                      ? ' — auto-pick will try another pair'
                      : ' — enable auto-pick or change pair'}
                  </p>
                )}
              </div>
            )}
            {status.pair_quality && status.pair_quality.tradeable === true && (
              <p style={{ fontSize: '0.8rem', color: '#34d399', marginTop: '0.75rem' }}>
                Straddle OK · ER {status.pair_quality.efficiency_ratio} · slope {status.pair_quality.abs_slope}
              </p>
            )}
            {status.learned_pattern?.loaded && (
              <p style={{ fontSize: '0.8rem', color: '#a78bfa', marginTop: '0.75rem' }}>
                AI rules active ({status.learned_pattern.source_label || 'history'}):
                ER ≥ {status.learned_pattern.gates?.min_efficiency_ratio},
                slope ≥ {status.learned_pattern.gates?.min_directional_slope}
                {status.learned_pattern.focus_assets?.length > 0 && (
                  <> · focus {status.learned_pattern.focus_assets.join(', ')}</>
                )}
              </p>
            )}
            {Array.isArray(status.scheduled_ladder) && status.scheduled_ladder.length > 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                Current ladder: {status.scheduled_ladder.map((n) => `$${n}`).join(' → ')}
              </p>
            )}
            <button
              type="button"
              className="btn-secondary"
              style={{ marginTop: '1rem' }}
              disabled={isResetting}
              onClick={() => setShowResetConfirm(true)}
            >
              <RotateCcw size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Reset to Tier 1
            </button>
          </div>

          {showResetConfirm && (
            <div className="glass-panel">
              <p>Reset {status.account_key || status.account_type} to Tier 1, $0 debt?</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Stops the bot if needed, then clears Tier/debt for all accounts, penalties, and trade history.
                Each new Railway deploy also starts fresh automatically.
              </p>
              <label style={{ display: 'flex', gap: '0.5rem', margin: '0.75rem 0', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={clearLogOnReset} onChange={(e) => setClearLogOnReset(e.target.checked)} />
                Clear trade history and relearned pair rules (recommended)
              </label>
              {actionError && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0.5rem 0' }}>{actionError}</p>}
              <button type="button" className="btn-danger" disabled={isResetting} onClick={handleResetProgress}>
                {isResetting ? 'Resetting…' : 'Reset'}
              </button>
              <button type="button" style={{ marginLeft: '0.5rem' }} onClick={() => { setShowResetConfirm(false); setActionError(''); }}>Cancel</button>
            </div>
          )}

          {/* ── Daily P&L Chart ── */}
          {dailyPnl && (() => {
            const days = dailyPnl.days || [];
            const hasData = days.some(d => d.total_trades > 0);
            const W = 560; const H = 160; const padL = 52; const padR = 12; const padT = 12; const padB = 28;
            const chartW = W - padL - padR;
            const chartH = H - padT - padB;
            const n = days.length;
            const barW = Math.max(1, chartW / n - 1.5);

            const maxAbs = Math.max(1, ...days.map(d => Math.abs(d.daily_pnl)));
            const maxCum = Math.max(1, ...days.map(d => Math.abs(d.cumulative_pnl)));

            const barY = (pnl) => {
              const mid = padT + chartH / 2;
              const h = (Math.abs(pnl) / maxAbs) * (chartH / 2);
              return pnl >= 0 ? mid - h : mid;
            };
            const barH = (pnl) => {
              return Math.max(1, (Math.abs(pnl) / maxAbs) * (chartH / 2));
            };
            const cumX = (i) => padL + (i + 0.5) * (chartW / n);
            const cumY = (val) => padT + chartH / 2 - (val / maxCum) * (chartH / 2 - 4);

            const linePoints = days.map((d, i) => `${cumX(i)},${cumY(d.cumulative_pnl)}`).join(' ');

            const fmtDate = (iso) => {
              const d = new Date(iso + 'T00:00:00');
              return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            };
            const fmtPnl = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
            const pnlCol = (v) => v >= 0 ? '#34d399' : '#f87171';

            const tickIdxs = [0, 7, 14, 21, 29].filter(i => i < n);

            return (
              <div className="glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.9rem' }}>
                  <div>
                    <h2 className="panel-title" style={{ marginBottom: '0.25rem' }}>📈 Daily P&amp;L — Last 30 Days</h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {dailyPnl.total_trades} trades · {dailyPnl.profit_days} profit days · {dailyPnl.loss_days} loss days · Lagos Time
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>30d Total</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: pnlCol(dailyPnl.total_pnl) }}>{fmtPnl(dailyPnl.total_pnl)}</div>
                    </div>
                    {dailyPnl.best_day?.daily_pnl > 0 && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Best Day</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#34d399' }}>{fmtPnl(dailyPnl.best_day.daily_pnl)}</div>
                      </div>
                    )}
                    {dailyPnl.worst_day?.daily_pnl < 0 && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Worst Day</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f87171' }}>{fmtPnl(dailyPnl.worst_day.daily_pnl)}</div>
                      </div>
                    )}
                  </div>
                </div>
                {!hasData ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>
                    No trades yet — your P&amp;L chart will appear here after your first trades.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                      {/* Gridlines */}
                      {[0, 0.5, 1].map(f => {
                        const y = padT + f * chartH;
                        return <line key={f} x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />;
                      })}
                      {/* Zero line */}
                      <line x1={padL} x2={W - padR} y1={padT + chartH / 2} y2={padT + chartH / 2} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3,3" />
                      {/* Y-axis labels */}
                      <text x={padL - 5} y={padT + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="9">{fmtPnl(maxAbs)}</text>
                      <text x={padL - 5} y={padT + chartH + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="9">{fmtPnl(-maxAbs)}</text>
                      <text x={padL - 5} y={padT + chartH / 2 + 4} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9">0</text>
                      {/* Daily bars */}
                      {days.map((d, i) => {
                        const x = padL + i * (chartW / n) + 0.75;
                        const col = d.daily_pnl >= 0 ? 'rgba(52,211,153,0.7)' : 'rgba(248,113,113,0.7)';
                        const colBright = d.daily_pnl >= 0 ? '#34d399' : '#f87171';
                        const isToday = i === n - 1;
                        return (
                          <g key={d.date}>
                            <title>{fmtDate(d.date)}: {fmtPnl(d.daily_pnl)} ({d.wins}W/{d.losses}L){d.total_trades === 0 ? ' · no trades' : ''}</title>
                            <rect
                              x={x} y={barY(d.daily_pnl)} width={barW} height={barH(d.daily_pnl)}
                              fill={d.total_trades === 0 ? 'rgba(255,255,255,0.04)' : col}
                              rx="1"
                              stroke={isToday ? colBright : 'none'}
                              strokeWidth={isToday ? 1 : 0}
                            />
                          </g>
                        );
                      })}
                      {/* Cumulative line */}
                      {hasData && (
                        <polyline
                          points={linePoints}
                          fill="none"
                          stroke={dailyPnl.total_pnl >= 0 ? 'rgba(167,139,250,0.85)' : 'rgba(251,191,36,0.85)'}
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                      )}
                      {/* X-axis tick labels */}
                      {tickIdxs.map(i => (
                        <text key={i} x={cumX(i)} y={H - 5} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8.5">
                          {fmtDate(days[i].date)}
                        </text>
                      ))}
                    </svg>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                      <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'rgba(52,211,153,0.7)', borderRadius: '2px', marginRight: '4px', verticalAlign: 'middle' }} />Profit day</span>
                      <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'rgba(248,113,113,0.7)', borderRadius: '2px', marginRight: '4px', verticalAlign: 'middle' }} />Loss day</span>
                      <span><span style={{ display: 'inline-block', width: '20px', height: '2px', background: dailyPnl.total_pnl >= 0 ? 'rgba(167,139,250,0.85)' : 'rgba(251,191,36,0.85)', borderRadius: '1px', marginRight: '4px', verticalAlign: 'middle' }} />Cumulative P&amp;L</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Session Heatmap ── */}
          {heatmap && (() => {
            const riskColor = (lossRate, trades) => {
              if (trades < 3 || lossRate === null) return { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.06)', text: '#4b5563', label: null };
              if (lossRate < 40) return { bg: 'rgba(16,185,129,0.18)', border: 'rgba(52,211,153,0.4)', text: '#34d399', label: 'Low' };
              if (lossRate < 60) return { bg: 'rgba(245,158,11,0.18)', border: 'rgba(251,191,36,0.4)', text: '#fbbf24', label: 'Med' };
              return { bg: 'rgba(239,68,68,0.18)', border: 'rgba(248,113,113,0.4)', text: '#f87171', label: 'High' };
            };
            const anyBlocked = heatmap.is_currently_blocked;
            return (
              <div className="glass-panel" style={anyBlocked ? { border: '1px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.04)' } : {}}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div>
                    <h2 className="panel-title" style={{ marginBottom: '0.25rem' }}>
                      🕐 Session Risk Heatmap
                    </h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Historical loss rate by hour · Lagos Time · {heatmap.days_analyzed}d of data ({heatmap.total_trades_analyzed} trades)
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: anyBlocked ? '#f87171' : '#34d399', letterSpacing: '0.02em' }}>
                      {heatmap.current_time_lagos}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: anyBlocked ? '#f87171' : 'var(--text-muted)', fontWeight: anyBlocked ? 700 : 400, marginTop: '0.15rem' }}>
                      {anyBlocked ? '🚫 BLOCKED WINDOW' : 'Lagos Time'}
                    </div>
                  </div>
                </div>

                {/* 24-hour grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '4px', marginBottom: '1rem' }}>
                  {heatmap.hours.map(h => {
                    const c = riskColor(h.loss_rate_pct, h.trades);
                    const isCurrent = h.is_current;
                    const isBlocked = h.is_blocked;
                    return (
                      <div
                        key={h.hour}
                        title={`${h.label} Lagos${isBlocked ? ' · BLOCKED' : ''}${h.trades >= 3 ? ` · ${h.wins}W/${h.losses}L · ${h.loss_rate_pct}% loss rate` : ' · Not enough data'}`}
                        style={{
                          background: isBlocked ? 'rgba(127,29,29,0.35)' : c.bg,
                          border: `1px solid ${isCurrent ? '#6366f1' : isBlocked ? 'rgba(239,68,68,0.5)' : c.border}`,
                          borderRadius: '6px',
                          padding: '4px 2px',
                          textAlign: 'center',
                          cursor: 'default',
                          boxShadow: isCurrent ? '0 0 0 2px rgba(99,102,241,0.6)' : 'none',
                          position: 'relative',
                          transition: 'transform 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                      >
                        <div style={{ fontSize: '0.6rem', color: isCurrent ? '#c7d2fe' : 'var(--text-muted)', lineHeight: 1, marginBottom: '2px' }}>
                          {h.label}
                        </div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: isBlocked ? '#f87171' : c.text, lineHeight: 1 }}>
                          {isBlocked ? '🚫' : h.trades < 3 ? '—' : `${Math.round(h.loss_rate_pct)}%`}
                        </div>
                        {isCurrent && (
                          <div style={{ position: 'absolute', bottom: '-3px', left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: '#6366f1' }} />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(52,211,153,0.4)' }} />
                    &lt;40% loss — Safe
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(251,191,36,0.4)' }} />
                    40–60% — Caution
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(248,113,113,0.4)' }} />
                    &gt;60% loss — Danger
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(127,29,29,0.35)', border: '1px solid rgba(239,68,68,0.5)' }} />
                    Blocked
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }} />
                    No data
                  </span>
                </div>

                {/* Blocked windows list */}
                <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: '8px', padding: '0.75rem 1rem', border: anyBlocked ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem' }}>
                    🚫 Hard Ban Hours — No Trading Allowed (Lagos Time)
                  </div>
                  {anyBlocked && (
                    <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '7px', padding: '0.5rem 0.75rem', marginBottom: '0.7rem', fontSize: '0.85rem', fontWeight: 700, color: '#f87171' }}>
                      🔴 YOU ARE IN A BLOCKED HOUR RIGHT NOW — bot will not trade until this window ends.
                    </div>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', marginBottom: '0.6rem', padding: '0.4rem 0.5rem', borderRadius: '6px', background: config.override_blocked_windows ? 'rgba(251,191,36,0.1)' : 'transparent', border: config.override_blocked_windows ? '1px solid rgba(251,191,36,0.35)' : '1px solid transparent', transition: 'all 0.2s' }}>
                    <input
                      type="checkbox"
                      checked={!!config.override_blocked_windows}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setConfig({ ...config, override_blocked_windows: next });
                        fetch('/api/config', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ ...config, override_blocked_windows: next }),
                        }).catch(console.error);
                      }}
                      style={{ width: '1.1rem', height: '1.1rem', accentColor: '#f59e0b' }}
                    />
                    <div>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: config.override_blocked_windows ? '#fbbf24' : 'var(--text-muted)' }}>
                        Override blocked windows {config.override_blocked_windows ? '⚠️ ON' : '(blocked by default)'}
                      </span>
                      {config.override_blocked_windows && (
                        <div style={{ fontSize: '0.7rem', color: '#f59e0b', marginTop: '0.15rem' }}>
                          Blocked time windows are being ignored. Bot will trade during normally-blocked hours.
                        </div>
                      )}
                    </div>
                  </label>
                  {heatmap.blocked_windows.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-muted)' }}>
                          <th style={{ textAlign: 'left', padding: '0.2rem 0.4rem', fontWeight: 500 }}>Hours (Lagos)</th>
                          <th style={{ textAlign: 'left', padding: '0.2rem 0.4rem', fontWeight: 500 }}>What's blocked</th>
                          <th style={{ textAlign: 'right', padding: '0.2rem 0.4rem', fontWeight: 500 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {heatmap.blocked_windows.map((w, i) => (
                          <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '0.3rem 0.4rem', fontWeight: w.active ? 700 : 400, color: w.active ? '#f87171' : '#e2e8f0', letterSpacing: '0.01em' }}>
                              {w.active && '🔴 '}
                              {w.label}
                              {w.label_utc && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: '0.3rem' }}>({w.label_utc})</span>}
                            </td>
                            <td style={{ padding: '0.3rem 0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                              {w.description || 'All trades — nothing allowed'}
                            </td>
                            <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>
                              {w.active
                                ? <span style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.5)', color: '#f87171', borderRadius: '4px', padding: '0.1rem 0.45rem', fontSize: '0.7rem', fontWeight: 700 }}>ACTIVE NOW</span>
                                : <span style={{ color: '#34d399', fontSize: '0.72rem' }}>Clear ✓</span>}
                            </td>
                          </tr>
                        ))}
                        {(heatmap.soft_ban_windows || []).map((w, i) => (
                          <tr key={`soft-${i}`} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '0.3rem 0.4rem', fontWeight: w.active ? 700 : 400, color: w.active ? '#fbbf24' : '#fbbf24' }}>
                              {w.active && '🟡 '}
                              {w.label}
                              {w.label_utc && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: '0.3rem' }}>({w.label_utc})</span>}
                            </td>
                            <td style={{ padding: '0.3rem 0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                              {(w.assets || []).join(', ') || 'Specific assets'} only
                            </td>
                            <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>
                              {w.active
                                ? <span style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.5)', color: '#fbbf24', borderRadius: '4px', padding: '0.1rem 0.45rem', fontSize: '0.7rem', fontWeight: 700 }}>ACTIVE NOW</span>
                                : <span style={{ color: '#fbbf24', fontSize: '0.72rem' }}>Soft ban</span>}
                            </td>
                          </tr>
                        ))}
                        {!(heatmap.soft_ban_windows || []).length && (
                          <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <td colSpan={3} style={{ padding: '0.3rem 0.4rem', color: 'var(--text-muted)', fontSize: '0.74rem', fontStyle: 'italic' }}>
                              No soft-ban windows configured (UTC_SOFT_BAN_WINDOWS is empty)
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: '#34d399' }}>No hard ban windows configured.</p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Recent Trades ── */}
          <div className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <h2 className="panel-title" style={{ margin: 0 }}>Recent trades</h2>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn-secondary" onClick={() => exportTradeHistory('json')}>
                  <Download size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  Export JSON
                </button>
                <button type="button" className="btn-secondary" onClick={() => exportTradeHistory('csv')}>
                  <Download size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  Export CSV
                </button>
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Each trade logs bot confidence, ER, slope, straddle score, alignment, and entry snapshot metrics for later analysis.
            </p>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', fontSize: '0.8rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.3rem 0.4rem' }}>Time</th>
                    <th style={{ padding: '0.3rem 0.4rem' }}>Pair</th>
                    <th style={{ padding: '0.3rem 0.4rem' }}>Dir</th>
                    <th style={{ padding: '0.3rem 0.4rem' }}>T/S</th>
                    <th style={{ padding: '0.3rem 0.4rem' }}>Bot%</th>
                    <th style={{ padding: '0.3rem 0.4rem' }}>ER</th>
                    <th style={{ padding: '0.3rem 0.4rem' }}>Slope</th>
                    <th style={{ padding: '0.3rem 0.4rem' }}>Straddle</th>
                    <th style={{ padding: '0.3rem 0.4rem' }}>Align</th>
                    <th style={{ padding: '0.3rem 0.4rem' }}>P/L</th>
                    <th style={{ padding: '0.3rem 0.4rem', color: 'var(--text-muted)' }}>▸</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.length === 0 ? (
                    <tr><td colSpan={11} style={{ padding: '0.5rem 0.4rem', color: 'var(--text-muted)' }}>No trades yet</td></tr>
                  ) : trades.map((t, i) => {
                    const ev = tradeEval(t);
                    const snap = t.entry_snapshot || {};
                    const dir = (ev.direction || t.bot_direction || '—').toUpperCase();
                    const aligned = ev.trend_aligned;
                    const profit = t.round_profit || 0;
                    const isWin = profit > 0;
                    const isExpanded = expandedTradeIndex === i;

                    const dirColor = dir === 'CALL' ? '#34d399' : dir === 'PUT' ? '#f87171' : '#94a3b8';
                    const rowStyle = {
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      cursor: 'pointer',
                      background: isExpanded ? 'rgba(99,102,241,0.08)' : 'transparent',
                      transition: 'background 0.15s',
                    };

                    const flipKind = ev.direction_flip_kind;
                    const ruleGate = ev.rule_gate_reason;
                    const aiApproved = ev.ai_approved;
                    const aiConf = ev.ai_confidence;
                    const aiSkipped = ev.ai_skipped;
                    const aiDisabled = ev.ai_disabled;

                    const fmtNum = (v, dp = 3) => (v != null && v !== '' && !isNaN(Number(v))) ? Number(v).toFixed(dp) : '—';

                    const guardLabel = ruleGate
                      ? ruleGate
                      : (ev.trend_aligned === false ? 'LT trend block' : null);

                    return [
                      <tr
                        key={`row-${i}`}
                        style={rowStyle}
                        onClick={() => setExpandedTradeIndex(isExpanded ? null : i)}
                      >
                        <td style={{ padding: '0.35rem 0.4rem' }}>{t.ts ? new Date(t.ts).toLocaleTimeString() : '—'}</td>
                        <td style={{ padding: '0.35rem 0.4rem' }}>{t.asset}</td>
                        <td style={{ padding: '0.35rem 0.4rem', color: dirColor, fontWeight: 600 }}>{dir}</td>
                        <td style={{ padding: '0.35rem 0.4rem' }}>T{t.tier} S{t.step}</td>
                        <td style={{ padding: '0.35rem 0.4rem' }}>{fmtConf(ev.bot_confidence ?? t.bot_confidence)}</td>
                        <td style={{ padding: '0.35rem 0.4rem' }}>{fmtNum(ev.entry_er ?? snap.efficiency_ratio, 3)}</td>
                        <td style={{ padding: '0.35rem 0.4rem' }}>{fmtNum(ev.entry_slope_signed ?? snap.slope_signed, 1)}</td>
                        <td style={{ padding: '0.35rem 0.4rem' }}>{fmtNum(ev.entry_straddle_score ?? snap.straddle_score, 1)}</td>
                        <td style={{ padding: '0.35rem 0.4rem', color: aligned === true ? '#34d399' : aligned === false ? '#f87171' : 'inherit' }}>
                          {aligned === true ? '✓' : aligned === false ? '✗' : '—'}
                        </td>
                        <td style={{ padding: '0.35rem 0.4rem', color: isWin ? '#34d399' : '#f87171', fontWeight: 600 }}>
                          {isWin ? '+' : ''}${profit.toFixed(2)}
                        </td>
                        <td style={{ padding: '0.35rem 0.4rem', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                          {isExpanded ? '▼' : '▸'}
                        </td>
                      </tr>,
                      isExpanded && (
                        <tr key={`replay-${i}`} style={{ background: 'rgba(15,23,42,0.6)' }}>
                          <td colSpan={11} style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>

                              <div style={{ background: 'rgba(99,102,241,0.08)', borderRadius: '6px', padding: '0.6rem 0.75rem', border: '1px solid rgba(99,102,241,0.2)' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Direction Logic</div>
                                <div style={{ color: dirColor, fontWeight: 700, fontSize: '1rem' }}>{dir}</div>
                                {flipKind && <div style={{ fontSize: '0.7rem', color: '#fbbf24', marginTop: '0.2rem' }}>Flip: {flipKind}</div>}
                                {!flipKind && aligned === true && <div style={{ fontSize: '0.7rem', color: '#34d399', marginTop: '0.2rem' }}>Trend aligned</div>}
                                {!flipKind && aligned === false && <div style={{ fontSize: '0.7rem', color: '#f87171', marginTop: '0.2rem' }}>Counter-trend</div>}
                                {ev.slope_override_flip && <div style={{ fontSize: '0.7rem', color: '#a78bfa', marginTop: '0.2rem' }}>Slope override flip</div>}
                              </div>

                              <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: '6px', padding: '0.6rem 0.75rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry Metrics</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.75rem' }}>
                                  <span><span style={{ color: 'var(--text-muted)' }}>Slope: </span><span style={{ color: (ev.entry_slope_signed ?? snap.slope_signed ?? 0) >= 0 ? '#34d399' : '#f87171' }}>{fmtNum(ev.entry_slope_signed ?? snap.slope_signed, 1)}</span></span>
                                  <span><span style={{ color: 'var(--text-muted)' }}>ER: </span><span style={{ color: '#e2e8f0' }}>{fmtNum(ev.entry_er ?? snap.efficiency_ratio, 3)}</span></span>
                                  <span><span style={{ color: 'var(--text-muted)' }}>Straddle: </span><span style={{ color: '#e2e8f0' }}>{fmtNum(ev.entry_straddle_score ?? snap.straddle_score, 1)}</span></span>
                                  <span><span style={{ color: 'var(--text-muted)' }}>Momentum: </span><span style={{ color: '#e2e8f0' }}>{fmtNum(snap.momentum_ratio, 3)}</span></span>
                                  <span><span style={{ color: 'var(--text-muted)' }}>Confidence: </span><span style={{ color: '#e2e8f0' }}>{fmtConf(ev.bot_confidence ?? t.bot_confidence)}</span></span>
                                </div>
                              </div>

                              <div style={{ background: guardLabel ? 'rgba(251,191,36,0.06)' : 'rgba(15,23,42,0.4)', borderRadius: '6px', padding: '0.6rem 0.75rem', border: `1px solid ${guardLabel ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.06)'}` }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gates</div>
                                {guardLabel
                                  ? <div style={{ fontSize: '0.75rem', color: '#fbbf24', wordBreak: 'break-word' }}>{guardLabel}</div>
                                  : <div style={{ fontSize: '0.75rem', color: '#34d399' }}>All gates passed</div>
                                }
                                {ev.er_floor_used != null && (
                                  <div style={{ fontSize: '0.72rem', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>ER floor:</span>
                                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{ev.er_floor_used.toFixed(3)}</span>
                                    <span style={{ color: 'var(--text-muted)' }}>· actual:</span>
                                    <span style={{
                                      color: (ev.entry_er ?? 0) >= ev.er_floor_used ? '#34d399' : '#f87171',
                                      fontWeight: 600,
                                    }}>{fmtNum(ev.entry_er, 3)}</span>
                                    <span style={{ color: (ev.entry_er ?? 0) >= ev.er_floor_used ? '#34d399' : '#f87171' }}>
                                      {(ev.entry_er ?? 0) >= ev.er_floor_used ? '✓' : '✗'}
                                    </span>
                                  </div>
                                )}
                                {ev.pair_quality_reason && (
                                  <div style={{ fontSize: '0.7rem', color: '#f87171', marginTop: '0.2rem' }}>Pair: {ev.pair_quality_reason}</div>
                                )}
                                {ev.step_score_required != null && (
                                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Step score req: {ev.step_score_required}</div>
                                )}
                              </div>

                              {!aiDisabled && (
                                <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: '6px', padding: '0.6rem 0.75rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Gate</div>
                                  {aiSkipped
                                    ? <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Skipped (high-conf)</div>
                                    : aiApproved === true
                                      ? <div style={{ fontSize: '0.75rem', color: '#34d399' }}>✓ Approved {aiConf != null ? `(${Math.round(aiConf * 100)}%)` : ''}</div>
                                      : aiApproved === false
                                        ? <div style={{ fontSize: '0.75rem', color: '#f87171' }}>✗ Rejected {aiConf != null ? `(${Math.round(aiConf * 100)}%)` : ''}</div>
                                        : <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</div>
                                  }
                                </div>
                              )}

                              <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: '6px', padding: '0.6rem 0.75rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Result</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: isWin ? '#34d399' : '#f87171' }}>
                                  {isWin ? 'WIN' : 'LOSS'} {isWin ? '+' : ''}${profit.toFixed(2)}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                  Bet: ${t.bet} · T{t.tier} S{t.step}
                                </div>
                                {t.debt != null && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Debt after: ${Number(t.debt).toFixed(2)}</div>}
                              </div>

                            </div>
                          </td>
                        </tr>
                      )
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Click any trade row to expand its full reasoning — slope, ER, guards, direction logic, and AI gate decision.
            </p>
          </div>

          {/* ── Pair Swap Advisor ── */}
          {(() => {
            if (!config || !status?.asset) return null;
            const currentAsset = status.asset;
            const flipBlocked = status.slope_flip_blocked || {};
            const plPairs = (status?.pair_learning?.pairs) || {};
            const histByAsset = {};
            for (const row of (assetBreakdown?.assets || [])) histByAsset[row.asset] = row;

            const gateByAsset = {};
            for (const g of gateLog) {
              const a = g.asset || '?';
              if (!gateByAsset[a]) gateByAsset[a] = { count: 0, erShort: 0, cats: {} };
              gateByAsset[a].count++;
              gateByAsset[a].cats[g.category] = (gateByAsset[a].cats[g.category] || 0) + 1;
              if (g.er != null && g.er_floor != null && g.er < g.er_floor) gateByAsset[a].erShort++;
            }

            const currGate = gateByAsset[currentAsset];
            if (!currGate || currGate.count < 2) return null;

            const topCurrCat = Object.entries(currGate.cats).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
            const catLabel = { rule_gate: 'Rule gate', pair_quality: 'Pair quality', slope_flip: 'Slope flip', slope_flip_cooldown: 'Flip cooldown', volatility_filter: 'Vol filter' };
            const catColor = { rule_gate: '#fb923c', pair_quality: '#fbbf24', slope_flip: '#a78bfa', slope_flip_cooldown: '#c4b5fd', volatility_filter: '#60a5fa' };

            const candidates = [...new Set([
              ...(config.asset_candidates || []),
              ...Object.keys(plPairs),
              ...Object.keys(histByAsset),
            ])].filter(a => a && a !== currentAsset);

            if (candidates.length === 0) return null;

            const scored = candidates.map(asset => {
              let score = 50;
              const pl = plPairs[asset];
              const hist = histByAsset[asset];
              const gateInfo = gateByAsset[asset] || { count: 0, erShort: 0 };
              const inFlipCooldown = !!flipBlocked[asset];

              if (pl && (pl.wins + pl.losses) >= 3) score += (pl.win_rate_pct - 50) * 0.9;
              else if (hist && hist.total >= 5) score += (hist.win_rate_pct - 50) * 0.5;

              score -= Math.min(gateInfo.count * 8, 40);
              if (inFlipCooldown) score -= 55;
              if (gateInfo.count > 0 && gateInfo.erShort / gateInfo.count > 0.6) score -= 18;
              if (pl && (pl.wins + pl.losses) >= 8) score += 5;

              score = Math.max(0, Math.min(100, score));

              const reasons = [];
              if (pl && (pl.wins + pl.losses) >= 3) reasons.push(`${pl.win_rate_pct.toFixed(0)}% win rate (${pl.wins + pl.losses} trades)`);
              else if (hist && hist.total >= 5) reasons.push(`${hist.win_rate_pct.toFixed(0)}% hist. win rate`);
              else reasons.push('No learning data yet');
              if (gateInfo.count === 0) reasons.push('zero session rejections');
              else reasons.push(`${gateInfo.count} rejection${gateInfo.count !== 1 ? 's' : ''} this session`);
              if (inFlipCooldown) {
                const mins = Math.ceil((flipBlocked[asset] || 0) / 60);
                reasons.push(`⚡ flip cooldown (${mins}m left)`);
              }

              return { asset, score, reasons, inFlipCooldown, gateCount: gateInfo.count, pl, hist };
            });

            scored.sort((a, b) => b.score - a.score);
            const top3 = scored.slice(0, 3);

            const switchAsset = async (newAsset) => {
              const updated = { ...config, asset: newAsset };
              setConfig(updated);
              try {
                await apiFetch('/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    asset: newAsset,
                    auto_select_asset: config.auto_select_asset === true,
                    simulation_mode: !!config.simulation_mode,
                    avoid_markets: Array.isArray(config.avoid_markets) ? config.avoid_markets : [],
                    blocked_hours: Array.isArray(config.blocked_hours) ? config.blocked_hours : [],
                  }),
                });
              } catch (_) {}
            };

            const scoreBarColor = (s) => s >= 65 ? '#34d399' : s >= 45 ? '#fbbf24' : '#f87171';

            return (
              <div className="glass-panel" style={{ border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.85rem' }}>
                  <div>
                    <h2 className="panel-title" style={{ marginBottom: '0.2rem' }}>🎯 Pair Swap Advisor</h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{currentAsset}</span>
                      {' '}has <span style={{ color: catColor[topCurrCat] || '#fbbf24', fontWeight: 600 }}>{currGate.count} {catLabel[topCurrCat] || 'gate'} rejection{currGate.count !== 1 ? 's' : ''}</span> this session
                      {currGate.erShort > 0 && <span style={{ color: '#f87171' }}> · ER short {currGate.erShort}×</span>}
                      {flipBlocked[currentAsset] && <span style={{ color: '#a78bfa' }}> · ⚡ flip cooldown active</span>}
                    </p>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>scored by win rate · session rejections · cooldown</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.65rem' }}>
                  {top3.map((c, idx) => (
                    <div key={c.asset} style={{
                      background: idx === 0 ? 'rgba(99,102,241,0.1)' : 'rgba(15,23,42,0.45)',
                      border: `1px solid ${idx === 0 ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.07)'}`,
                      borderRadius: '8px',
                      padding: '0.7rem 0.85rem',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {idx === 0 && <span style={{ fontSize: '0.68rem', background: 'rgba(99,102,241,0.3)', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc', borderRadius: '4px', padding: '0.05rem 0.3rem', fontWeight: 700 }}>TOP PICK</span>}
                          <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '0.85rem' }}>{c.asset}</span>
                        </div>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: scoreBarColor(c.score) }}>{Math.round(c.score)}</span>
                      </div>

                      <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginBottom: '0.45rem', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${c.score}%`, background: scoreBarColor(c.score), borderRadius: '2px', transition: 'width 0.4s' }} />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem', marginBottom: '0.5rem' }}>
                        {c.reasons.map((r, ri) => (
                          <span key={ri} style={{
                            fontSize: '0.7rem',
                            color: r.includes('rejection') && c.gateCount > 0 ? '#f87171'
                              : r.includes('cooldown') ? '#a78bfa'
                              : r.includes('win rate') ? '#34d399'
                              : 'var(--text-muted)',
                          }}>{r}</span>
                        ))}
                      </div>

                      <button
                        type="button"
                        disabled={c.inFlipCooldown || !status?.connected}
                        onClick={() => switchAsset(c.asset)}
                        style={{
                          width: '100%',
                          padding: '0.3rem 0',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          borderRadius: '5px',
                          border: c.inFlipCooldown ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(99,102,241,0.5)',
                          background: c.inFlipCooldown ? 'rgba(139,92,246,0.08)' : 'rgba(99,102,241,0.18)',
                          color: c.inFlipCooldown ? '#a78bfa' : '#a5b4fc',
                          cursor: c.inFlipCooldown ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        {c.inFlipCooldown ? '⚡ In cooldown' : `Switch to ${c.asset}`}
                      </button>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.6rem', margin: '0.6rem 0 0' }}>
                  Scores combine learned win rate, session rejection count, and slope-flip cooldown status. Enable Auto-select to let the bot switch automatically.
                </p>
              </div>
            );
          })()}

          {/* ── Auto-Start Scheduler ── */}
          {schedule && (() => {
            const windows = schedule.windows || [];
            const enabled = schedule.enabled;

            const fmtMins = (mins) => {
              if (!mins) return '';
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              if (h > 0 && m > 0) return `${h}h ${m}m`;
              if (h > 0) return `${h}h`;
              return `${m}m`;
            };
            const fmt12h = (t) => {
              try {
                const [h, m] = t.split(':').map(Number);
                const h12 = h % 12 || 12;
                return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
              } catch { return t; }
            };

            return (
              <div className="glass-panel" style={enabled && !schedule.in_window ? { border: '1px solid rgba(251,191,36,0.3)' } : enabled && schedule.in_window ? { border: '1px solid rgba(52,211,153,0.3)' } : {}}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.9rem' }}>
                  <div>
                    <h2 className="panel-title" style={{ marginBottom: '0.25rem' }}>📅 Auto-Start Trading Hours</h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Set the hours the bot is allowed to auto-start · Lagos Time · Now: <strong style={{ color: '#e2e8f0' }}>{schedule.current_time_lagos}</strong>
                    </p>
                  </div>
                  <button
                    onClick={() => saveSchedule(!enabled, windows)}
                    disabled={scheduleSaving}
                    style={{
                      padding: '0.38rem 1rem', borderRadius: '20px', border: '1px solid',
                      cursor: scheduleSaving ? 'default' : 'pointer', fontWeight: 600, fontSize: '0.8rem',
                      background: enabled ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.05)',
                      color: enabled ? '#34d399' : 'var(--text-muted)',
                      borderColor: enabled ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.1)',
                      opacity: scheduleSaving ? 0.6 : 1, transition: 'all 0.2s',
                    }}
                  >
                    {enabled ? '● ON' : '○ OFF'}
                  </button>
                </div>

                {/* Status banner */}
                {!enabled && (
                  <div style={{ padding: '0.5rem 0.85rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.82rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)' }}>
                    ○ Scheduler is OFF — start and stop the bot manually.
                  </div>
                )}
                {enabled && (
                  <div style={{
                    padding: '0.6rem 0.85rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.83rem', fontWeight: 600,
                    background: schedule.in_window ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.09)',
                    border: `1px solid ${schedule.in_window ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}`,
                    color: schedule.in_window ? '#34d399' : '#fbbf24',
                  }}>
                    {schedule.in_window
                      ? '🟢 Inside your trading hours — bot will auto-start when connected.'
                      : windows.length === 0
                        ? '➕ No hours set yet — add a time range below.'
                        : schedule.next_start_label
                          ? `⏰ Outside your trading hours. Bot will auto-start at ${schedule.next_start_label}${schedule.minutes_until_next ? ` (in ${fmtMins(schedule.minutes_until_next)})` : ''}. You can still start it manually right now.`
                          : '⏰ Outside your trading hours. You can still start the bot manually right now.'}
                  </div>
                )}

                {/* Windows list */}
                {windows.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.85rem' }}>
                    {windows.map((w, i) => {
                      const s = w.start ? fmt12h(w.start) : '—';
                      const e = w.end ? fmt12h(w.end) : '—';
                      const isActive = enabled && schedule.in_window && (() => {
                        try {
                          const [sh, sm] = w.start.split(':').map(Number);
                          const [eh, em] = w.end.split(':').map(Number);
                          const now_m = schedule.current_time_lagos
                            ? (() => {
                                const t = schedule.current_time_lagos;
                                const match = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
                                if (!match) return -1;
                                let h = parseInt(match[1]);
                                const m = parseInt(match[2]);
                                const ap = match[3].toUpperCase();
                                if (ap === 'PM' && h !== 12) h += 12;
                                if (ap === 'AM' && h === 12) h = 0;
                                return h * 60 + m;
                              })()
                            : -1;
                          const start = sh * 60 + sm; const end = eh * 60 + em;
                          return start < end ? (now_m >= start && now_m < end) : (now_m >= start || now_m < end);
                        } catch { return false; }
                      })();
                      return (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '0.45rem 0.75rem', borderRadius: '8px',
                          background: isActive ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isActive ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.07)'}`,
                        }}>
                          <span style={{ fontSize: '0.88rem', fontWeight: 600, color: isActive ? '#34d399' : '#e2e8f0', letterSpacing: '0.01em' }}>
                            {isActive && <span style={{ marginRight: '0.4rem', fontSize: '0.7rem' }}>▶</span>}
                            {s} → {e}
                          </span>
                          <button
                            onClick={() => saveSchedule(enabled, windows.filter((_, j) => j !== i))}
                            disabled={scheduleSaving}
                            title="Remove this window"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '1.1rem', lineHeight: 1, padding: '0 0.1rem', opacity: scheduleSaving ? 0.4 : 0.7 }}
                          >✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add window form */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>From</span>
                  <input
                    type="time" value={newWinStart} onChange={e => setNewWinStart(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '0.32rem 0.5rem', color: '#e2e8f0', fontSize: '0.85rem' }}
                  />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>to</span>
                  <input
                    type="time" value={newWinEnd} onChange={e => setNewWinEnd(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '0.32rem 0.5rem', color: '#e2e8f0', fontSize: '0.85rem' }}
                  />
                  <button
                    className="btn-secondary"
                    style={{ padding: '0.32rem 0.85rem', fontSize: '0.82rem' }}
                    disabled={scheduleSaving || !newWinStart || !newWinEnd}
                    onClick={() => {
                      if (!newWinStart || !newWinEnd) return;
                      saveSchedule(enabled, [...windows, { start: newWinStart, end: newWinEnd }]);
                      setNewWinStart('08:00'); setNewWinEnd('12:00');
                    }}
                  >+ Add Window</button>
                </div>

                <p style={{ marginTop: '0.7rem', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  The scheduler starts the bot at each window's start time and stops it at the end time. If you stop the bot manually the scheduler will restart it at the next window. Disable to take full manual control.
                </p>
              </div>
            );
          })()}

          {/* ── Per-Asset Risk Breakdown ── */}
          {assetBreakdown && (() => {
            const assets = assetBreakdown.assets || [];
            const winColor = (wr) => {
              if (wr >= 60) return '#34d399';
              if (wr >= 45) return '#fbbf24';
              return '#f87171';
            };
            return (
              <div className="glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div>
                    <h2 className="panel-title" style={{ marginBottom: '0.25rem' }}>📊 Per-Asset Risk Breakdown</h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Last {assetBreakdown.days_analyzed}d · {assetBreakdown.total_trades} trades · sorted by loss rate
                    </p>
                  </div>
                </div>
                {assets.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>
                    No trade history yet — data will appear after your first trades.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                          <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Asset</th>
                          <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Trades</th>
                          <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500, minWidth: '120px' }}>Win Rate</th>
                          <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>W / L</th>
                          <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Avg P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assets.map((a) => {
                          const col = winColor(a.win_rate_pct);
                          return (
                            <tr key={a.asset} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '0.45rem 0.5rem', fontWeight: 600, color: '#e2e8f0', letterSpacing: '0.02em' }}>{a.asset}</td>
                              <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>{a.total}</td>
                              <td style={{ padding: '0.45rem 0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.07)', borderRadius: '3px', overflow: 'hidden', minWidth: '60px' }}>
                                    <div style={{ width: `${a.win_rate_pct}%`, height: '100%', background: col, borderRadius: '3px', transition: 'width 0.3s' }} />
                                  </div>
                                  <span style={{ color: col, fontWeight: 600, minWidth: '36px', textAlign: 'right' }}>{a.win_rate_pct}%</span>
                                </div>
                              </td>
                              <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right' }}>
                                <span style={{ color: '#34d399' }}>{a.wins}W</span>
                                <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>/</span>
                                <span style={{ color: '#f87171' }}>{a.losses}L</span>
                              </td>
                              <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: a.avg_pnl >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
                                {a.avg_pnl >= 0 ? '+' : ''}{a.avg_pnl.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="glass-panel">
            <h2 className="panel-title">Per-pair learning (automatic)</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              After each trade the bot saves chart state at entry and updates gates per pair (AUDJPY, GBPJPY, etc.).
              Data from practice, real, and tournament is combined — the same rules apply on whichever account you trade.
            </p>
            {status?.pair_learning && (
              <div style={{ fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                <p style={{ color: '#93c5fd' }}>
                  {status.pair_learning.pair_count} pairs learned from {status.pair_learning.trade_count ?? '—'} logged trades
                  {status.pair_learning.updated_at && (
                    <> · updated {new Date(status.pair_learning.updated_at).toLocaleString()}</>
                  )}
                </p>
                {status.gates_for_active_pair && (
                  <p style={{ color: '#a78bfa', marginTop: '0.35rem' }}>
                    Active {status.asset}: ER ≥ {status.gates_for_active_pair.min_efficiency_ratio},
                    slope ≥ {status.gates_for_active_pair.min_directional_slope}
                    {status.gates_for_active_pair.min_momentum_ratio != null && (
                      <> · momentum ≥ {status.gates_for_active_pair.min_momentum_ratio}</>
                    )}
                  </p>
                )}
                {status.pair_learning.pairs && Object.entries(status.pair_learning.pairs).map(([pair, info]) => (
                  <p key={pair} style={{ color: '#cbd5e1', marginTop: '0.25rem', fontSize: '0.75rem' }}>
                    <strong>{pair}</strong>: {info.wins}W / {info.losses}L ({info.win_rate_pct}%)
                  </p>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn-secondary"
              disabled={learnLoading}
              onClick={forcePairLearningRefresh}
            >
              {learnLoading ? 'Refreshing…' : 'Refresh pair rules now'}
            </button>
          </div>

          <div className="glass-panel">
            <h2 className="panel-title">Win pattern analysis</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Pulls your recent rounds (bot log + IQ history) and compares candle metrics (ER, slope) on wins vs losses.
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={patternLoading || !status.connected}
              onClick={runPatternAnalysis}
            >
              {patternLoading ? 'Analyzing…' : 'Analyze wins vs losses'}
            </button>
            {patternAnalysis?.error && (
              <p style={{ color: '#f87171', fontSize: '0.85rem', marginTop: '0.75rem' }}>{patternAnalysis.error}</p>
            )}
            {patternAnalysis && !patternAnalysis.error && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
                <p>
                  {patternAnalysis.rounds_analyzed} rounds · {patternAnalysis.wins}W / {patternAnalysis.losses}L
                  {patternAnalysis.sources?.local_log != null && (
                    <> · log {patternAnalysis.sources.local_log} · IQ {patternAnalysis.sources.iq_history}</>
                  )}
                </p>
                {patternAnalysis.insights?.map((line, i) => (
                  <p key={i} style={{ color: '#93c5fd', marginTop: '0.35rem' }}>{line}</p>
                ))}
                {patternAnalysis.recommended_thresholds && (
                  <p style={{ marginTop: '0.5rem', color: '#34d399' }}>
                    Suggested: ER ≥ {patternAnalysis.recommended_thresholds.min_efficiency_ratio},
                    slope ≥ {patternAnalysis.recommended_thresholds.min_directional_slope}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar: Settings & Tiers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
          <div className="glass-panel">
            <h2 className="panel-title">Settings</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              {formatLadder(tiers)}
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem', background: 'rgba(15,23,42,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!config.simulation_mode}
                  onChange={(e) => setConfig({ ...config, simulation_mode: e.target.checked })}
                  style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--primary)' }}
                />
                <span style={{ fontSize: '0.9rem' }}>Simulation (dry-run)</span>
              </label>
              
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.auto_select_asset === true}
                  onChange={(e) => setConfig({ ...config, auto_select_asset: e.target.checked })}
                  style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--primary)' }}
                />
                <span style={{ fontSize: '0.9rem' }}>Auto-pick best pair</span>
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', background: '#f59e0b', color: '#0f172a', borderRadius: '4px', padding: '0.15rem 0.4rem' }}>ACTIVE</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Sequential Steps Mode</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Steps cycle 1→2→3→1→2→3… on every trade regardless of win or loss. No cooldown.
                </div>
                <div style={{ marginTop: '0.35rem' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                    Tier is selected automatically by your account balance.
                  </div>
                  {(() => {
                    const tierLabels = ['< $500','$500–$1.5k','$1.5k–$4k','$4k–$10k','$10k–$25k','$25k+'];
                    const raw = config.sequential_amounts;
                    const tierAmounts = (raw && Array.isArray(raw[0]))
                      ? raw
                      : [[5,10,30],[10,20,60],[20,40,120],[40,80,240],[80,160,480],[160,320,960]];
                    return (
                      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', minWidth: '280px' }}>
                        <thead>
                          <tr style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
                            <th style={{ textAlign: 'left', padding: '0.2rem 0.3rem', fontWeight: 500 }}>Tier</th>
                            <th style={{ textAlign: 'left', padding: '0.2rem 0.3rem', fontWeight: 500 }}>Balance</th>
                            <th style={{ padding: '0.2rem 0.3rem', fontWeight: 500 }}>Step 1</th>
                            <th style={{ padding: '0.2rem 0.3rem', fontWeight: 500 }}>Step 2</th>
                            <th style={{ padding: '0.2rem 0.3rem', fontWeight: 500 }}>Step 3</th>
                            <th style={{ padding: '0.2rem 0.3rem', fontWeight: 500, color: '#f59e0b' }}>/ cycle</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tierAmounts.map((tier, i) => (
                            <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '0.25rem 0.3rem', color: '#a78bfa', fontWeight: 700 }}>T{i+1}</td>
                              <td style={{ padding: '0.25rem 0.3rem', color: 'var(--text-muted)' }}>{tierLabels[i] || `T${i+1}`}</td>
                              <td style={{ padding: '0.25rem 0.3rem', textAlign: 'right' }}>${tier[0]}</td>
                              <td style={{ padding: '0.25rem 0.3rem', textAlign: 'right' }}>${tier[1]}</td>
                              <td style={{ padding: '0.25rem 0.3rem', textAlign: 'right' }}>${tier[2]}</td>
                              <td style={{ padding: '0.25rem 0.3rem', textAlign: 'right', color: '#f59e0b', fontWeight: 600 }}>
                                ${tier.reduce((s,v) => s + Number(v), 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Rule Gate */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', background: config.rule_gate_enabled ? '#10b981' : '#6b7280', color: '#0f172a', borderRadius: '4px', padding: '0.15rem 0.4rem' }}>
                    {config.rule_gate_enabled ? 'ON' : 'OFF'}
                  </span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Trade Quality Filter</span>
                  <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!config.rule_gate_enabled}
                      onChange={(e) => setConfig({ ...config, rule_gate_enabled: e.target.checked })}
                      style={{ width: '1.1rem', height: '1.1rem', accentColor: '#10b981' }}
                    />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Enabled</span>
                  </label>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                  Skips trades when the market signal is too weak or the market is moving sideways.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Min signal strength</div>
                    <input
                      type="number"
                      min="0.1" max="0.9" step="0.05"
                      value={config.rule_gate_min_bot_conf ?? 0.35}
                      onChange={(e) => setConfig({ ...config, rule_gate_min_bot_conf: parseFloat(e.target.value) })}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text)', fontSize: '0.85rem' }}
                    />
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>0–1 · default 0.35</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Min trend clarity (ER)</div>
                    <input
                      type="number"
                      min="0.1" max="0.9" step="0.05"
                      value={config.rule_gate_min_er ?? 0.30}
                      onChange={(e) => setConfig({ ...config, rule_gate_min_er: parseFloat(e.target.value) })}
                      style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text)', fontSize: '0.85rem' }}
                    />
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>0–1 · default 0.30</div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Analysis Setup */}
            <div id="ai-analysis-settings" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              {config.ai_error_msg && (
                <div style={{ marginBottom: '0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '6px', padding: '0.55rem 0.7rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#fca5a5', fontWeight: 700, marginBottom: '0.2rem' }}>⚠️ AI Auto-Disabled</div>
                  <div style={{ fontSize: '0.7rem', color: '#fca5a5', lineHeight: 1.45 }}>{config.ai_error_msg}</div>
                  <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.25rem' }}>Enter a new key (or your existing key) below and click "Save &amp; enable AI" to re-activate.</div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', background: config.ai_active ? '#7c3aed' : '#374151', color: '#fff', borderRadius: '4px', padding: '0.15rem 0.4rem' }}>
                  {config.ai_active ? (config.ai_shadow_mode ? 'SHADOW' : 'ACTIVE') : 'OFF'}
                </span>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>AI Analysis</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                Uses Google Gemini to review each trade before it executes — checking candle patterns, recent trade history, session context, and market quality. Requires a free Gemini API key.
              </div>

              {/* Enable / disable */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!config.ai_active}
                    onChange={(e) => saveAiSettings({ enabled: e.target.checked })}
                    style={{ width: '1.1rem', height: '1.1rem', accentColor: '#7c3aed' }}
                  />
                  <span style={{ fontSize: '0.85rem' }}>Enable AI</span>
                </label>
                {config.ai_active && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginLeft: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={!!config.ai_shadow_mode}
                      onChange={(e) => saveAiSettings({ shadowMode: e.target.checked })}
                      style={{ width: '1.1rem', height: '1.1rem', accentColor: '#a78bfa' }}
                    />
                    <span style={{ fontSize: '0.85rem' }}>Shadow mode (observe only)</span>
                  </label>
                )}
              </div>

              {/* Mode explanation */}
              {config.ai_active && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: '6px', padding: '0.5rem 0.65rem', marginBottom: '0.75rem', lineHeight: 1.55 }}>
                  {config.ai_shadow_mode
                    ? '👁 Shadow mode — AI analyses every trade and logs its verdict, but never blocks or skips trades. Good for testing AI accuracy before trusting it with live trades.'
                    : '⚡ Active mode — AI approves or rejects trades before they execute, using 1-min + 5-min candles, recent trade history, session context, and step risk. High bot-confidence trades can still override AI rejections.'}
                </div>
              )}

              {/* Gemini API key input */}
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  Gemini API key {config.ai_key_count > 0 && <span style={{ color: '#34d399' }}>· {config.ai_key_count} key{config.ai_key_count !== 1 ? 's' : ''} saved</span>}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    type={aiKeyVisible ? 'text' : 'password'}
                    placeholder={config.ai_key_count > 0 ? 'Enter new key to replace saved key' : 'AIzaSy…'}
                    value={aiKeyInput}
                    onChange={(e) => setAiKeyInput(e.target.value)}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', padding: '0.35rem 0.5rem', color: 'var(--text)', fontSize: '0.82rem', fontFamily: 'monospace' }}
                  />
                  <button
                    type="button"
                    onClick={() => setAiKeyVisible(v => !v)}
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '0.35rem 0.6rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    {aiKeyVisible ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Get a free key at <strong>aistudio.google.com</strong>. You can add multiple keys separated by commas (they rotate to avoid rate limits).
                </div>
              </div>

              <button
                type="button"
                onClick={() => saveAiSettings({ keys: aiKeyInput, enabled: true })}
                disabled={!aiKeyInput.trim()}
                style={{ background: aiKeyInput.trim() ? '#7c3aed' : '#374151', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.45rem 1rem', fontSize: '0.85rem', cursor: aiKeyInput.trim() ? 'pointer' : 'not-allowed', fontWeight: 600, transition: 'background 0.2s' }}
              >
                Save &amp; enable AI
              </button>
              {config.ai_active && (
                <button
                  type="button"
                  onClick={() => saveAiSettings({ enabled: false })}
                  style={{ marginLeft: '0.5rem', background: 'transparent', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '6px', padding: '0.45rem 0.8rem', fontSize: '0.82rem', cursor: 'pointer' }}
                >
                  Turn off AI
                </button>
              )}
              {aiSaveMsg && (
                <span style={{ marginLeft: '0.75rem', fontSize: '0.82rem', color: aiSaveMsg === 'Saved' ? '#34d399' : '#f87171' }}>{aiSaveMsg}</span>
              )}
            </div>

            <div className="form-group">
              <label>Trading pair (manual)</label>
              <select
                className="form-control"
                value={config.asset || 'GBPJPY-OTC'}
                onChange={(e) => setConfig({ ...config, asset: e.target.value })}
              >
                {[...new Set([config.asset, ...assetList, 'GBPJPY-OTC', 'EURUSD-OTC', 'EURJPY-OTC'])].filter(Boolean).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Active on server: {status?.asset || '—'}
                {assetList.length > 0 ? ` · ${assetList.length} open digitals` : ' · loading pairs…'}
              </p>
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: '0.5rem' }}
                disabled={backtestLoading || !status?.connected}
                onClick={() => runBacktest(config.asset || status?.asset)}
              >
                {backtestLoading ? 'Backtesting…' : 'Backtest pair gates (30m)'}
              </button>
              {backtest && !backtest.error && (
                <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: backtest.tradeable_now ? '#34d399' : '#fbbf24' }}>
                  {backtest.asset}: {backtest.pass_rate_pct}% of last {backtest.lookback_minutes} minutes passed gates
                  {backtest.latest && ` · now ER ${backtest.latest.er} slope ${backtest.latest.slope}`}
                </p>
              )}
              {backtest?.error && (
                <p style={{ fontSize: '0.8rem', color: '#f87171', marginTop: '0.5rem' }}>{backtest.error}</p>
              )}
            </div>
            <div className="form-group">
              <label>Avoid pairs (comma-separated)</label>
              <input
                className="form-control"
                value={Array.isArray(config.avoid_markets) ? config.avoid_markets.join(', ') : ''}
                onChange={(e) => setConfig({ ...config, avoid_markets: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              />
            </div>
            <div className="form-group">
              <label>Blocked hours (0-23, comma-separated local time)</label>
              <input
                className="form-control"
                placeholder="e.g. 14, 15, 23"
                value={Array.isArray(config.blocked_hours) ? config.blocked_hours.join(', ') : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const parts = val.split(',').map(s => s.trim()).filter(s => s !== '' && !isNaN(s)).map(Number);
                  setConfig({ ...config, blocked_hours: parts });
                }}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Bot will pause trading during these hours.
              </p>
            </div>
            <button type="button" className="btn-save" onClick={saveConfig}>Save pair &amp; settings</button>
            {saveMessage && (
              <p style={{ fontSize: '0.85rem', color: '#93c5fd', marginTop: '0.5rem' }}>{saveMessage}</p>
            )}
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
              15-minute evaluation windows. 5-minute cooldown after 1st tier exhaustion; 10-minute cooldown after 2nd exhaustion on the same tier. Each tier needs 2 full exhaustions before escalating. Hard stop after Tier 4 fails twice.
            </p>
          </div>

          {/* Tier Configuration Editor */}
          <div className="glass-panel">
            <h2 className="panel-title">Tier Configuration</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Edit the dollar amounts for each step in each tier. Changes apply immediately to the running bot.
            </p>
            {!editTiers ? (
              <button type="button" className="btn-secondary" onClick={initTierEditor}>Edit Tier Amounts</button>
            ) : (
              <div>
                {editTiers.map((tier, ti) => (
                  <div key={ti} style={{ marginBottom: '0.75rem' }}>
                    <label style={{ fontSize: '0.8rem', color: '#a78bfa', fontWeight: 600 }}>Tier {ti + 1}</label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                      {tier.map((val, si) => (
                        <div key={si} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>S{si + 1}</span>
                          <input
                            type="number"
                            min="1"
                            value={val}
                            onChange={(e) => {
                              const v = parseInt(e.target.value) || 1;
                              const next = editTiers.map((t, i) => i === ti ? t.map((s, j) => j === si ? v : s) : [...t]);
                              setEditTiers(next);
                            }}
                            style={{
                              width: '70px', background: 'rgba(15,23,42,0.5)', border: '1px solid var(--panel-border)',
                              color: 'var(--text-main)', padding: '0.4rem 0.5rem', borderRadius: '6px',
                              fontSize: '0.9rem', textAlign: 'center', fontFamily: 'inherit'
                            }}
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const next = editTiers.map((t, i) => i === ti ? [...t, t[t.length - 1] * 3] : [...t]);
                          setEditTiers(next);
                        }}
                        style={{
                          alignSelf: 'flex-end', background: 'transparent', border: '1px dashed var(--panel-border)',
                          color: 'var(--text-muted)', padding: '0.35rem 0.6rem', borderRadius: '6px',
                          cursor: 'pointer', fontSize: '0.8rem'
                        }}
                      >+step</button>
                      {tier.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = editTiers.map((t, i) => i === ti ? t.slice(0, -1) : [...t]);
                            setEditTiers(next);
                          }}
                          style={{
                            alignSelf: 'flex-end', background: 'transparent', border: '1px dashed rgba(239,68,68,0.3)',
                            color: '#f87171', padding: '0.35rem 0.6rem', borderRadius: '6px',
                            cursor: 'pointer', fontSize: '0.8rem'
                          }}
                        >-step</button>
                      )}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const last = editTiers[editTiers.length - 1];
                      setEditTiers([...editTiers, last.map(v => v * 5)]);
                    }}
                    style={{
                      background: 'transparent', border: '1px dashed var(--panel-border)',
                      color: 'var(--text-muted)', padding: '0.4rem 0.8rem', borderRadius: '6px',
                      cursor: 'pointer', fontSize: '0.8rem'
                    }}
                  >+ Add Tier</button>
                  {editTiers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setEditTiers(editTiers.slice(0, -1))}
                      style={{
                        background: 'transparent', border: '1px dashed rgba(239,68,68,0.3)',
                        color: '#f87171', padding: '0.4rem 0.8rem', borderRadius: '6px',
                        cursor: 'pointer', fontSize: '0.8rem'
                      }}
                    >Remove Last Tier</button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button type="button" className="btn-save" onClick={saveTiers}>Save Tiers</button>
                  <button type="button" className="btn-secondary" onClick={() => { setEditTiers(null); setTierSaveMsg(''); }}>Cancel</button>
                </div>
                {tierSaveMsg && <p style={{ fontSize: '0.85rem', color: '#34d399', marginTop: '0.5rem' }}>{tierSaveMsg}</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI vs Bot Comparison (Full Width) */}
      <div className="glass-panel" style={{ marginTop: '2rem' }}>
        <h2 className="panel-title">
          <Brain size={18} /> AI Shadow Mode Comparison
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Compare what the AI recommended versus what the bot actually did. Analyze every trade to see who made better calls.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" disabled={aiLoading} onClick={loadAiComparison}>
            {aiLoading ? 'Loading…' : 'Load AI Comparison'}
          </button>
          {aiComparison?.trades?.length > 0 && (
            <button type="button" className="btn-secondary" onClick={exportAiComparison}>
              <Download size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Export CSV
            </button>
          )}
        </div>
        {aiComparison?.error && (
          <p style={{ color: '#f87171', fontSize: '0.85rem', marginTop: '0.75rem' }}>{aiComparison.error}</p>
        )}
        {aiComparison && !aiComparison.error && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '12px' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Bot Performance</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                  <span style={{ color: '#34d399' }}>{aiComparison.bot.wins}W</span>
                  <span style={{ color: 'var(--text-muted)', margin: '0 0.25rem' }}>/</span>
                  <span style={{ color: '#f87171' }}>{aiComparison.bot.losses}L</span>
                </p>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {aiComparison.bot.win_rate}% Win Rate
                </p>
                <p style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: '0.5rem', color: aiComparison.bot.pnl >= 0 ? '#34d399' : '#f87171' }}>
                  Total P/L: ${aiComparison.bot.pnl}
                </p>
              </div>
              <div style={{ background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(167,139,250,0.15)', padding: '1.25rem', borderRadius: '12px' }}>
                <p style={{ fontSize: '0.8rem', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>AI Shadow Performance</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                  <span style={{ color: '#34d399' }}>{aiComparison.ai.correct_calls} Right</span>
                  <span style={{ color: 'var(--text-muted)', margin: '0 0.25rem' }}>/</span>
                  <span style={{ color: '#f87171' }}>{aiComparison.ai.wrong_calls} Wrong</span>
                </p>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Agreed with Bot: {aiComparison.ai.agreed_with_bot} times
                </p>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  No Data: {aiComparison.ai.no_data} trades
                </p>
              </div>
            </div>
            <div style={{ overflowX: 'auto', fontSize: '0.85rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(15,23,42,0.2)', borderRadius: '8px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Time</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Asset</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Tier/Step</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Bet</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Bot Result</th>
                    <th style={{ padding: '0.75rem 1rem' }}>AI Opinion</th>
                    <th style={{ padding: '0.75rem 1rem' }}>AI Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {aiComparison.trades.map((t, i) => {
                    const verdictColors = {
                      agreed_win: '#34d399', agreed_loss: '#f87171',
                      saved_loss: '#a78bfa', missed_win: '#fbbf24', no_data: 'var(--text-muted)'
                    };
                    const verdictLabels = {
                      agreed_win: '✓ Both Right', agreed_loss: '✗ Both Wrong',
                      saved_loss: '🛡 AI Saved Loss', missed_win: '⚠ AI Missed Win', no_data: '— No AI Data'
                    };
                    return (
                      <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>{t.ts ? new Date(t.ts).toLocaleTimeString() : '—'}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>{t.asset}</td>
                        <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                          <span style={{ background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>T{t.tier} S{t.step}</span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace' }}>${t.bet}</td>
                        <td style={{ padding: '0.75rem 1rem', color: t.bot_won ? '#34d399' : '#f87171', fontWeight: 500 }}>
                          {t.bot_direction?.toUpperCase()} {t.bot_won ? 'W' : 'L'} ${(t.bot_profit || 0).toFixed(2)}
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <span style={{ color: t.ai_approved === null ? 'var(--text-muted)' : t.ai_approved ? '#34d399' : '#f87171', fontWeight: 500 }}>
                              {t.ai_approved === null ? '—' : t.ai_approved ? `✓ APPROVED (${t.ai_direction?.toUpperCase()})` : `✗ REJECTED (Prefers ${t.ai_direction?.toUpperCase()})`}
                              {t.ai_confidence != null ? ` · ${(t.ai_confidence * 100).toFixed(0)}% Conf` : ''}
                            </span>
                            {t.ai_reason && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', maxWidth: '300px', display: 'inline-block' }}>
                                "{t.ai_reason}"
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: verdictColors[t.ai_result] || 'var(--text-muted)', fontWeight: 600 }}>
                          {verdictLabels[t.ai_result] || t.ai_result}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Time of Day Analytics Panel (Full Width) */}
      <div className="glass-panel" style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 className="panel-title">
              ⏱ Time of Day Analytics
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Historical bot performance grouped by hour (Local Time). Identifies your most profitable and most dangerous trading hours.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={fetchTodAnalytics} disabled={todLoading}>
            {todLoading ? 'Calculating...' : 'Refresh Analytics'}
          </button>
        </div>

        {todAnalytics && todAnalytics.hours && (
          <div className="table-responsive">
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Based on {todAnalytics.totalAnalyzed} historical trades (Local Timezone).
            </p>
            <table className="trades-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem' }}>Local Hour</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 1rem' }}>Total Trades</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 1rem' }}>Win Rate %</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 1rem' }}>Wins / Losses</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 1rem' }}>Net P/L</th>
                </tr>
              </thead>
              <tbody>
                {todAnalytics.hours.filter(h => h.trades > 0).sort((a, b) => b.winRate - a.winRate).map((stat) => {
                  const isGood = stat.winRate >= 55 && stat.trades >= 5;
                  const isBad = stat.winRate < 45 && stat.trades >= 5;
                  
                  return (
                    <tr key={stat.hour} style={{ 
                      borderTop: '1px solid rgba(255,255,255,0.04)',
                      background: isGood ? 'rgba(52, 211, 153, 0.05)' : isBad ? 'rgba(248, 113, 113, 0.05)' : 'transparent'
                    }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>
                        {String(stat.hour).padStart(2, '0')}:00 - {String(stat.hour).padStart(2, '0')}:59
                        {isGood && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: '#34d399' }}>★ Best</span>}
                        {isBad && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: '#f87171' }}>⚠ Danger</span>}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{stat.trades}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: isGood ? '#34d399' : isBad ? '#f87171' : 'inherit', fontWeight: isGood || isBad ? 'bold' : 'normal' }}>
                        {Number(stat.winRate || 0).toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{stat.wins} / {stat.losses}</td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: stat.pnl > 0 ? '#34d399' : stat.pnl < 0 ? '#f87171' : 'inherit', fontWeight: 'bold' }}>
                        ${Number(stat.pnl || 0).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Multi-Agent Optimization Panel (Full Width) */}
      <div className="glass-panel" style={{ marginTop: '2rem', border: '1px solid rgba(167,139,250,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 className="panel-title" style={{ color: '#a78bfa' }}>
              <Brain size={18} /> Multi-Agent AI Optimization
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Three specialized AI agents working together: an Analyst reviewing past trades, a strict Supervisor tuning thresholds safely on the fly, and an Evaluator A/B testing changes to revert bad configurations.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={() => { loadOptLogs(); loadEvalLogs(); }}>
              Refresh Logs
            </button>
            <button type="button" className="btn-primary" onClick={triggerOptimization} disabled={optLoading}>
              {optLoading ? 'Optimizing...' : 'Force Optimization Now'}
            </button>
          </div>
        </div>

        {optLogs?.error && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{optLogs.error}</p>
        )}

        {optLogs && !optLogs.error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
            
            {/* Analyst Agent Panel */}
            <div style={{ background: 'rgba(15,23,42,0.5)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#60a5fa' }}></div>
                <h3 style={{ fontSize: '1rem', margin: 0, fontWeight: 600 }}>Trade Analyst Agent</h3>
              </div>
              
              <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: '1.6', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                <p style={{ margin: 0 }}><strong>Analysis:</strong><br />{optLogs.raw_analyst_report?.analysis || 'No analysis provided.'}</p>
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <strong>Recommendations to Supervisor:</strong>
                  <pre style={{ fontSize: '0.8rem', color: '#93c5fd', margin: '0.5rem 0 0 0', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(optLogs.raw_analyst_report?.recommendations || {}, null, 2)}
                  </pre>
                </div>
              </div>
            </div>

            {/* Supervisor Agent Panel */}
            <div style={{ background: 'rgba(15,23,42,0.5)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(167,139,250,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#a78bfa' }}></div>
                <h3 style={{ fontSize: '1rem', margin: 0, fontWeight: 600, color: '#e2e8f0' }}>Supervisor Agent</h3>
              </div>
              
              <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: '1.6', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                <p style={{ margin: 0 }}><strong>Decision Reasoning:</strong><br />{optLogs.reasoning}</p>
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <strong>Applied Bot Configurations (Bounded):</strong>
                  {Object.keys(optLogs.updates || {}).length === 0 ? (
                    <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted)' }}>No configurations were altered.</p>
                  ) : (
                    <pre style={{ fontSize: '0.8rem', color: '#34d399', margin: '0.5rem 0 0 0', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(optLogs.updates, null, 2)}
                    </pre>
                  )}
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '1rem', textAlign: 'right' }}>
                  Last run: {optLogs.timestamp ? new Date(optLogs.timestamp).toLocaleString() : 'Unknown'}
                </p>
              </div>
            </div>

            {/* Evaluator Agent Panel */}
            <div style={{ background: 'rgba(15,23,42,0.5)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(52,211,153,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399' }}></div>
                <h3 style={{ fontSize: '1rem', margin: 0, fontWeight: 600, color: '#e2e8f0' }}>Evaluator Agent</h3>
              </div>
              
              {!evalLogs || evalLogs.error ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{evalLogs?.error || 'Awaiting evaluation of the current configuration...'}</p>
              ) : (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: '1.6', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                  <p style={{ margin: 0 }}><strong>A/B Test Verdict:</strong></p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', marginBottom: '1rem' }}>
                    <span style={{ 
                      padding: '0.25rem 0.75rem', 
                      borderRadius: '4px', 
                      fontWeight: 600, 
                      fontSize: '0.8rem',
                      background: evalLogs.action === 'revert' ? 'rgba(248,113,113,0.2)' : 'rgba(52,211,153,0.2)',
                      color: evalLogs.action === 'revert' ? '#f87171' : '#34d399'
                    }}>
                      {evalLogs.action === 'revert' ? 'REVERTED TO PREVIOUS CONFIG' : 'KEPT CURRENT CONFIG'}
                    </span>
                  </div>
                  <p style={{ margin: 0 }}><strong>Reasoning:</strong><br />{evalLogs.reasoning}</p>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '1rem', textAlign: 'right' }}>
                    Last run: {evalLogs.timestamp ? new Date(evalLogs.timestamp).toLocaleString() : 'Unknown'}
                  </p>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* ── Admin Panel ──────────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ marginTop: '2rem', border: '1px solid rgba(251,191,36,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 className="panel-title" style={{ color: '#fbbf24' }}>
              🔑 Admin — License Management
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Create, revoke, and monitor license tokens. Only visible to you.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const next = !showAdmin;
              setShowAdmin(next);
              if (next && !adminTokens) loadAdminData();
            }}
          >
            {showAdmin ? 'Hide Admin' : 'Open Admin'}
          </button>
        </div>

        {showAdmin && (
          <div style={{ marginTop: '1.5rem' }}>

            {/* Stats row */}
            {adminStats && (
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                {[
                  { label: 'Total Trades (DB)', value: adminStats.trade_count },
                  { label: 'Total Tokens', value: adminStats.token_count },
                  { label: 'Active Tokens', value: adminStats.active_tokens },
                  { label: 'Bot States Saved', value: adminStats.bot_state_count },
                ].map(s => (
                  <div key={s.label} style={{ background: 'rgba(15,23,42,0.5)', padding: '0.75rem 1.25rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.07)', minWidth: '140px' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fbbf24' }}>{s.value}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.label}</div>
                  </div>
                ))}
                {adminStats.pair_learning_updated_at && (
                  <div style={{ background: 'rgba(15,23,42,0.5)', padding: '0.75rem 1.25rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.07)', minWidth: '200px' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#34d399' }}>Pair Learning Last Saved</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(adminStats.pair_learning_updated_at).toLocaleString()}</div>
                  </div>
                )}
              </div>
            )}

            {/* Create token */}
            <div style={{ background: 'rgba(15,23,42,0.4)', padding: '1.25rem', borderRadius: '10px', border: '1px solid rgba(251,191,36,0.15)', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.9rem', margin: '0 0 1rem', color: '#e2e8f0' }}>Generate New Token</h3>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Duration (days)</label>
                  <input
                    type="number" min="1" max="3650"
                    value={newTokenDays}
                    onChange={e => setNewTokenDays(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.07)', color: '#e2e8f0', width: '110px', fontSize: '0.875rem' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Custom Key <span style={{ color: '#64748b' }}>(leave blank to auto-generate)</span></label>
                  <input
                    type="text"
                    value={newTokenKey}
                    onChange={e => setNewTokenKey(e.target.value)}
                    placeholder="BESTA-XXXX-XXXX"
                    style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.07)', color: '#e2e8f0', width: '100%', fontSize: '0.875rem', boxSizing: 'border-box' }}
                  />
                </div>
                <button
                  type="button"
                  onClick={createToken}
                  style={{ padding: '0.5rem 1.25rem', borderRadius: '6px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#0f172a', fontWeight: 700, border: 'none', cursor: 'pointer', fontSize: '0.875rem', whiteSpace: 'nowrap' }}
                >
                  + Create Token
                </button>
                <button type="button" className="btn-secondary" onClick={loadAdminData} disabled={adminLoading} style={{ whiteSpace: 'nowrap' }}>
                  {adminLoading ? 'Loading…' : '⟳ Refresh'}
                </button>
              </div>
              {adminError && <p style={{ color: '#f87171', fontSize: '0.85rem', marginTop: '0.75rem', margin: '0.75rem 0 0' }}>{adminError}</p>}
              {adminSuccess && <p style={{ color: '#34d399', fontSize: '0.85rem', marginTop: '0.75rem', margin: '0.75rem 0 0', fontFamily: 'monospace' }}>{adminSuccess}</p>}
            </div>

            {/* Token table */}
            {adminTokens && adminTokens.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No tokens yet. Create one above.</p>
            )}
            {adminTokens && adminTokens.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      {['Token Key', 'Status', 'Days', 'Expires', 'HWID', 'Trial', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {adminTokens.map(tok => {
                      const statusColor = { active: '#34d399', expired: '#f87171', revoked: '#64748b', unclaimed: '#fbbf24' }[tok.status] || '#e2e8f0';
                      const isCopied = copiedToken === tok.token_key;
                      return (
                        <tr key={tok.token_key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', color: '#e2e8f0' }}>
                            <span
                              onClick={() => copyToken(tok.token_key)}
                              title="Click to copy"
                              style={{ cursor: 'pointer', borderRadius: '4px', padding: '0.15rem 0.4rem', background: 'rgba(255,255,255,0.06)', userSelect: 'all' }}
                            >
                              {tok.token_key}
                            </span>
                            {isCopied && <span style={{ marginLeft: 6, color: '#34d399', fontSize: '0.75rem' }}>✓ copied</span>}
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: statusColor }}>{tok.status}</td>
                          <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>{tok.duration_days}d</td>
                          <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {tok.expires_at ? new Date(tok.expires_at).toLocaleDateString() : '—'}
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', fontSize: '0.7rem', color: '#64748b', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tok.hwid || ''}>
                            {tok.hwid ? tok.hwid.slice(0, 12) + (tok.hwid.length > 12 ? '…' : '') : '—'}
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', color: tok.is_trial ? '#a78bfa' : 'var(--text-muted)' }}>
                            {tok.is_trial ? 'Trial' : '—'}
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {tok.status === 'revoked' ? (
                              <button
                                type="button"
                                onClick={() => unrevokeToken(tok.token_key)}
                                style={{ padding: '0.25rem 0.6rem', borderRadius: '4px', background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399', cursor: 'pointer', fontSize: '0.75rem' }}
                              >Restore</button>
                            ) : tok.status !== 'expired' && (
                              <button
                                type="button"
                                onClick={() => revokeToken(tok.token_key)}
                                style={{ padding: '0.25rem 0.6rem', borderRadius: '4px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', cursor: 'pointer', fontSize: '0.75rem' }}
                              >Revoke</button>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteToken(tok.token_key)}
                              style={{ padding: '0.25rem 0.6rem', borderRadius: '4px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', cursor: 'pointer', fontSize: '0.75rem' }}
                            >Delete</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

export default App;
