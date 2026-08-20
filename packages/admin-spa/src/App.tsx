import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import Portal from './pages/guest/Portal';
import Login from './pages/owner/Login';
import Signup from './pages/owner/Signup';
import OwnerLayout from './components/OwnerLayout';
import Dashboard from './pages/owner/Dashboard';
import Clients from './pages/owner/Clients';
import Vouchers from './pages/owner/Vouchers';
import Plans from './pages/owner/Plans';
import Revenue from './pages/owner/Revenue';
import Settings from './pages/owner/Settings';

function AutoRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const host = window.location.hostname;
    const isLocalhost = host === '127.0.0.1' || host === 'localhost' || host === '::1';

    if (isLocalhost && location.pathname === '/') {
      navigate('/admin', { replace: true });
    }
  }, [location.pathname, navigate]);

  return null;
}

export default function App() {
  return (
    <>
      <AutoRedirect />
      <Routes>
        <Route path="/" element={<Portal />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin/signup" element={<Signup />} />
        <Route path="/admin" element={<OwnerLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="clients" element={<Clients />} />
          <Route path="vouchers" element={<Vouchers />} />
          <Route path="plans" element={<Plans />} />
          <Route path="revenue" element={<Revenue />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </>
  );
}
