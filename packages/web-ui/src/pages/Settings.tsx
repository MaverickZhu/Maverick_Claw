import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, Select, Switch, Tabs, Table, Tag, Space, message, Divider, Popconfirm, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, CopyOutlined, ReloadOutlined } from '@ant-design/icons';

const { TabPane } = Tabs;
const { Option } = Select;

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
}

interface ChannelConfig {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

type ChannelTypeValue = 'webhook' | 'lark' | 'dingtalk';

interface ChannelFormValues {
  id: string;
  name: string;
  type: ChannelTypeValue;
  enabled: boolean;
  secret?: string;
  verificationToken?: string;
  appId?: string;
  appSecret?: string;
  botWebhookUrl?: string;
  botWebhookSecret?: string;
  dingtalkVerificationToken?: string;
  dingtalkWebhookUrl?: string;
  dingtalkSecret?: string;
}

function SettingsPage() {
  const [modelForm] = Form.useForm();
  const [channelForm] = Form.useForm();
  const [systemForm] = Form.useForm();
  
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [systemConfig, setSystemConfig] = useState({ port: 31987, host: '127.0.0.1' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const channelType = (Form.useWatch('type', channelForm) as ChannelTypeValue | undefined) || 'webhook';

  // Load configuration on mount
  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/config/full', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const config = data.config;
        
        // Set form values
        systemForm.setFieldsValue({
          port: config.port,
          host: config.host,
        });
        setSystemConfig({ port: config.port, host: config.host });
        
        if (config.models) {
          setModels(config.models);
          setDefaultModelId(config.defaultModel || null);
        }
        if (config.channels) {
          setChannels(config.channels);
        }
      } else if (response.status === 401) {
        message.error('请先登录');
      }
    } catch (_error) {
      console.error('Failed to load config:', _error);
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const getModelRef = (model: Pick<ModelConfig, 'provider' | 'id'>): string => {
    return `${model.provider}:${model.id}`;
  };

  const compactStringConfig = (input: Record<string, string | undefined>): Record<string, string> => {
    const entries = Object.entries(input).reduce<Array<readonly [string, string]>>((acc, [key, value]) => {
      if (typeof value === 'string' && value.trim().length > 0) {
        acc.push([key, value.trim()]);
      }
      return acc;
    }, []);
    return Object.fromEntries(entries);
  };

  const handleSaveSystem = async (values: { port: number; host: string }) => {
    setSaving(true);
    try {
      const response = await fetch('/api/config/system', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify(values)
      });
      
      if (response.ok) {
        message.success('系统设置已保存，重启后生效');
      } else {
        const error = await response.json();
        message.error(error.error || '保存失败');
      }
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAddModel = async (values: { id: string; name: string; provider: string; apiKey: string; baseUrl?: string }) => {
    setSaving(true);
    try {
      const url = editingModel 
        ? `/api/config/models/${editingModel}`
        : '/api/config/models';
      
      const response = await fetch(url, {
        method: editingModel ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify(values)
      });
      
      if (response.ok) {
        await fetchConfig(); // Refresh list
        modelForm.resetFields();
        setEditingModel(null);
        message.success(editingModel ? '模型已更新' : '模型已添加');
      } else {
        const error = await response.json();
        message.error(error.error || '操作失败');
      }
    } catch {
      message.error('操作失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteModel = async (id: string) => {
    try {
      const response = await fetch(`/api/config/models/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });
      
      if (response.ok) {
        await fetchConfig();
        message.success('模型已删除');
      } else {
        const error = await response.json();
        message.error(error.error || '删除失败');
      }
    } catch {
      message.error('删除失败');
    }
  };

  const handleEditModel = (model: ModelConfig) => {
    setEditingModel(model.id);
    modelForm.setFieldsValue({
      id: model.id,
      name: model.name,
      provider: model.provider,
      apiKey: model.apiKey || '',
      baseUrl: model.baseUrl || '',
    });
  };

  const handleToggleModel = async (model: ModelConfig) => {
    try {
      const response = await fetch(`/api/config/models/${model.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ enabled: !model.enabled })
      });
      
      if (response.ok) {
        await fetchConfig();
        message.success(model.enabled ? '模型已禁用' : '模型已启用');
      }
    } catch {
      message.error('操作失败');
    }
  };

  const handleSetDefaultModel = async (model: ModelConfig) => {
    if (!model.enabled) {
      message.warning('请先启用该模型，再设为默认');
      return;
    }

    try {
      const response = await fetch('/api/config/models/default', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ modelId: getModelRef(model) })
      });

      if (response.ok) {
        await fetchConfig();
        message.success('默认模型已更新');
      } else {
        const error = await response.json();
        message.error(error.error || '设置默认模型失败');
      }
    } catch {
      message.error('设置默认模型失败');
    }
  };

  const handleAddChannel = async (values: ChannelFormValues) => {
    setSaving(true);
    try {
      const url = editingChannel 
        ? `/api/config/channels/${editingChannel}`
        : '/api/config/channels';

      const selectedType: ChannelTypeValue = values.type || 'webhook';
      const channelSpecificConfig =
        selectedType === 'lark'
          ? compactStringConfig({
              verificationToken: values.verificationToken,
              appId: values.appId,
              appSecret: values.appSecret,
              botWebhookUrl: values.botWebhookUrl,
              botWebhookSecret: values.botWebhookSecret,
            })
          : selectedType === 'dingtalk'
            ? compactStringConfig({
                verificationToken: values.dingtalkVerificationToken,
                outgoingWebhookUrl: values.dingtalkWebhookUrl,
                outgoingSecret: values.dingtalkSecret,
              })
            : compactStringConfig({
                secret: values.secret,
              });

      const body = {
        id: values.id,
        name: values.name,
        type: selectedType,
        enabled: values.enabled,
        config: channelSpecificConfig,
      };
      
      const response = await fetch(url, {
        method: editingChannel ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify(body)
      });
      
      if (response.ok) {
        await fetchConfig();
        channelForm.resetFields();
        channelForm.setFieldsValue({ type: 'webhook', enabled: true });
        setEditingChannel(null);
        message.success(editingChannel ? '渠道已更新' : '渠道已添加');
      } else {
        const error = await response.json();
        message.error(error.error || '操作失败');
      }
    } catch {
      message.error('操作失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    try {
      const response = await fetch(`/api/config/channels/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });
      
      if (response.ok) {
        await fetchConfig();
        message.success('渠道已删除');
      } else {
        const error = await response.json();
        message.error(error.error || '删除失败');
      }
    } catch {
      message.error('删除失败');
    }
  };

  const handleEditChannel = (channel: ChannelConfig) => {
    const selectedType: ChannelTypeValue =
      channel.type === 'lark' ? 'lark' : channel.type === 'dingtalk' ? 'dingtalk' : 'webhook';
    setEditingChannel(channel.id);
    channelForm.setFieldsValue({
      id: channel.id,
      name: channel.name,
      type: selectedType,
      secret: (channel.config?.secret as string) || '',
      verificationToken: (channel.config?.verificationToken as string) || '',
      appId: (channel.config?.appId as string) || '',
      appSecret: (channel.config?.appSecret as string) || '',
      botWebhookUrl: (channel.config?.botWebhookUrl as string) || '',
      botWebhookSecret: (channel.config?.botWebhookSecret as string) || '',
      dingtalkVerificationToken: (channel.config?.verificationToken as string) || '',
      dingtalkWebhookUrl:
        (channel.config?.outgoingWebhookUrl as string) || (channel.config?.webhookUrl as string) || '',
      dingtalkSecret: (channel.config?.outgoingSecret as string) || (channel.config?.secret as string) || '',
      enabled: channel.enabled,
    });
  };

  const handleToggleChannel = async (channel: ChannelConfig) => {
    try {
      const response = await fetch(`/api/config/channels/${channel.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ enabled: !channel.enabled })
      });
      
      if (response.ok) {
        await fetchConfig();
        message.success(channel.enabled ? '渠道已禁用' : '渠道已启用');
      }
    } catch {
      message.error('操作失败');
    }
  };

  const copyWebhookUrl = (channelId: string) => {
    const url = `${window.location.origin}/api/webhooks/${channelId}`;
    navigator.clipboard.writeText(url);
    message.success('Webhook URL 已复制');
  };

  const modelColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '提供者', dataIndex: 'provider', key: 'provider', render: (p: string) => (
      <Tag>{p}</Tag>
    )},
    {
      title: '默认',
      key: 'default',
      render: (_: unknown, record: ModelConfig) =>
        getModelRef(record) === defaultModelId ? <Tag color="green">默认</Tag> : '-',
    },
    { title: '状态', dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean, record: ModelConfig) => (
      <Switch checked={enabled} onChange={() => handleToggleModel(record)} />
    )},
    { title: '操作', key: 'action', render: (_: unknown, record: ModelConfig) => (
      <Space>
        <Button
          size="small"
          onClick={() => handleSetDefaultModel(record)}
          disabled={!record.enabled || getModelRef(record) === defaultModelId}
        >
          设为默认
        </Button>
        <Button icon={<EditOutlined />} size="small" onClick={() => handleEditModel(record)}>编辑</Button>
        <Popconfirm title="确定删除此模型？" onConfirm={() => handleDeleteModel(record.id)}>
          <Button icon={<DeleteOutlined />} size="small" danger>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  const channelColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (type: string) => (
      <Tag>{type === 'lark' ? '飞书' : type === 'dingtalk' ? '钉钉' : 'Webhook'}</Tag>
    )},
    { title: '状态', dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean, record: ChannelConfig) => (
      <Switch checked={enabled} onChange={() => handleToggleChannel(record)} />
    )},
    { title: '回调 URL', key: 'webhookUrl', render: (_: unknown, record: ChannelConfig) => (
      <Space>
        <code style={{ fontSize: '12px' }}>/api/webhooks/{record.id}</code>
        <Button icon={<CopyOutlined />} size="small" onClick={() => copyWebhookUrl(record.id)}>复制</Button>
      </Space>
    )},
    { title: '操作', key: 'action', render: (_: unknown, record: ChannelConfig) => (
      <Space>
        <Button icon={<EditOutlined />} size="small" onClick={() => handleEditChannel(record)}>编辑</Button>
        <Popconfirm title="确定删除此渠道？" onConfirm={() => handleDeleteChannel(record.id)}>
          <Button icon={<DeleteOutlined />} size="small" danger>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <div>
      <h1 style={{ marginBottom: '24px' }}>设置</h1>

      <Tabs defaultActiveKey="models">
        <TabPane tab="模型配置" key="models">
          <Card 
            title="已配置模型" 
            extra={<Button icon={<ReloadOutlined />} onClick={fetchConfig} loading={loading}>刷新</Button>}
          >
            <Table dataSource={models} columns={modelColumns} rowKey="id" pagination={false} loading={loading} />
          </Card>

          <Card title={editingModel ? '编辑模型' : '添加模型'} style={{ marginTop: '16px' }}>
            <Form form={modelForm} layout="vertical" onFinish={handleAddModel}>
              <Form.Item
                label="模型 ID"
                name="id"
                rules={[{ required: true, message: '请输入模型 ID' }]}
              >
                <Input placeholder="例如：deepseek-chat" disabled={!!editingModel} />
              </Form.Item>

              <Form.Item
                label="显示名称"
                name="name"
                rules={[{ required: true, message: '请输入显示名称' }]}
              >
                <Input placeholder="例如：DeepSeek Chat" />
              </Form.Item>

              <Form.Item
                label="提供者"
                name="provider"
                rules={[{ required: true, message: '请选择提供者' }]}
              >
                <Select placeholder="选择模型提供者">
                  <Option value="deepseek">DeepSeek</Option>
                  <Option value="kimi">Kimi (Moonshot)</Option>
                  <Option value="openai">OpenAI</Option>
                </Select>
              </Form.Item>

              <Form.Item
                label="API Key"
                name="apiKey"
                rules={[{ required: true, message: '请输入 API Key' }]}
              >
                <Input.Password placeholder="sk-..." />
              </Form.Item>

              <Form.Item
                label="Base URL (可选)"
                name="baseUrl"
              >
                <Input placeholder="https://api.example.com" />
              </Form.Item>

              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<PlusOutlined />}>
                    {editingModel ? '更新模型' : '添加模型'}
                  </Button>
                  {editingModel && (
                    <Button onClick={() => { setEditingModel(null); modelForm.resetFields(); }}>
                      取消
                    </Button>
                  )}
                </Space>
              </Form.Item>
            </Form>
          </Card>
        </TabPane>

        <TabPane tab="渠道配置" key="channels">
          <Card 
            title="已配置渠道"
            extra={<Button icon={<ReloadOutlined />} onClick={fetchConfig} loading={loading}>刷新</Button>}
          >
            <Table dataSource={channels} columns={channelColumns} rowKey="id" pagination={false} loading={loading} />
          </Card>

          <Card title={editingChannel ? '编辑渠道' : '添加渠道'} style={{ marginTop: '16px' }}>
            <Form form={channelForm} layout="vertical" onFinish={handleAddChannel}>
              <Form.Item
                label="渠道类型"
                name="type"
                rules={[{ required: true, message: '请选择渠道类型' }]}
                initialValue="webhook"
              >
                <Select disabled={!!editingChannel}>
                  <Option value="webhook">Webhook</Option>
                  <Option value="lark">飞书</Option>
                  <Option value="dingtalk">钉钉</Option>
                </Select>
              </Form.Item>

              <Form.Item
                label="渠道 ID"
                name="id"
                rules={[{ required: true, message: '请输入渠道 ID' }]}
              >
                <Input placeholder="例如：my-webhook" disabled={!!editingChannel} />
              </Form.Item>

              <Form.Item
                label="渠道名称"
                name="name"
                rules={[{ required: true, message: '请输入渠道名称' }]}
              >
                <Input placeholder="例如：测试 Webhook" />
              </Form.Item>

              {channelType === 'webhook' && (
                <Form.Item
                  label="Secret (可选)"
                  name="secret"
                >
                  <Input.Password placeholder="用于验证 Webhook 签名" />
                </Form.Item>
              )}

              {channelType === 'lark' && (
                <>
                  <Form.Item label="Verification Token (可选)" name="verificationToken">
                    <Input placeholder="用于飞书 URL 验证" />
                  </Form.Item>
                  <Form.Item label="App ID (可选)" name="appId">
                    <Input placeholder="cli_xxx（用于通过飞书开放接口回消息）" />
                  </Form.Item>
                  <Form.Item label="App Secret (可选)" name="appSecret">
                    <Input.Password placeholder="用于获取 tenant_access_token" />
                  </Form.Item>
                  <Form.Item label="Bot Webhook URL (可选)" name="botWebhookUrl">
                    <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
                  </Form.Item>
                  <Form.Item label="Bot Webhook Secret (可选)" name="botWebhookSecret">
                    <Input.Password placeholder="飞书自定义机器人签名密钥" />
                  </Form.Item>
                </>
              )}

              {channelType === 'dingtalk' && (
                <>
                  <Form.Item label="Verification Token (可选)" name="dingtalkVerificationToken">
                    <Input placeholder="用于钉钉回调验证（如启用）" />
                  </Form.Item>
                  <Form.Item label="Outgoing Webhook URL (可选)" name="dingtalkWebhookUrl">
                    <Input placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
                  </Form.Item>
                  <Form.Item label="Outgoing Secret (可选)" name="dingtalkSecret">
                    <Input.Password placeholder="钉钉机器人加签密钥 SEC..." />
                  </Form.Item>
                </>
              )}

              <Form.Item
                label="启用"
                name="enabled"
                valuePropName="checked"
                initialValue={true}
              >
                <Switch />
              </Form.Item>

              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<PlusOutlined />}>
                    {editingChannel ? '更新渠道' : '添加渠道'}
                  </Button>
                  {editingChannel && (
                    <Button
                      onClick={() => {
                        setEditingChannel(null);
                        channelForm.resetFields();
                        channelForm.setFieldsValue({ type: 'webhook', enabled: true });
                      }}
                    >
                      取消
                    </Button>
                  )}
                </Space>
              </Form.Item>
            </Form>
          </Card>

          <Divider />

          <Card title="Webhook 使用说明" size="small">
            <p>1. 添加渠道后，系统会生成统一回调地址：<code>{'{baseUrl}'}/api/webhooks/{'{channelId}'}</code></p>
            <p>2. Webhook 渠道请求体示例：<code>{`{"userId":"user-123","content":"消息内容"}`}</code></p>
            <p>3. 飞书事件订阅可直接指向该地址；URL 验证请求会自动返回 <code>challenge</code></p>
            <p>4. 飞书回消息优先使用 App 凭据（<code>appId/appSecret</code>），未配置时可回退到 Bot Webhook</p>
            <p>5. 钉钉可配置 Outgoing Webhook URL + Secret，用于机器人回消息与签名</p>
          </Card>
        </TabPane>

        <TabPane tab="系统设置" key="system">
          <Alert 
            message="系统设置修改后需要重启服务才能生效" 
            type="info" 
            showIcon 
            style={{ marginBottom: '16px' }}
          />
          
          <Card>
            <Form form={systemForm} layout="vertical" onFinish={handleSaveSystem}>
              <Form.Item label="端口" name="port" rules={[{ required: true }]}>
                <Input type="number" />
              </Form.Item>

              <Form.Item label="主机" name="host" rules={[{ required: true }]}>
                <Input />
              </Form.Item>

              <Form.Item>
                <Button type="primary" htmlType="submit" loading={saving}>保存设置</Button>
              </Form.Item>
            </Form>
          </Card>

          <Card title="配置信息" style={{ marginTop: '16px' }} size="small">
            <p><strong>配置文件路径：</strong> <code>~/.maverick-claw/config.json5</code></p>
            <p><strong>当前端口：</strong> {systemConfig.port}</p>
            <p><strong>当前主机：</strong> {systemConfig.host}</p>
          </Card>
        </TabPane>
      </Tabs>
    </div>
  );
}

export default SettingsPage;
