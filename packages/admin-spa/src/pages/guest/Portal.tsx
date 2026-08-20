import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';

interface Plan { id: string; name: string; durationHours: number; price: number; isActive: boolean; }

export default function Portal() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<{ paid: boolean; expiresAt?: string; timeRemaining?: string } | null>(null);
  const [redeemResult, setRedeemResult] = useState<{ success: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.portal.status().then(setStatus).catch(() => {});
    api.plans.list().then(setPlans).catch(() => {});
  }, []);

  const handleRedeem = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setRedeemResult(null);
    try {
      const res = await api.portal.redeem(code.trim());
      setRedeemResult({ success: res.success, message: res.success ? 'Access granted!' : 'Invalid code' });
      if (res.success) setStatus({ paid: true, expiresAt: res.expiresAt });
    } catch {
      setRedeemResult({ success: false, message: 'Network error' });
    }
    setLoading(false);
  };

  return (
    <div className="portal">
      <div className="portal-card">
        <h1>hotshare</h1>
        <p className="subtitle">Connect to WiFi and start browsing</p>

        {status?.paid ? (
          <div className="sub-banner sub-active">
            Connected — expires {status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : 'unknown'}
            {status.timeRemaining && <br />}
            {status.timeRemaining}
          </div>
        ) : (
          <>
            {plans.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {plans.filter(p => p.isActive).map((p) => (
                  <div
                    key={p.id}
                    className={`plan-option ${selectedPlan === p.id ? 'selected' : ''}`}
                    onClick={() => setSelectedPlan(p.id)}
                  >
                    <span className="plan-name">{p.name}</span>
                    <span className="plan-price">KES {p.price}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="voucher-input">
              <input
                className="input"
                placeholder="Enter voucher code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleRedeem()}
              />
              <button className="btn btn-primary" onClick={handleRedeem} disabled={loading}>
                {loading ? '...' : 'Activate'}
              </button>
            </div>

            {redeemResult && (
              <div className={`sub-banner ${redeemResult.success ? 'sub-active' : 'sub-expired'}`} style={{ marginTop: 12 }}>
                {redeemResult.message}
              </div>
            )}
          </>
        )}

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13 }}>
          <Link to="/admin/login" style={{ color: '#64748b', textDecoration: 'none' }}>
            Admin Login
          </Link>
        </p>
      </div>
    </div>
  );
}
