import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Voucher, Plan } from '../../lib/types';
import DesktopOnlyNotice from '../../components/DesktopOnlyNotice';

export default function Vouchers() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    Promise.all([api.vouchers.list(), api.plans.list()]).then(([v, p]) => {
      setVouchers(v);
      setPlans(p);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleGenerate = async () => {
    if (!selectedPlan) return;
    await api.vouchers.generate(selectedPlan, count);
    refresh();
  };

  const handleDeactivate = async (id: string) => {
    await api.vouchers.deactivate(id);
    refresh();
  };

  const active = vouchers.filter(v => !v.isUsed);
  const used = vouchers.filter(v => v.isUsed);

  const { platform } = useOutletContext<{ platform?: string }>() ?? {};
  if (platform === 'android') return <DesktopOnlyNotice />;

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>Vouchers</h2>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Generate Vouchers</h3>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Plan</label>
            <select className="input" value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)}>
              <option value="">Select a plan</option>
              {plans.filter(p => p.isActive).map(p => (
                <option key={p.id} value={p.id}>{p.name} — KES {p.price}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ width: 100 }}>
            <label>Quantity</label>
            <input className="input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 1)} />
          </div>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={!selectedPlan}>Generate</button>
        </div>
      </div>

      <h3 style={{ marginBottom: 12 }}>Active Codes ({active.length})</h3>
      {active.length === 0 ? (
        <div className="empty"><div className="icon">🎟️</div><p>No active vouchers</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead><tr><th>Code</th><th>Plan</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              {active.map(v => (
                <tr key={v.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v.code}</td>
                  <td>{v.planName}</td>
                  <td>{new Date(v.createdAt).toLocaleDateString()}</td>
                  <td><button className="btn btn-sm btn-danger" onClick={() => handleDeactivate(v.id)}>Deactivate</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {used.length > 0 && (
        <>
          <h3 style={{ marginTop: 24, marginBottom: 12 }}>Used Codes ({used.length})</h3>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead><tr><th>Code</th><th>Plan</th><th>Used by</th><th>Used at</th></tr></thead>
              <tbody>
                {used.map(v => (
                  <tr key={v.id}>
                    <td style={{ fontFamily: 'monospace' }}>{v.code}</td>
                    <td>{v.planName}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.usedByMac || '—'}</td>
                    <td>{v.usedAt ? new Date(v.usedAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
