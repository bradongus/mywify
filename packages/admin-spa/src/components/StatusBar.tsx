import type { DeviceState } from '../lib/types';

function tunnelStatus(state: DeviceState): { label: string; cls: string } {
  const h = state.tunnelHealth;
  if (!h || !state.uplinkGuardEnabled) return { label: 'OFF', cls: 'status-warn' };
  if (h.failedBack) return { label: 'FAILED BACK', cls: 'status-err' };
  if (h.degraded) return { label: 'DEGRADED', cls: 'status-warn' };
  if (h.connected) return { label: 'OK', cls: '' };
  return { label: 'OFF', cls: 'status-warn' };
}

export default function StatusBar({ state }: { state: DeviceState }) {
  const tunnel = tunnelStatus(state);
  return (
    <div className="card-grid">
      <div className="card card-stat">
        <div className={`value ${state.hotspotActive ? '' : 'status-err'}`}>
          {state.hotspotActive ? 'ON' : 'OFF'}
        </div>
        <div className="label">Hotspot</div>
      </div>
      <div className="card card-stat">
        <div className={`value ${state.internetOk ? '' : 'status-err'}`}>
          {state.internetOk ? 'OK' : 'DOWN'}
        </div>
        <div className="label">Internet</div>
      </div>
      <div className="card card-stat">
        <div className="value">{state.clientCount}</div>
        <div className="label">Clients ({state.maxClients} max)</div>
      </div>
      <div className="card card-stat">
        <div className={`value ${tunnel.cls}`}>{tunnel.label}</div>
        <div className="label">Protection</div>
      </div>
    </div>
  );
}
