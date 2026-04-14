import { Layout, Menu, Typography } from 'antd';
import {
  MessageOutlined,
  DashboardOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';

const { Sider } = Layout;
const { Title } = Typography;

const menuItems = [
  {
    key: '/',
    icon: <MessageOutlined />,
    label: '聊天',
  },
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: '仪表板',
  },
  {
    key: '/settings',
    icon: <SettingOutlined />,
    label: '设置',
  },
];

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Sider
      theme="light"
      style={{
        overflow: 'auto',
        height: '100vh',
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
      }}
    >
      <div style={{ padding: '16px', textAlign: 'center' }}>
        <Title level={4} style={{ margin: 0, color: '#0ea5e9' }}>
          🦅 Maverick_Claw
        </Title>
      </div>
      <Menu
        mode="inline"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
      />
    </Sider>
  );
}

export default Sidebar;
