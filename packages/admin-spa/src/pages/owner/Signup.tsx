import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.device.getInfo().then((d) => {
      setDeviceId(d.deviceId);
    }).catch(() => {
      setDeviceId('dev-preview-device');
    });
  }, []);

  const handleSignup = async () => {
    if (!email || !password || !deviceId) return;
    setLoading(true);
    setError('');

    try {
      let userId: string;

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) {
            setError('Account exists but login failed. Try logging in.');
            return;
          }
          userId = signInData.user.id;
        } else {
          setError(authError.message);
          return;
        }
      } else if (data.user) {
        userId = data.user.id;
      } else {
        setError('Signup failed');
        return;
      }

      const { error: insertError } = await supabase
        .from('admin_users')
        .upsert({
          id: userId,
          email,
          role: 'merchant',
          device_id: deviceId,
        }, { onConflict: 'id' });

      if (insertError) {
        setError('Failed to create account: ' + insertError.message);
        return;
      }

      localStorage.setItem('hotshare_role', 'merchant');
      localStorage.setItem('hotshare_device_id', deviceId);
      navigate('/admin');
    } catch {
      setError('Signup failed');
    }
    setLoading(false);
  };

  return (
    <div className="portal">
      <div className="portal-card">
        <h1>hotshare</h1>
        <p className="subtitle">Create merchant account</p>

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
              placeholder="Choose a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSignup()}
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
          onClick={handleSignup}
          disabled={loading || !deviceId}
        >
          {loading ? 'Creating...' : 'Create account'}
        </button>

        {error && (
          <div className="sub-banner sub-expired" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 14 }}>
          Already have an account?{' '}
          <Link to="/admin/login" style={{ color: '#4ade80' }}>
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}
