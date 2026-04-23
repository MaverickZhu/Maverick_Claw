import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Layout } from 'antd';
import { useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/Chat';
import DashboardPage from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import LoginPage from './pages/Login';
import PluginsPage from './pages/Plugins';
import WorkflowsPage from './pages/Workflows';
import UsersPage from './pages/admin/Users';
import RolesPage from './pages/admin/Roles';
import AuditPage from './pages/admin/Audit';
import './styles/App.css';
import { useAuthStore, fetchUserInfo } from './stores/auth';

const { Content } = Layout;

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated && location.pathname !== '/login') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isAdmin } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout className="app-layout">
      <Sidebar />
      <Layout className="main-layout">
        <Content className="main-content">{children}</Content>
      </Layout>
    </Layout>
  );
}

function App() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';
  const { isAuthenticated, setToken, setUser, logout } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) {
      const token = localStorage.getItem('token');
      // Only attempt restore if token looks valid (mc_ prefix + 32 bytes base64url)
      if (token && token.startsWith('mc_') && token.length > 20) {
        fetchUserInfo().then((user) => {
          if (user) {
            setToken(token);
            setUser(user);
          } else {
            logout();
          }
        });
      } else if (token) {
        // Clear invalid token immediately without making a request
        logout();
      }
    }
  }, [isAuthenticated, setToken, setUser, logout]);

  return (
    <>
      {isLoginPage ? (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      ) : (
        <AppLayout>
          <Routes>
            <Route
              path="/"
              element={
                <AuthGuard>
                  <ChatPage />
                </AuthGuard>
              }
            />
            <Route
              path="/dashboard"
              element={
                <AuthGuard>
                  <DashboardPage />
                </AuthGuard>
              }
            />
            <Route
              path="/settings"
              element={
                <AuthGuard>
                  <SettingsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/plugins"
              element={
                <AuthGuard>
                  <PluginsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/workflows"
              element={
                <AuthGuard>
                  <WorkflowsPage />
                </AuthGuard>
              }
            />
            <Route
              path="/admin/users"
              element={
                <AdminGuard>
                  <UsersPage />
                </AdminGuard>
              }
            />
            <Route
              path="/admin/roles"
              element={
                <AdminGuard>
                  <RolesPage />
                </AdminGuard>
              }
            />
            <Route
              path="/admin/audit"
              element={
                <AdminGuard>
                  <AuditPage />
                </AdminGuard>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppLayout>
      )}
    </>
  );
}

export default App;
