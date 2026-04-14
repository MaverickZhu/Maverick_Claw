import { Routes, Route } from 'react-router-dom';
import { Layout } from 'antd';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/Chat';
import DashboardPage from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import './styles/App.css';

const { Content } = Layout;

function App() {
  return (
    <Layout className="app-layout">
      <Sidebar />
      <Layout className="main-layout">
        <Content className="main-content">
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
