import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api';
import type { ConnectedClient } from '../../lib/types';
import DesktopOnlyNotice from '../../components/DesktopOnlyNotice';

export default function Clients() {
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    api.clients.list().then(setClients).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleDisconnect = async (mac: string) => {
    await api.clients.disconnect(mac);
    refresh();
  };

  const handleBlock = async (mac: string) => {
    await api.clients.block(mac);
    refresh();
  };

  const { platform } = useOutletContext<{ platform?: string }>() ?? {};
  if (platform === 'android') return <DesktopOnlyNotice />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>Clients</h2>
        <button className="btn" onClick={refresh}>Refresh</button>
      </div>

      {loading ? (
        <div className="empty">Loading...</div>
      ) : clients.length === 0 ? (
        <div className="empty">
          <div className="icon">📡</div>
          <p>No clients connected</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>MAC</th>
                <th>IP</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.mac}>
                  <td style={{ fontFamily: 'monospace' }}>{c.mac}</td>
                  <td style={{ fontFamily: 'monospace' }}>{c.ip}</td>
                  <td>
                    <span className={`status ${c.paid ? 'status-ok' : 'status-err'}`}>
                      <span className="status-dot" />
                      {c.paid ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                  <td>{c.expiresAt ? new Date(c.expiresAt).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => handleDisconnect(c.mac)}>Disconnect</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleBlock(c.mac)} style={{ marginLeft: 4 }}>Block</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 13 }}>
        {clients.filter(c => c.paid).length} paid / {clients.length} total
      </div>
    </div>
  );
}
