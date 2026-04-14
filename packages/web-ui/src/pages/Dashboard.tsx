import { Card, Row, Col, Statistic, Tag } from 'antd';
import { MessageOutlined, ApiOutlined, CheckCircleOutlined } from '@ant-design/icons';

function DashboardPage() {
  return (
    <div>
      <h1 style={{ marginBottom: '24px' }}>仪表板</h1>
      
      <Row gutter={[16, 16]}>
        <Col span={8}>
          <Card>
            <Statistic
              title="今日消息"
              value={0}
              prefix={<MessageOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="活跃会话"
              value={0}
              prefix={<ApiOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="已配置模型"
              value={0}
              prefix={<CheckCircleOutlined />}
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
          <Card title="通道状态">
            <p>
              WebChat: <Tag color="success">已启用</Tag>
            </p>
            <p>
              微信: <Tag>未配置</Tag>
            </p>
            <p>
              钉钉: <Tag>未配置</Tag>
            </p>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default DashboardPage;
