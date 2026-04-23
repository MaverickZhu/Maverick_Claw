import { useEffect, useState } from 'react';
import {
  Card,
  Table,
  DatePicker,
  Button,
  Space,
  Tag,
  Typography,
  Row,
  Col,
  Statistic,
} from 'antd';
import dayjs from 'dayjs';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';

import { apiGet } from '../../api/client';

const { RangePicker } = DatePicker;
const { Text } = Typography;

interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: number;
}

interface AuditStats {
  total: number;
  byAction: Record<string, number>;
}

function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (dateRange?.[0]) {
        params.set('from', dateRange[0].startOf('day').toISOString());
      }
      if (dateRange?.[1]) {
        params.set('to', dateRange[1].endOf('day').toISOString());
      }
      const data = await apiGet<{ logs: AuditLog[] }>(`/api/audit/logs?${params.toString()}`);
      setLogs(data.logs || []);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const days = dateRange?.[0] && dateRange?.[1]
        ? dateRange[1].diff(dateRange[0], 'day') + 1
        : 7;
      const data = await apiGet<AuditStats>(`/api/audit/stats?days=${days}`);
      setStats(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, []);

  const handleSearch = () => {
    fetchLogs();
    fetchStats();
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (ts: number) => dayjs(ts * 1000).format('YYYY-MM-DD HH:mm:ss'),
    },
    { title: '用户', dataIndex: 'userId', key: 'userId', width: 120 },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 120,
      render: (action: string) => <Tag color="blue">{action}</Tag>,
    },
    { title: '资源类型', dataIndex: 'resourceType', key: 'resourceType', width: 120 },
    { title: '资源ID', dataIndex: 'resourceId', key: 'resourceId', ellipsis: true },
    {
      title: '详情',
      dataIndex: 'details',
      key: 'details',
      ellipsis: true,
      render: (details?: string) => {
        if (!details) return '-';
        try {
          const obj = JSON.parse(details);
          return <Text code>{JSON.stringify(obj, null, 0).slice(0, 100)}</Text>;
        } catch {
          return <Text code>{details.slice(0, 100)}</Text>;
        }
      },
    },
    { title: 'IP', dataIndex: 'ipAddress', key: 'ipAddress', width: 130 },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="总记录数" value={stats?.total || 0} />
          </Card>
        </Col>
        <Col span={18}>
          <Card>
            <Space wrap>
              {stats?.byAction &&
                Object.entries(stats.byAction).map(([action, count]) => (
                  <Tag key={action} color="cyan">
                    {action}: {count}
                  </Tag>
                ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Card
        title="审计日志"
        extra={
          <Space>
            <RangePicker
              value={dateRange}
              onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs])}
            />
            <Button icon={<SearchOutlined />} onClick={handleSearch}>
              查询
            </Button>
            <Button icon={<ReloadOutlined />} onClick={handleSearch}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table
          dataSource={logs}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1200 }}
        />
      </Card>
    </div>
  );
}

export default AuditPage;
