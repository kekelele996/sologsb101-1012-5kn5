/**
 * <ReconcileTag> 复测对账状态标签。
 * 待对账（测量组）/ 待认账（等中心）/ 已认账（终态，不退回）/ 待确认（对不上，挂起可重试）。
 * 被复测坐标对账页与几何视图消费。
 */
import { Tag, Tooltip } from 'antd';
import {
  CheckCircleFilled,
  ClockCircleFilled,
  PauseCircleFilled,
  SyncOutlined,
} from '@ant-design/icons';
import type { SurveyStatus } from '@/types/survey';

export interface ReconcileTagProps {
  status: SurveyStatus;
  size?: 'default' | 'small';
  /** 重试次数，传入后在待确认态提示 */
  retryCount?: number;
}

const TONE: Record<SurveyStatus, { color: string; bg: string; icon: JSX.Element; tip: string }> = {
  待对账: {
    color: '#5b6b78',
    bg: '#f2f4f6',
    icon: <ClockCircleFilled />,
    tip: '测量组已复测，尚未按台站码对账',
  },
  待认账: {
    color: '#b9770e',
    bg: '#fef5e7',
    icon: <SyncOutlined spin={false} />,
    tip: '台站码已对上中心名册，等中心认账',
  },
  已认账: {
    color: '#1e8449',
    bg: '#eaf6ee',
    icon: <CheckCircleFilled />,
    tip: '中心已认账：实测坐标进入孔径口径，认下不退回',
  },
  待确认: {
    color: '#c0392b',
    bg: '#fdecea',
    icon: <PauseCircleFilled />,
    tip: '中心名册没有此台站码，先挂起等确认；测量组核对后可重试对账',
  },
};

export function ReconcileTag({ status, size = 'default', retryCount }: ReconcileTagProps) {
  const tone = TONE[status] ?? TONE.待对账;
  const tip = status === '待确认' && retryCount ? `${tone.tip}（已重试 ${retryCount} 次）` : tone.tip;
  return (
    <Tooltip title={tip}>
      <Tag
        icon={tone.icon}
        style={{
          color: tone.color,
          background: tone.bg,
          borderColor: tone.color,
          fontSize: size === 'small' ? 12 : 13,
          fontWeight: 600,
          borderRadius: 999,
          paddingInline: size === 'small' ? 8 : 10,
          marginInlineEnd: 0,
        }}
      >
        {status}
        {status === '待确认' && retryCount ? <span style={{ fontWeight: 400 }}> · {retryCount} 次重试</span> : null}
      </Tag>
    </Tooltip>
  );
}

export default ReconcileTag;
