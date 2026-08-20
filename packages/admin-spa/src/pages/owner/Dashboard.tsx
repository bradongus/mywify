import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import StatusBar from '../../components/StatusBar';
import { api } from '../../lib/api';
import type { DeviceState, Device } from '../../lib/types';

export default function Dashboard() {
  const [state, setState] = useState<DeviceState | null>(null);
  const [device, setDevice] = useState<Device | null>(null);

  useEffect(() => {
    const load = () => {
      api.device.getState().then(setState).catch(() => {});
      api.device.getInfo().then(setDevice).catch(() => {});
    };
    load();
    const id = setInterval(() => api.device.getState().then(setState).catch(() => {}), 3000);
    return () => clearInterval(id);
  }, []);

  const subClass = device?.subscriptionStatus === 'active' ? 'sub-active'
    : device?.subscriptionStatus === 'trial' ? 'sub-trial' : 'sub-expired';

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>Dashboard</h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 500, minWidth: 80 }}>Hotspot</span>
        <button
          className="btn"
          style={{ minWidth: 100 }}
          onClick={() => {
            const enabled = !state?.hotspotActive;
            if (!enabled && !confirm('Stop hotspot?')) return;
            api.hotspot.toggle(enabled).then(
              (res) => setState((prev) => (prev ? { ...prev, hotspotActive: res.hotspotActive } : prev)),
              () => {}
            );
          }}
        >
          {state?.hotspotActive ? 'Stop' : 'Start'} Hotspot
        </button>
      </div>

      {state && <StatusBar state={state} />}

      {device && (
        <div className={`sub-banner ${subClass}`}>
          {device.subscriptionStatus === 'active' && (
            <>Active subscription — expires {new Date(device.subscriptionEndsAt || '').toLocaleDateString()}</>
          )}
          {device.subscriptionStatus === 'trial' && (
            <>Free trial — expires {new Date(device.trialEndsAt).toLocaleDateString()}</>
          )}
          {device.subscriptionStatus === 'expired' && (
            <>Subscription expired — <Link to="/admin/settings">renew now</Link></>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12 }}>Quick Actions</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/admin/vouchers"><button className="btn">Generate Voucher</button></Link>
          <Link to="/admin/plans"><button className="btn">Manage Plans</button></Link>
          <Link to="/admin/clients"><button className="btn">View Clients</button></Link>
        </div>
      </div>
    </div>
  );
}
