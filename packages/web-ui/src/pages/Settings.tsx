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

interface ProviderInfo {
  providerId: string;
  providerName: string;
  models: string[];
  defaultModel: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  registered: boolean;
}

interface ChannelConfig {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface ChannelContractField {
  name: string;
  required: boolean;
  description: string;
}

interface ChannelContract {
  type: string;
  displayName: string;
  configFields: ChannelContractField[];
}

function SettingsPage() {
  const [modelForm] = Form.useForm();
  const [channelForm] = Form.useForm();
  const [systemForm] = Form.useForm();
  
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [systemConfig, setSystemConfig] = useState({ port: 31987, host: '127.0.0.1' });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [channelContracts, setChannelContracts] = useState<ChannelContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const channelType = (Form.useWatch('type', channelForm) as string | undefined) || 'webhook';
  const selectedProvider = Form.useWatch('provider', modelForm) as string | undefined;

  // Load configuration on mount
  useEffect(() => {
    fetchConfig();
  }, []);

  const isOllama = selectedProvider === 'ollama';
  const selectedProviderInfo = providers.find(p => p.providerId === selectedProvider);
  const providerModelOptions = selectedProviderInfo?.models || [];

  // Auto-fill baseUrl and clear fields when provider changes
  useEffect(() => {
    if (!editingModel && selectedProvider) {
      const isOllamaProvider = selectedProvider === 'ollama';
      modelForm.setFieldsValue({
        id: undefined,
        name: undefined,
        apiKey: undefined,
        baseUrl: isOllamaProvider ? 'http://localhost:11435' : undefined,
      });
    }
  }, [selectedProvider, editingModel, modelForm]);

  // Auto-fill display name when ollama model is selected
  const selectedModelId = Form.useWatch('id', modelForm) as string | undefined;
  useEffect(() => {
    if (isOllama && selectedModelId && !editingModel) {
      modelForm.setFieldsValue({
        name: selectedModelId,
      });
    }
  }, [selectedModelId, isOllama, editingModel, modelForm]);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const [configRes, providersRes, contractsRes] = await Promise.all([
        fetch('/api/config/full', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        }),
        fetch('/api/models/capabilities', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        }),
        fetch('/api/channels/contracts', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        }),
      ]);
      
      if (configRes.ok) {
        const data = await configRes.json();
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
      } else if (configRes.status === 401) {
        message.error('请先登录');
      }

      if (providersRes.ok) {
        const data = await providersRes.json();
        setProviders(data.providers || []);
      }

      if (contractsRes.ok) {
        const data = await contractsRes.json();
        setChannelContracts(data.contracts || []);
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

  const handleAddModel = async (values: { id: string; name: string; provider: string; apiKey?: string; baseUrl?: string }) => {
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

  const handleAddChannel = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const url = editingChannel 
        ? `/api/config/channels/${editingChannel}`
        : '/api/config/channels';

      const selectedType = (values.type as string) || 'webhook';
      const contract = channelContracts.find(c => c.type === selectedType);
      
      // Build config dynamically from contract configFields
      const config: Record<string, string> = {};
      if (contract) {
        for (const field of contract.configFields) {
          const value = values[field.name];
          if (typeof value === 'string' && value.trim().length > 0) {
            config[field.name] = value.trim();
          }
        }
      }

      const body = {
        id: values.id,
        name: values.name,
        type: selectedType,
        enabled: values.enabled,
        config,
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
    setEditingChannel(channel.id);
    const formValues: Record<string, unknown> = {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      enabled: channel.enabled,
    };
    // Map config fields dynamically
    const contract = channelContracts.find(c => c.type === channel.type);
    if (contract) {
      for (const field of contract.configFields) {
        formValues[field.name] = (channel.config?.[field.name] as string) || '';
      }
    }
    channelForm.setFieldsValue(formValues);
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
    { title: '类型', dataIndex: 'type', key: 'type', render: (type: string) => {
      const contract = channelContracts.find(c => c.type === type);
      return <Tag>{contract?.displayName || type}</Tag>;
    }},
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
                  {providers.map(p => (
                    <Option key={p.providerId} value={p.providerId}>
                      {p.providerName}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              {isOllama ? (
                <>
                  <Form.Item
                    label="本地模型"
                    name="id"
                    rules={[{ required: true, message: '请选择本地模型' }]}
                  >
                    <Select placeholder="选择已部署的本地模型" disabled={!!editingModel}>
                      {providerModelOptions.map(m => (
                        <Option key={m} value={m}>{m}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item
                    label="Base URL (可选)"
                    name="baseUrl"
                    initialValue="http://localhost:11435"
                  >
                    <Input placeholder="http://localhost:11435" />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item
                    label="模型 ID"
                    name="id"
                    rules={[{ required: true, message: '请输入模型 ID' }]}
                  >
                    <Input placeholder="例如：deepseek-chat" disabled={!!editingModel} />
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
                </>
              )}

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
                  {channelContracts.map(c => (
                    <Option key={c.type} value={c.type}>{c.displayName}</Option>
                  ))}
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

              {channelContracts.find(c => c.type === channelType)?.configFields.map(field => (
                <Form.Item
                  key={field.name}
                  label={`${field.name}${field.required ? '' : ' (可选)'}`}
                  name={field.name}
                  rules={field.required ? [{ required: true, message: `请输入 ${field.name}` }] : undefined}
                >
                  {field.name.toLowerCase().includes('password') || field.name.toLowerCase().includes('secret') ? (
                    <Input.Password placeholder={field.description} />
                  ) : (
                    <Input placeholder={field.description} />
                  )}
                </Form.Item>
              ))}

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
