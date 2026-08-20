import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface Device {
  device_id: string;
  owner_email: string | null;
  owner_phone: string | null;
  subscription_status: string;
  trial_ends_at: string;
  subscription_ends_at: string | null;
  created_at: string;
}

interface Stats {
  total: number;
  active: number;
  trialing: number;
  expired: number;
}

interface Revenue {
  total_revenue: number;
  transactions: number;
}

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const [d, s, r] = await Promise.all([
        fetch(`${API}/api/admin?action=list-devices`).then(r => r.json()),
        fetch(`${API}/api/admin?action=device-stats`).then(r => r.json()),
        fetch(`${API}/api/admin?action=revenue`).then(r => r.json()),
      ]);
      setDevices(d.devices || []);
      setStats(s);
      setRevenue(r);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleExtend = async (deviceId: string) => {
    await fetch(`${API}/api/admin?action=extend&device_id=${deviceId}&days=30`, { method: 'POST' });
    setActionMsg(`Extended ${deviceId}`);
    refresh();
  };

  const handleRevoke = async (deviceId: string) => {
    await fetch(`${API}/api/admin?action=revoke&device_id=${deviceId}`, { method: 'POST' });
    setActionMsg(`Revoked ${deviceId}`);
    refresh();
  };

  const now = Date.now();

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', background: '#0a0a0a', color: '#fafafa', minHeight: '100vh' }}>
      <header style={{ padding: '16px 24px', borderBottom: '1px solid #262626', display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>hotshare</h1>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#166534', color: '#22c55e' }}>Developer</span>
        <button onClick={refresh} style={{ marginLeft: 'auto', padding: '6px 12px', background: '#141414', border: '1px solid #262626', borderRadius: 8, color: '#fafafa', cursor: 'pointer' }}>Refresh</button>
      </header>

      <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        {actionMsg && <div style={{ padding: '10px 16px', background: '#166534', color: '#22c55e', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{actionMsg} <button onClick={() => setActionMsg('')} style={{ background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer' }}>dismiss</button></div>}

        {loading ? <p>Loading...</p> : (
          <>
            {/* Stats cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
              <StatCard value={stats?.total || 0} label="Total Devices" />
              <StatCard value={stats?.active || 0} label="Subscribers" color="#22c55e" />
              <StatCard value={stats?.trialing || 0} label="Trialing" color="#3b82f6" />
              <StatCard value={stats?.expired || 0} label="Expired" color="#ef4444" />
              <StatCard value={`KES ${revenue?.total_revenue?.toLocaleString() || 0}`} label="Total Revenue" color="#f59e0b" />
            </div>

            {/* Device table */}
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>All Devices</h2>
            <div style={{ background: '#141414', border: '1px solid #262626', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Device ID', 'Owner', 'Status', 'Trial Ends', 'Sub Expires', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid #262626', color: '#a1a1a1', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devices.map(d => {
                    const statusColor = d.subscription_status === 'active' ? '#22c55e'
                      : d.subscription_status === 'trial' ? '#3b82f6' : '#ef4444';
                    const isExpired = d.subscription_status === 'expired' ||
                      (d.subscription_ends_at && new Date(d.subscription_ends_at).getTime() < now);
                    return (
                      <tr key={d.device_id} style={{ borderBottom: '1px solid #262626' }}>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 13 }}>{d.device_id.slice(0, 16)}...</td>
                        <td style={{ padding: '10px 12px', fontSize: 13 }}>{d.owner_email || '—'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
                            {d.subscription_status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 13 }}>{new Date(d.trial_ends_at).toLocaleDateString()}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13 }}>{d.subscription_ends_at ? new Date(d.subscription_ends_at).toLocaleDateString() : '—'}</td>
                        <td style={{ padding: '10px 12px', display: 'flex', gap: 4 }}>
                          <button onClick={() => handleExtend(d.device_id)} style={{ padding: '4px 10px', background: '#166534', border: '1px solid #166534', borderRadius: 6, color: '#22c55e', fontSize: 12, cursor: 'pointer' }}>Extend +30d</button>
                          {isExpired && <button onClick={() => handleRevoke(d.device_id)} style={{ padding: '4px 10px', background: 'transparent', border: '1px solid #ef4444', borderRadius: 6, color: '#ef4444', fontSize: 12, cursor: 'pointer' }}>Revoke</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ value, label, color = '#fafafa' }: { value: number | string; label: string; color?: string }) {
  return (
    <div style={{ background: '#141414', border: '1px solid #262626', borderRadius: 12, padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: '#a1a1a1', marginTop: 4 }}>{label}</div>
    </div>
  );
}
