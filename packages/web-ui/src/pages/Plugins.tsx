import { useEffect, useState } from 'react';
import {
  Card,
  Tabs,
  List,
  Button,
  Tag,
  Space,
  Typography,
  Badge,
  message,
  Spin,
  Empty,
  Switch,
} from 'antd';
import {
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CloudDownloadOutlined,
  CheckCircleOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost } from '../api/client';

const { Text, Paragraph } = Typography;

interface MarketPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  permissions?: string[];
}

interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  source?: string;
  enabled: boolean;
}

function PluginsPage() {
  const [activeTab, setActiveTab] = useState('installed');
  const [marketPlugins, setMarketPlugins] = useState<MarketPlugin[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [updates, setUpdates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchInstalled = async () => {
    try {
      const data = await apiGet<{ plugins: InstalledPlugin[] }>('/api/plugins');
      setInstalledPlugins(data.plugins || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取已安装插件失败');
    }
  };

  const fetchMarket = async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ plugins: MarketPlugin[] }>('/api/market/plugins');
      setMarketPlugins(data.plugins || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取市场插件失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchUpdates = async () => {
    try {
      const data = await apiGet<{ updates: Array<{ id: string; latest: string }> }>('/api/plugins/updates');
      const map: Record<string, string> = {};
      data.updates?.forEach((u) => { map[u.id] = u.latest; });
      setUpdates(map);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchInstalled();
    fetchUpdates();
  }, []);

  useEffect(() => {
    if (activeTab === 'market') {
      fetchMarket();
    }
  }, [activeTab]);

  const handleInstall = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await apiPost('/api/plugins/install', { id });
      message.success(`插件 ${id} 安装成功`);
      fetchInstalled();
      fetchUpdates();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '安装失败');
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleUninstall = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await apiPost('/api/plugins/uninstall', { id });
      message.success(`插件 ${id} 已卸载`);
      fetchInstalled();
      fetchUpdates();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '卸载失败');
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleUpdate = async (id: string) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await apiPost('/api/plugins/update', { id });
      message.success(`插件 ${id} 更新成功`);
      fetchInstalled();
      fetchUpdates();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await apiPost(`/api/plugins/${id}/enable`, { enabled });
      message.success(enabled ? '插件已启用' : '插件已禁用');
      fetchInstalled();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const isInstalled = (id: string) => installedPlugins.some((p) => p.id === id);

  return (
    <div>
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <Tabs.TabPane
          tab={
            <span>
              <CheckCircleOutlined /> 已安装
              {installedPlugins.length > 0 && (
                <Badge count={installedPlugins.length} style={{ marginLeft: 4 }} />
              )}
            </span>
          }
          key="installed"
        >
          <Spin spinning={loading}>
            {installedPlugins.length === 0 ? (
              <Empty description="暂无已安装插件" />
            ) : (
              <List
                grid={{ gutter: 16, xs: 1, sm: 2, md: 3 }}
                dataSource={installedPlugins}
                renderItem={(plugin) => (
                  <List.Item>
                    <Card
                      title={plugin.name}
                      extra={<Tag color="green">v{plugin.version}</Tag>}
                      actions={[
                        <Switch
                          key="enable"
                          checked={plugin.enabled}
                          checkedChildren="启用"
                          unCheckedChildren="禁用"
                          onChange={(checked) => handleToggleEnabled(plugin.id, checked)}
                        />,
                        updates[plugin.id] && (
                          <Button
                            key="update"
                            size="small"
                            type="primary"
                            icon={<CloudDownloadOutlined />}
                            loading={actionLoading[plugin.id]}
                            onClick={() => handleUpdate(plugin.id)}
                          >
                            更新 v{updates[plugin.id]}
                          </Button>
                        ),
                        <Button
                          key="uninstall"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          loading={actionLoading[plugin.id]}
                          onClick={() => handleUninstall(plugin.id)}
                        >
                          卸载
                        </Button>,
                      ].filter(Boolean)}
                    >
                      <Paragraph type="secondary" ellipsis={{ rows: 2 }}>
                        {plugin.description || '无描述'}
                      </Paragraph>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        作者: {plugin.author || '未知'}
                      </Text>
                    </Card>
                  </List.Item>
                )}
              />
            )}
          </Spin>
        </Tabs.TabPane>

        <Tabs.TabPane
          tab={
            <span>
              <GlobalOutlined /> 插件市场
            </span>
          }
          key="market"
        >
          <Spin spinning={loading}>
            {marketPlugins.length === 0 ? (
              <Empty description="无法获取插件市场，请检查 registryUrl 配置" />
            ) : (
              <List
                grid={{ gutter: 16, xs: 1, sm: 2, md: 3 }}
                dataSource={marketPlugins}
                renderItem={(plugin) => (
                  <List.Item>
                    <Card
                      title={plugin.name}
                      extra={<Tag>v{plugin.version}</Tag>}
                      actions={[
                        isInstalled(plugin.id) ? (
                          <Button key="installed" size="small" disabled>
                            已安装
                          </Button>
                        ) : (
                          <Button
                            key="install"
                            size="small"
                            type="primary"
                            icon={<DownloadOutlined />}
                            loading={actionLoading[plugin.id]}
                            onClick={() => handleInstall(plugin.id)}
                          >
                            安装
                          </Button>
                        ),
                      ]}
                    >
                      <Paragraph type="secondary" ellipsis={{ rows: 2 }}>
                        {plugin.description || '无描述'}
                      </Paragraph>
                      <Space wrap style={{ marginTop: 8 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          作者: {plugin.author || '未知'}
                        </Text>
                        {plugin.permissions?.map((p) => (
                          <Tag key={p}>{p}</Tag>
                        ))}
                      </Space>
                    </Card>
                  </List.Item>
                )}
              />
            )}
          </Spin>
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
}

export default PluginsPage;
