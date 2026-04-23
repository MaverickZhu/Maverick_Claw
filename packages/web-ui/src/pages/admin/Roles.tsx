import { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { apiGet, apiPost, apiPut, apiDelete } from '../../api/client';

interface Role {
  id: string;
  name: string;
  scopes: string[];
  isBuiltin: boolean;
}

const ALL_SCOPES = [
  'sessions:read',
  'sessions:write',
  'messages:read',
  'messages:write',
  'chat:stream',
  'workflow:read',
  'workflow:run',
  'models:read',
  'channels:read',
  'config:read',
  'config:write',
  'queue:read',
  'queue:write',
  'plugins:read',
  'plugins:write',
];

function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [form] = Form.useForm();

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ roles: Role[] }>('/api/roles');
      setRoles(data.roles || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取角色失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleCreate = () => {
    setEditingRole(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (role: Role) => {
    if (role.isBuiltin) {
      message.warning('内置角色不可编辑');
      return;
    }
    setEditingRole(role);
    form.setFieldsValue({
      name: role.name,
      scopes: role.scopes,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string, isBuiltin: boolean) => {
    if (isBuiltin) {
      message.warning('内置角色不可删除');
      return;
    }
    try {
      await apiDelete(`/api/roles/${id}`);
      message.success('角色已删除');
      fetchRoles();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleSubmit = async (values: { name: string; scopes: string[] }) => {
    try {
      if (editingRole) {
        await apiPut(`/api/roles/${editingRole.id}`, values);
        message.success('角色已更新');
      } else {
        await apiPost('/api/roles', values);
        message.success('角色已创建');
      }
      setModalOpen(false);
      fetchRoles();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', ellipsis: true },
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '权限',
      dataIndex: 'scopes',
      key: 'scopes',
      render: (scopes: string[]) => (
        <Space wrap>
          {scopes.map((s) => (
            <Tag key={s} color={s === '*' ? 'red' : 'blue'}>
              {s}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'isBuiltin',
      key: 'isBuiltin',
      render: (isBuiltin: boolean) =>
        isBuiltin ? <Tag color="orange">内置</Tag> : <Tag>自定义</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Role) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleEdit(record)}
            disabled={record.isBuiltin}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除？"
            onConfirm={() => handleDelete(record.id, record.isBuiltin)}
          >
            <Button icon={<DeleteOutlined />} size="small" danger disabled={record.isBuiltin}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="角色管理"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建角色
          </Button>
        }
      >
        <Table
          dataSource={roles}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editingRole ? '编辑角色' : '新建角色'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="权限" name="scopes">
            <Select mode="multiple" placeholder="选择权限">
              {ALL_SCOPES.map((s) => (
                <Select.Option key={s} value={s}>
                  {s}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default RolesPage;
