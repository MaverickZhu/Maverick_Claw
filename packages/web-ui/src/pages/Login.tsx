import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Form,
  Input,
  Button,
  Tabs,
  Typography,
  Alert,
  Divider,
  Space,
  message,
} from 'antd';
import { LoginOutlined, SafetyOutlined } from '@ant-design/icons';
import { useAuthStore, fetchUserInfo } from '../stores/auth';

const { Title, Text } = Typography;

interface AuthProvider {
  id: string;
  name: string;
  type: string;
}

function Login() {
  const navigate = useNavigate();
  const { token, setToken, setUser, isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [activeTab, setActiveTab] = useState('local');

  useEffect(() => {
    // Fetch auth providers
    fetch('/api/auth/providers')
      .then((r) => r.json())
      .then((data) => {
        if (data.providers) {
          setProviders(data.providers);
        }
      })
      .catch(() => {
        // ignore
      });
  }, []);

  useEffect(() => {
    if (isAuthenticated && token) {
      fetchUserInfo().then((user) => {
        if (user) {
          setUser(user);
          navigate('/');
        } else {
          useAuthStore.getState().logout();
        }
      });
    }
  }, [isAuthenticated, token, navigate, setUser]);

  const handleLocalLogin = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || data.message || '登录失败');
        return;
      }
      if (data.token) {
        setToken(data.token);
        localStorage.setItem('token', data.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = (providerId: string) => {
    window.location.href = `/api/auth/oauth/${providerId}`;
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
      }}
    >
      <Card style={{ width: 420, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0, color: '#0ea5e9' }}>
            🦅 Maverick_Claw
          </Title>
          <Text type="secondary">AI 助手网关</Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            closable
            onClose={() => setError(null)}
          />
        )}

        <Tabs activeKey={activeTab} onChange={setActiveTab} centered>
          <Tabs.TabPane tab="账号登录" key="local">
            <Form layout="vertical" onFinish={handleLocalLogin}>
              <Form.Item
                label="邮箱"
                name="email"
                rules={[{ required: true, message: '请输入邮箱' }]}
              >
                <Input placeholder="admin@local" />
              </Form.Item>
              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password placeholder="密码" />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                icon={<LoginOutlined />}
                block
                size="large"
              >
                登录
              </Button>
            </Form>
          </Tabs.TabPane>

          {providers.length > 0 && (
            <Tabs.TabPane tab="SSO 登录" key="sso">
              <Space direction="vertical" style={{ width: '100%' }}>
                {providers.map((p) => (
                  <Button
                    key={p.id}
                    block
                    size="large"
                    icon={<SafetyOutlined />}
                    onClick={() => handleOAuthLogin(p.id)}
                  >
                    通过 {p.name} 登录
                  </Button>
                ))}
              </Space>
            </Tabs.TabPane>
          )}
        </Tabs>

        <Divider />

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            本地/自托管多通道 AI 助手网关
          </Text>
        </div>
      </Card>
    </div>
  );
}

export default Login;
