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
  message,
  Popconfirm,
  Typography,
  Descriptions,
  Tabs,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client';

const { TextArea } = Input;
const { Paragraph } = Typography;

interface Workflow {
  id: string;
  name: string;
  description?: string;
  definition: Record<string, unknown>;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [runResult, setRunResult] = useState<object | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [form] = Form.useForm();
  const [runForm] = Form.useForm();

  const fetchWorkflows = async () => {
    setLoading(true);
    try {
      const data = await apiGet<{ workflows: Workflow[] }>('/api/workflows');
      setWorkflows(data.workflows || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取工作流失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const handleCreate = () => {
    setEditingWorkflow(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (wf: Workflow) => {
    if (wf.isBuiltin) {
      message.warning('内置工作流不可编辑');
      return;
    }
    setEditingWorkflow(wf);
    form.setFieldsValue({
      name: wf.name,
      description: wf.description,
      definition: JSON.stringify(wf.definition, null, 2),
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string, isBuiltin: boolean) => {
    if (isBuiltin) {
      message.warning('内置工作流不可删除');
      return;
    }
    try {
      await apiDelete(`/api/workflows/${id}`);
      message.success('工作流已删除');
      fetchWorkflows();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleSubmit = async (values: {
    name: string;
    description?: string;
    definition: string;
  }) => {
    try {
      const body = {
        name: values.name,
        description: values.description,
        definition: JSON.parse(values.definition),
      };
      if (editingWorkflow) {
        await apiPut(`/api/workflows/${editingWorkflow.id}`, body);
        message.success('工作流已更新');
      } else {
        await apiPost('/api/workflows', body);
        message.success('工作流已创建');
      }
      setModalOpen(false);
      fetchWorkflows();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败，请检查 JSON 格式');
    }
  };

  const handleRun = (wf: Workflow) => {
    setSelectedWorkflow(wf);
    setRunResult(null);
    runForm.resetFields();
    setRunModalOpen(true);
  };

  const handleRunSubmit = async (values: { params?: string }) => {
    if (!selectedWorkflow) return;
    setRunLoading(true);
    try {
      const params = values.params ? JSON.parse(values.params) : {};
      const data = await apiPost<{
        sessionId: string;
        success: boolean;
        executionTime: number;
        completedNodes: number;
        failedNodes: number;
      }>(`/api/workflows/${selectedWorkflow.id}/run`, { params });
      setRunResult(data);
      message.success('工作流执行成功');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '执行失败');
    } finally {
      setRunLoading(false);
    }
  };

  const handleViewDetail = (wf: Workflow) => {
    setSelectedWorkflow(wf);
    setDetailModalOpen(true);
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (d?: string) => d || '-',
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
      width: 280,
      render: (_: unknown, record: Workflow) => (
        <Space>
          <Button
            icon={<PlayCircleOutlined />}
            size="small"
            type="primary"
            onClick={() => handleRun(record)}
          >
            执行
          </Button>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleEdit(record)}
            disabled={record.isBuiltin}
          >
            编辑
          </Button>
          <Button
            icon={<CopyOutlined />}
            size="small"
            onClick={() => handleViewDetail(record)}
          >
            详情
          </Button>
          <Popconfirm
            title="确认删除？"
            onConfirm={() => handleDelete(record.id, record.isBuiltin)}
          >
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
              disabled={record.isBuiltin}
            >
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
        title="工作流管理"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建工作流
          </Button>
        }
      >
        <Table
          dataSource={workflows}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editingWorkflow ? '编辑工作流' : '新建工作流'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        width={700}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input />
          </Form.Item>
          <Form.Item
            label="定义 (JSON)"
            name="definition"
            rules={[{ required: true }]}
            extra="工作流执行计划，JSON 格式"
          >
            <TextArea rows={12} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Run Modal */}
      <Modal
        title={`执行工作流: ${selectedWorkflow?.name}`}
        open={runModalOpen}
        onCancel={() => setRunModalOpen(false)}
        onOk={() => runForm.submit()}
        confirmLoading={runLoading}
        destroyOnClose
      >
        <Form form={runForm} layout="vertical" onFinish={handleRunSubmit}>
          <Form.Item
            label="参数 (JSON)"
            name="params"
            extra="传递给工作流的参数，留空表示空对象"
          >
            <TextArea rows={6} placeholder='{"key": "value"}' style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Form>
        {runResult && (
          <Card size="small" title="执行结果" style={{ marginTop: 16 }}>
            <pre style={{ fontSize: 12, overflow: 'auto' }}>
              {JSON.stringify(runResult as object, null, 2)}
            </pre>
          </Card>
        )}
      </Modal>

      {/* Detail Modal */}
      <Modal
        title="工作流详情"
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={700}
      >
        {selectedWorkflow && (
          <Tabs defaultActiveKey="info">
            <Tabs.TabPane tab="基本信息" key="info">
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label="ID">{selectedWorkflow.id}</Descriptions.Item>
                <Descriptions.Item label="名称">{selectedWorkflow.name}</Descriptions.Item>
                <Descriptions.Item label="描述">{selectedWorkflow.description || '-'}</Descriptions.Item>
                <Descriptions.Item label="类型">
                  {selectedWorkflow.isBuiltin ? '内置' : '自定义'}
                </Descriptions.Item>
                <Descriptions.Item label="创建时间">{selectedWorkflow.createdAt}</Descriptions.Item>
                <Descriptions.Item label="更新时间">{selectedWorkflow.updatedAt}</Descriptions.Item>
              </Descriptions>
            </Tabs.TabPane>
            <Tabs.TabPane tab="定义" key="definition">
              <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 400 }}>
                {JSON.stringify(selectedWorkflow.definition, null, 2)}
              </pre>
            </Tabs.TabPane>
          </Tabs>
        )}
      </Modal>
    </div>
  );
}

export default WorkflowsPage;
