import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Transaction, RevenueSummary } from '../../lib/types';
import DesktopOnlyNotice from '../../components/DesktopOnlyNotice';

export default function Revenue() {
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.revenue.summary(period),
      api.revenue.transactions(),
    ]).then(([s, t]) => {
      setSummary(s);
      setTransactions(t);
    }).finally(() => setLoading(false));
  }, [period]);

  const { platform } = useOutletContext<{ platform?: string }>() ?? {};
  if (platform === 'android') return <DesktopOnlyNotice />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>Revenue</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {['7d', '30d', 'all'].map(p => (
            <button key={p} className={`btn btn-sm ${period === p ? 'btn-primary' : ''}`} onClick={() => setPeriod(p)}>
              {p === 'all' ? 'All Time' : p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="empty">Loading...</div>
      ) : summary ? (
        <>
          <div className="card-grid">
            <div className="card card-stat">
              <div className="value">KES {summary.totalRevenue.toLocaleString()}</div>
              <div className="label">Total Revenue</div>
            </div>
            <div className="card card-stat">
              <div className="value">{summary.totalClients}</div>
              <div className="label">Total Clients</div>
            </div>
            <div className="card card-stat">
              <div className="value">KES {summary.avgPerClient}</div>
              <div className="label">Avg. per Client</div>
            </div>
          </div>

          {summary.byPlan.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h3 style={{ marginBottom: 12 }}>Revenue by Plan</h3>
              {summary.byPlan.map(p => (
                <div key={p.name} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span>{p.name}</span>
                    <span>KES {p.revenue.toLocaleString()} ({p.percentage}%)</span>
                  </div>
                  <div className="bar">
                    <div className="bar-fill" style={{ width: `${p.percentage}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 style={{ marginBottom: 12 }}>Recent Transactions</h3>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead><tr><th>Date</th><th>Code</th><th>Plan</th><th>Amount</th><th>Type</th><th>Status</th></tr></thead>
              <tbody>
                {transactions.map(t => (
                  <tr key={t.id}>
                    <td>{new Date(t.createdAt).toLocaleString()}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.voucherCode || '—'}</td>
                    <td>{t.planName || 'Subscription'}</td>
                    <td>KES {t.amount}</td>
                    <td>{t.type}</td>
                    <td>
                      <span className={`status ${t.status === 'success' ? 'status-ok' : t.status === 'failed' ? 'status-err' : 'status-warn'}`}>
                        <span className="status-dot" />{t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="empty"><div className="icon">💰</div><p>No revenue data</p></div>
      )}
    </div>
  );
}
