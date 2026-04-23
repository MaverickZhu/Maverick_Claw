import { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Tag, Spin, Table, Tabs } from 'antd';
import {
  MessageOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  BarChartOutlined,
  PieChartOutlined,
} from '@ant-design/icons';
import { apiGet } from '../api/client';

interface StatsOverview {
  totalSessions: number;
  totalMessages: number;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  todayMessages: number;
  todayRequests: number;
  todayTokens: number;
  activeSessions: number;
  configuredModels: number;
}

interface DailyStats {
  date: string;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

interface ModelStats {
  modelId: string;
  provider: string;
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

function DashboardPage() {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [daily, setDaily] = useState<DailyStats[]>([]);
  const [models, setModels] = useState<ModelStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [overviewData, dailyData, modelsData] = await Promise.all([
          apiGet<StatsOverview>('/api/stats/overview'),
          apiGet<DailyStats[]>('/api/stats/daily?days=14'),
          apiGet<ModelStats[]>('/api/stats/models'),
        ]);
        setStats(overviewData);
        setDaily(Array.isArray(dailyData) ? dailyData : []);
        setModels(Array.isArray(modelsData) ? modelsData : []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  const dailyColumns = [
    { title: '日期', dataIndex: 'date', key: 'date' },
    { title: '请求数', dataIndex: 'totalRequests', key: 'totalRequests' },
    { title: 'Prompt Tokens', dataIndex: 'totalPromptTokens', key: 'totalPromptTokens' },
    { title: 'Completion Tokens', dataIndex: 'totalCompletionTokens', key: 'totalCompletionTokens' },
    { title: '总 Token', dataIndex: 'totalTokens', key: 'totalTokens' },
  ];

  const modelColumns = [
    { title: '模型', dataIndex: 'modelId', key: 'modelId' },
    { title: 'Provider', dataIndex: 'provider', key: 'provider' },
    { title: '请求数', dataIndex: 'totalRequests', key: 'totalRequests' },
    { title: 'Prompt Tokens', dataIndex: 'totalPromptTokens', key: 'totalPromptTokens' },
    { title: 'Completion Tokens', dataIndex: 'totalCompletionTokens', key: 'totalCompletionTokens' },
    { title: '总 Token', dataIndex: 'totalTokens', key: 'totalTokens' },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: '24px' }}>仪表板</h1>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日消息"
              value={stats?.todayMessages ?? 0}
              prefix={<MessageOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="活跃会话"
              value={stats?.activeSessions ?? 0}
              prefix={<ApiOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="已配置模型"
              value={stats?.configuredModels ?? 0}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="今日 Token"
              value={stats?.todayTokens ?? 0}
              prefix={<ThunderboltOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: '16px' }}>
        <Col span={12}>
          <Card title="系统状态">
            <p>
              Gateway: <Tag color="success">运行中</Tag>
            </p>
            <p>
              WebSocket: <Tag color="success">已连接</Tag>
            </p>
            <p>
              数据库: <Tag color="success">正常</Tag>
            </p>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="累计统计">
            <p>总会话: <strong>{stats?.totalSessions ?? 0}</strong></p>
            <p>总消息: <strong>{stats?.totalMessages ?? 0}</strong></p>
            <p>总请求: <strong>{stats?.totalRequests ?? 0}</strong></p>
            <p>总 Token: <strong>{stats?.totalTokens ?? 0}</strong></p>
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: '16px' }}>
        <Tabs
          items={[
            {
              key: 'daily',
              label: (
                <span>
                  <BarChartOutlined /> 每日趋势（14天）
                </span>
              ),
              children: (
                <Table
                  dataSource={daily}
                  columns={dailyColumns}
                  rowKey="date"
                  pagination={false}
                  size="small"
                />
              ),
            },
            {
              key: 'models',
              label: (
                <span>
                  <PieChartOutlined /> 模型使用
                </span>
              ),
              children: (
                <Table
                  dataSource={models}
                  columns={modelColumns}
                  rowKey="modelId"
                  pagination={false}
                  size="small"
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

export default DashboardPage;
