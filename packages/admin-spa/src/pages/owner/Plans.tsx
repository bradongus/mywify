import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Plan } from '../../lib/types';
import DesktopOnlyNotice from '../../components/DesktopOnlyNotice';

export default function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', durationHours: 1, price: 0 });

  const refresh = () => {
    api.plans.list().then(setPlans).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleCreate = async () => {
    if (!form.name || !form.price) return;
    await api.plans.create({ ...form, isActive: true });
    setForm({ name: '', durationHours: 1, price: 0 });
    refresh();
  };

  const handleUpdate = async (id: string) => {
    await api.plans.update(id, form);
    setEditing(null);
    refresh();
  };

  const handleDelete = async (id: string) => {
    await api.plans.remove(id);
    refresh();
  };

  const handleToggle = async (plan: Plan) => {
    await api.plans.update(plan.id, { isActive: !plan.isActive });
    refresh();
  };

  const startEdit = (plan: Plan) => {
    setEditing(plan.id);
    setForm({ name: plan.name, durationHours: plan.durationHours, price: plan.price });
  };

  const { platform } = useOutletContext<{ platform?: string }>() ?? {};
  if (platform === 'android') return <DesktopOnlyNotice />;

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>Plans</h2>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>{editing ? 'Edit Plan' : 'New Plan'}</h3>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Name</label>
            <input className="input" placeholder="e.g. 1 Day" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group" style={{ width: 120 }}>
            <label>Duration (hours)</label>
            <input className="input" type="number" min={1} value={form.durationHours} onChange={(e) => setForm({ ...form, durationHours: parseInt(e.target.value) || 1 })} />
          </div>
          <div className="form-group" style={{ width: 120 }}>
            <label>Price (KES)</label>
            <input className="input" type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} />
          </div>
          {editing ? (
            <>
              <button className="btn btn-primary" onClick={() => handleUpdate(editing)}>Save</button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={handleCreate}>Add Plan</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="empty">Loading...</div>
      ) : plans.length === 0 ? (
        <div className="empty"><div className="icon">📋</div><p>No plans yet — create one above</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead><tr><th>Name</th><th>Duration</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td>{p.durationHours}h</td>
                  <td>KES {p.price}</td>
                  <td>
                    <span className={`status ${p.isActive ? 'status-ok' : 'status-warn'}`}>
                      <span className="status-dot" />{p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => handleToggle(p)}>{p.isActive ? 'Deactivate' : 'Activate'}</button>
                    <button className="btn btn-sm" onClick={() => startEdit(p)} style={{ marginLeft: 4 }}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p.id)} style={{ marginLeft: 4 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
