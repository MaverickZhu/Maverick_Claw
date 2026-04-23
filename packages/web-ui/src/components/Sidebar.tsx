import { Layout, Menu, Typography, Avatar, Dropdown, Space } from 'antd';
import {
  MessageOutlined,
  DashboardOutlined,
  SettingOutlined,
  TeamOutlined,
  SafetyOutlined,
  FileSearchOutlined,
  LogoutOutlined,
  UserOutlined,
  AppstoreOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

const { Sider } = Layout;
const { Title, Text } = Typography;

function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, logout } = useAuthStore();

  const menuItems: MenuProps['items'] = [
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
    {
      key: '/plugins',
      icon: <AppstoreOutlined />,
      label: '插件',
    },
    {
      key: '/workflows',
      icon: <NodeIndexOutlined />,
      label: '工作流',
    },
  ];

  if (isAdmin) {
    menuItems.push(
      {
        type: 'divider',
      },
      {
        key: 'admin-group',
        icon: <SafetyOutlined />,
        label: '管理',
        children: [
          {
            key: '/admin/users',
            icon: <TeamOutlined />,
            label: '用户管理',
          },
          {
            key: '/admin/roles',
            icon: <SafetyOutlined />,
            label: '角色管理',
          },
          {
            key: '/admin/audit',
            icon: <FileSearchOutlined />,
            label: '审计日志',
          },
        ],
      }
    );
  }

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: () => {
        logout();
        navigate('/login');
      },
    },
  ];

  const selectedKeys = [location.pathname];
  const openKeys = location.pathname.startsWith('/admin') ? ['admin-group'] : [];

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
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '16px', textAlign: 'center' }}>
        <Title level={4} style={{ margin: 0, color: '#0ea5e9' }}>
          🦅 Maverick_Claw
        </Title>
      </div>

      <div style={{ flex: 1 }}>
        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </div>

      {user && (
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #f0f0f0',
          }}
        >
          <Dropdown menu={{ items: userMenuItems }} placement="topLeft">
            <Space style={{ cursor: 'pointer', width: '100%' }}>
              <Avatar icon={<UserOutlined />} size="small" />
              <div style={{ overflow: 'hidden' }}>
                <Text strong style={{ fontSize: 13, display: 'block' }}>
                  {user.name}
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {user.email || user.id}
                </Text>
              </div>
            </Space>
          </Dropdown>
        </div>
      )}
    </Sider>
  );
}

export default Sidebar;
