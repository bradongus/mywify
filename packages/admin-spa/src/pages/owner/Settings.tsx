import { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import type { AppSettings, Device, DeviceState } from '../../lib/types';

export default function Settings() {
  const [device, setDevice] = useState<Device | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [maxClients, setMaxClients] = useState(5);
  const [uplinkGuard, setUplinkGuard] = useState(false);
  const [mpesaNumber, setMpesaNumber] = useState('');
  const [wgConfig, setWgConfig] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [protecting, setProtecting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [warpRotateHour, setWarpRotateHour] = useState(3);
  const [warpFailback, setWarpFailback] = useState(true);
  const initialRef = useRef<{ ssid: string; password: string } | null>(null);

  useEffect(() => {
    api.settings.get().then((s: AppSettings) => {
      initialRef.current = { ssid: s.ssid, password: s.password || '' };
      setSsid(s.ssid);
      setPassword(s.password || '');
      setMaxClients(s.maxClients);
      setUplinkGuard(s.uplinkGuardEnabled);
      setMpesaNumber(s.mpesaNumber || '');
      setWarpRotateHour(s.warpRotateHour);
      setWarpFailback(s.warpFailback);
    }).catch(() => {});
    api.device.getInfo().then(setDevice).catch(() => {});
    api.device.getState().then(setDeviceState).catch(() => {});
    // Live-refresh tunnel health for the health card
    const t = setInterval(() => api.device.getState().then(setDeviceState).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, []);

  const handleWgFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setWgConfig(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handleSave = async () => {
    setStatus('saving');
    setError('');
    try {
      const payload: Partial<AppSettings> & { wireguardConfig?: string } = {
        ssid,
        maxClients,
        uplinkGuardEnabled: uplinkGuard,
        mpesaNumber,
        warpRotateHour,
        warpFailback,
      };
      if (password) payload.password = password;
      if (wgConfig) payload.wireguardConfig = btoa(wgConfig);
      await api.settings.update(payload);
      setWgConfig('');
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);

      // If the Wi-Fi name/password changed while the hotspot is running, the
      // new values only take effect after a restart — offer it right away.
      const initial = initialRef.current;
      const wifiChanged = !!initial && (ssid !== initial.ssid || (password !== '' && password !== initial.password));
      if (wifiChanged && deviceState?.hotspotActive) {
        initialRef.current = { ssid, password: password || initial.password };
        if (window.confirm('Saved. Restart the hotspot now to apply the new Wi-Fi name/password? Connected guests will be disconnected briefly.')) {
          setRestarting(true);
          try {
            await api.settings.restartHotspot();
            setDeviceState((s) => (s ? { ...s, hotspotActive: true } : s));
          } catch (e) {
            setStatus('error');
            setError(`Restart failed: ${(e as Error).message}`);
          } finally {
            setRestarting(false);
          }
        }
      } else if (initial) {
        initialRef.current = { ssid, password: password || initial.password };
      }
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    setError('');
    try {
      await api.settings.restartHotspot();
      api.device.getState().then(setDeviceState).catch(() => {});
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    } finally {
      setRestarting(false);
    }
  };

  const handleToggleProtection = async (enable: boolean) => {
    setProtecting(true);
    setError('');
    setStatus('idle');
    try {
      const res = await api.settings.toggleProtection(enable);
      setUplinkGuard(res.uplinkGuardEnabled);
      setStatus('saved');
      api.device.getState().then(setDeviceState).catch(() => {});
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    } finally {
      setProtecting(false);
    }
  };

  const handleImportConfig = async () => {
    if (!wgConfig) return;
    setImporting(true);
    setError('');
    setStatus('idle');
    try {
      await api.settings.update({ wireguardConfig: btoa(wgConfig) });
      setWgConfig('');
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const handleRotateWarp = async () => {
    setRotating(true);
    setError('');
    setStatus('idle');
    try {
      await api.settings.rotateWarp();
      setStatus('saved');
      api.device.getState().then(setDeviceState).catch(() => {});
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    } finally {
      setRotating(false);
    }
  };

  const th = deviceState?.tunnelHealth;

  const subClass = device?.subscriptionStatus === 'active' ? 'sub-active'
    : device?.subscriptionStatus === 'trial' ? 'sub-trial' : 'sub-expired';

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>Settings</h2>

      {device && (
        <div className={`sub-banner ${subClass}`} style={{ marginBottom: 20 }}>
          {device.subscriptionStatus === 'active' && <>Active until {new Date(device.subscriptionEndsAt || '').toLocaleDateString()}</>}
          {device.subscriptionStatus === 'trial' && <>Trial until {new Date(device.trialEndsAt).toLocaleDateString()}</>}
          {device.subscriptionStatus === 'expired' && <>Expired — renew to continue sharing</>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Hotspot</h3>
        <div className="form-group">
          <label>SSID</label>
          <input className="input" value={ssid} maxLength={32} onChange={(e) => setSsid(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Password</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              placeholder="Leave unchanged to keep current"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ paddingRight: 40 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: 4,
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Current password is shown (visible only on this dashboard). Edit it to change.
          </div>
        </div>
        <div className="form-group">
          <label>Max Clients</label>
          <input className="input" type="number" min={1} max={50} value={maxClients} onChange={(e) => setMaxClients(parseInt(e.target.value) || 5)} />
        </div>
        {deviceState?.hotspotActive && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Hotspot is running — saved SSID/password apply after restart.
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Guest Internet Protection</h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          Some ISPs block shared Wi-Fi. Turning this on keeps your guests' internet working.
        </p>

        {th && uplinkGuard && (
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            {th.failedBack ? (
              <span style={{ color: '#e74c3c' }}><b>On — guests are on the direct connection while protection recovers.</b></span>
            ) : th.degraded ? (
              <span style={{ color: '#e67e22' }}><b>On — reconnecting…</b></span>
            ) : (
              <span style={{ color: '#27ae60' }}><b>On — protected.</b></span>
            )}
            {th.connected && !th.failedBack && th.lastEvent && th.resetsToday + th.rotationsToday + th.failbacksToday > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}Auto-fixed {th.resetsToday + th.rotationsToday + th.failbacksToday} {th.resetsToday + th.rotationsToday + th.failbacksToday === 1 ? 'time' : 'times'} today (last {new Date(th.lastEvent.ts).toLocaleTimeString()}).
              </span>
            )}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <button className="btn btn-primary" onClick={() => handleToggleProtection(!uplinkGuard)} disabled={protecting}>
            {protecting
              ? (uplinkGuard ? 'Turning off…' : 'Setting up protection… (up to 30s first time)')
              : (uplinkGuard ? 'Turn off protection' : 'Turn on protected internet')}
          </button>
          {!uplinkGuard && (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              First time takes about 30 seconds — the app sets everything up automatically.
            </span>
          )}
        </div>

        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}>Advanced</summary>
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <div className="form-group">
              <label>Use your own VPN config (optional)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="input" type="file" accept=".conf" onChange={(e) => handleWgFile(e.target.files?.[0])} />
                <button className="btn" onClick={handleImportConfig} disabled={importing || !wgConfig}>
                  {importing ? 'Importing…' : 'Import'}
                </button>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <button className="btn" onClick={handleRotateWarp} disabled={rotating}>
                {rotating ? 'Refreshing…' : 'Refresh VPN identity now'}
              </button>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                Creates a fresh identity — use it if the current one stops working.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
                Daily refresh hour (0-23, -1 off)
                <input
                  className="input"
                  type="number"
                  min={-1}
                  max={23}
                  style={{ width: 70 }}
                  value={warpRotateHour}
                  onChange={(e) => setWarpRotateHour(parseInt(e.target.value, 10))}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={warpFailback} onChange={(e) => setWarpFailback(e.target.checked)} />
                Fall back to direct connection if the VPN fails
              </label>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
              Advanced settings are saved with "Save Settings" below.
            </div>
          </div>
        </details>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12 }}>Payment</h3>
        <div className="form-group">
          <label>M-Pesa Number (for manual payments)</label>
          <input className="input" placeholder="07XXXXXXXX" value={mpesaNumber} onChange={(e) => setMpesaNumber(e.target.value)} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Subscription managed via Paystack. Owners pay through the app.
        </div>
      </div>

      {status === 'error' && (
        <p style={{ color: '#e74c3c', fontSize: 14, marginBottom: 12 }}>Failed: {error}</p>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved ✓' : 'Save Settings'}
        </button>
        <button className="btn" onClick={handleRestart} disabled={restarting}>
          {restarting ? 'Restarting...' : 'Restart Hotspot'}
        </button>
      </div>
    </div>
  );
}
