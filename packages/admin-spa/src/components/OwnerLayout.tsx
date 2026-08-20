import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase, type UserRole } from '../lib/supabase';
import { api } from '../lib/api';

interface AuthState {
  role: UserRole;
  deviceId: string | null;
  email: string;
}

const links = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/clients', label: 'Clients', desktopOnly: true },
  { to: '/admin/vouchers', label: 'Vouchers', desktopOnly: true },
  { to: '/admin/plans', label: 'Plans', desktopOnly: true },
  { to: '/admin/revenue', label: 'Revenue', desktopOnly: true },
  { to: '/admin/settings', label: 'Settings' },
];

export default function OwnerLayout() {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [platform, setPlatform] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.device.getState()
      .then((s) => setPlatform(s.platform ?? ''))
      .catch(() => { /* desktop features stay visible if the API is unreachable */ });
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        navigate('/admin/login');
        return;
      }

      const { data: profile } = await supabase
        .from('admin_users')
        .select('role, device_id, email')
        .eq('id', session.user.id)
        .single();

      if (!profile) {
        navigate('/admin/login');
        return;
      }

      setAuth({
        role: profile.role as UserRole,
        deviceId: profile.device_id,
        email: profile.email,
      });
      localStorage.setItem('hotshare_role', profile.role);
      if (profile.device_id) {
        localStorage.setItem('hotshare_device_id', profile.device_id);
      }
      setLoading(false);
    };

    checkAuth();
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('hotshare_role');
    localStorage.removeItem('hotshare_device_id');
    navigate('/admin/login');
  };

  if (loading) {
    return (
      <div className="app">
        <div className="app-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>hotshare</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge">
            {auth?.role === 'super_admin' ? 'Super Admin' : 'Merchant'}
          </span>
          <button
            onClick={handleLogout}
            style={{
              background: 'none',
              border: '1px solid #334155',
              color: '#94a3b8',
              padding: '4px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Logout
          </button>
        </div>
      </header>
      <nav className="app-nav">
        {links
          .filter((l) => !(platform === 'android' && l.desktopOnly))
          .map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => isActive ? 'active' : ''}>
              {l.label}
            </NavLink>
          ))}
      </nav>
      <main className="app-content">
        <Outlet context={{ auth, platform }} />
      </main>
    </div>
  );
}
