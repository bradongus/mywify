import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError('');

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      if (data.user) {
        const { data: profile } = await supabase
          .from('admin_users')
          .select('role, device_id')
          .eq('id', data.user.id)
          .maybeSingle();

        if (!profile) {
          setError('Account not found. Please sign up first.');
          return;
        }

        localStorage.setItem('hotshare_role', profile.role);
        if (profile.device_id) {
          localStorage.setItem('hotshare_device_id', profile.device_id);
        }
        navigate('/admin');
      }
    } catch {
      setError('Login failed');
    }
    setLoading(false);
  };

  return (
    <div className="portal">
      <div className="portal-card">
        <h1>hotshare</h1>
        <p className="subtitle">Admin login</p>

        <div className="form-group">
          <label>Email</label>
          <input
            className="input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Password</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
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
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>

        {error && (
          <div className="sub-banner sub-expired" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 14 }}>
          Don&apos;t have an account?{' '}
          <Link to="/admin/signup" style={{ color: '#4ade80' }}>
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
