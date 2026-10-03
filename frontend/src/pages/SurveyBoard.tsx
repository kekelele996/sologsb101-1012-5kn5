/**
 * 模块 6：/surveys 复测对账台
 * 测量组一侧的实测坐标台账：登记平板复测结果（支持度分秒录入，自动补十进制），
 * 按台站码与中心名册对账；挂起 / 失败可重试，中心认下的不退回。
 * 复用 <FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Alert,
  AutoComplete,
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import FilterBar from '@/components/common/FilterBar';
import type { FilterModel } from '@/types/filter';
import StatBadge from '@/components/common/StatBadge';
import EmptyPanel from '@/components/common/EmptyPanel';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { selectStations } from '@/stores/arraySlice';
import {
  createSurvey,
  patchSurveyFilter,
  reconcileSurveys,
  removeSurvey,
  resetSurveyFilter,
  retrySurvey,
  selectSurveyCounts,
  selectSurveyFilter,
  selectSurveyReceipt,
  selectSurveys,
  updateSurvey,
} from '@/stores/surveySlice';
import {
  SURVEY_STATES,
  canRetrySurvey,
  canRemoveSurvey,
  type SurveyRecord,
  type SurveyState,
} from '@/types/survey';
import { parseDms, toDms, validateLatLng } from '@/utils/geo';
import { initDatabase } from '@/utils/db';

type CoordMode = 'decimal' | 'dms';

interface SurveyFormValues {
  code: string;
  coordMode: CoordMode;
  lat?: number;
  lng?: number;
  latDms?: string;
  lngDms?: string;
  elevM: number;
  surveyDate: dayjs.Dayjs | null;
  surveyor: string;
}

const STATE_TAG_COLOR: Record<SurveyState, string> = {
  待对账: 'blue',
  已认下: 'green',
  挂起待确认: 'orange',
  对账失败: 'red',
};

export default function SurveyBoard() {
  const dispatch = useAppDispatch();
  const { message } = AntdApp.useApp();

  const surveys = useAppSelector(selectSurveys);
  const stations = useAppSelector(selectStations);
  const filter = useAppSelector(selectSurveyFilter);
  const counts = useAppSelector(selectSurveyCounts);
  const receipt = useAppSelector(selectSurveyReceipt);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [notice, setNotice] = useState('');
  const [form] = Form.useForm<SurveyFormValues>();
  const coordMode = Form.useWatch('coordMode', form) ?? 'decimal';

  useEffect(() => {
    if (stations.length === 0) void initDatabase();
  }, [stations.length]);

  useEffect(() => {
    if (receipt) setNotice(receipt);
  }, [receipt]);

  /** 中心名册台站码（录入时提示，便于对账命中） */
  const rosterCodes = useMemo(
    () => Array.from(new Set(stations.map((row) => row.code))).sort(),
    [stations]
  );

  const filtered = useMemo(
    () =>
      surveys
        .filter((row) => {
          const keyword = filter.keyword.trim();
          if (keyword.length > 0 && !`${row.code}${row.surveyor}${row.note}`.includes(keyword)) return false;
          if (filter.states.length > 0 && !filter.states.includes(row.state)) return false;
          return true;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [filter, surveys]
  );

  const filterModel: FilterModel = {
    keyword: filter.keyword,
    states: filter.states,
  };

  const openCreate = () => {
    setEditingId(null);
    form.setFieldsValue({
      code: '',
      coordMode: 'decimal',
      lat: undefined,
      lng: undefined,
      latDms: '',
      lngDms: '',
      elevM: 1000,
      surveyDate: dayjs(),
      surveyor: '',
    });
    setModalOpen(true);
  };

  const openEdit = (row: SurveyRecord) => {
    setEditingId(row.id);
    form.setFieldsValue({
      code: row.code,
      coordMode: 'decimal',
      lat: row.lat,
      lng: row.lng,
      latDms: row.latDms,
      lngDms: row.lngDms,
      elevM: row.elevM,
      surveyDate: dayjs(row.surveyDate),
      surveyor: row.surveyor,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    let lat: number;
    let lng: number;
    let latDms: string;
    let lngDms: string;
    if (values.coordMode === 'dms') {
      // 旧数据只有度分秒：解析补出十进制后才能参与孔径计算
      const parsedLat = parseDms(values.latDms ?? '', 'lat');
      const parsedLng = parseDms(values.lngDms ?? '', 'lng');
      if (parsedLat === null || parsedLng === null) {
        message.error('度分秒解析失败，请检查格式（如 30°50′31.6″N / 103°33′42.8″E）');
        return;
      }
      lat = parsedLat;
      lng = parsedLng;
      latDms = (values.latDms ?? '').trim();
      lngDms = (values.lngDms ?? '').trim();
    } else {
      lat = Number(values.lat);
      lng = Number(values.lng);
      latDms = toDms(lat, 'lat');
      lngDms = toDms(lng, 'lng');
    }
    const rangeErrors = validateLatLng(lat, lng);
    if (rangeErrors.length > 0) {
      message.warning(`坐标范围异常（${rangeErrors.join('；')}），已按原值保存，对账时将判为失败`);
    }
    setSubmitting(true);
    try {
      const payload = {
        code: values.code.trim().toUpperCase(),
        lat,
        lng,
        elevM: Number(values.elevM),
        latDms,
        lngDms,
        surveyDate: values.surveyDate ? values.surveyDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        surveyor: values.surveyor.trim(),
      };
      if (editingId) {
        await dispatch(updateSurvey({ id: editingId, patch: payload })).unwrap();
        message.success(`复测记录 ${payload.code} 已更正并置回待对账`);
      } else {
        await dispatch(createSurvey(payload)).unwrap();
        message.success(`复测记录 ${payload.code} 已登记，等待对账`);
      }
      setModalOpen(false);
    } catch (error) {
      message.error(typeof error === 'string' ? error : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReconcileAll = async () => {
    setReconciling(true);
    try {
      await dispatch(reconcileSurveys()).unwrap();
    } finally {
      setReconciling(false);
    }
  };

  const handleRowAction = async (row: SurveyRecord) => {
    if (canRetrySurvey(row.state)) {
      try {
        await dispatch(retrySurvey(row.id)).unwrap();
      } catch (error) {
        message.error(typeof error === 'string' ? error : '重试失败');
      }
      return;
    }
    await dispatch(reconcileSurveys({ ids: [row.id] })).unwrap();
  };

  const handleRemove = async (row: SurveyRecord) => {
    try {
      await dispatch(removeSurvey(row.id)).unwrap();
      message.success(`复测记录 ${row.code}（${row.surveyDate}）已删除`);
    } catch (error) {
      message.error(typeof error === 'string' ? error : '删除失败');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="gb-brand-bar" />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <Typography.Title level={4} style={{ margin: '0 0 4px', color: '#1e3a5f' }}>
            复测对账台
          </Typography.Title>
          <p className="gb-hint">
            测量组登记平板复测的实测坐标（度分秒自动补十进制）；按台站码与中心名册对账，
            认下后实测坐标写回中心台账并按中心手里那份重算孔径。
          </p>
        </div>
        <Space wrap>
          <Button icon={<SyncOutlined />} loading={reconciling} onClick={() => void handleReconcileAll()}>
            全部对账
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增复测记录
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        message="双台账分管与对账规则"
        description="实测坐标认测量组，台站归属与孔径分档认台网中心；两边按台站码对账，中心名册没有的先挂着等确认（到「台站仪器」页补建台站后重试即可认下）；坐标无效判对账失败，由测量组更正后重试；中心认下的不退回、不重复对账。"
        closable
      />

      {notice ? (
        <Alert type="success" showIcon message={notice} closable onClose={() => setNotice('')} />
      ) : null}

      <div className="gb-stats-row">
        <StatBadge label="待对账" value={counts.pending} suffix="条" tone="info" />
        <StatBadge label="已认下" value={counts.accepted} suffix="条" tone="success" />
        <StatBadge
          label="挂起待确认"
          value={counts.held}
          suffix="条"
          tone={counts.held > 0 ? 'warning' : 'default'}
          tip="中心名册没有该台站码，等中心确认"
        />
        <StatBadge
          label="对账失败"
          value={counts.failed}
          suffix="条"
          tone={counts.failed > 0 ? 'danger' : 'default'}
          tip="坐标无效等原因，测量组更正后重试"
        />
      </div>

      <FilterBar
        modelValue={filterModel}
        selects={[
          {
            key: 'states',
            label: '对账状态',
            options: SURVEY_STATES.map((state) => ({ label: state, value: state })),
          },
        ]}
        keywordPlaceholder="搜索台站码 / 测量员 / 备注"
        onChange={(next) => {
          dispatch(
            patchSurveyFilter({
              keyword: next.keyword,
              states: ((next.states as string[]) ?? []) as SurveyState[],
            })
          );
        }}
        onReset={() => dispatch(resetSurveyFilter())}
      />

      {filtered.length === 0 ? (
        <EmptyPanel
          title={surveys.length === 0 ? '还没有复测记录' : '没有符合条件的复测记录'}
          description="登记测量组平板复测的点位坐标（支持度分秒），随后按台站码与中心名册对账。"
          actionText="新增复测记录"
          secondaryText="重置筛选"
          onAction={openCreate}
          onSecondary={() => dispatch(resetSurveyFilter())}
        />
      ) : (
        <Table
          rowKey="id"
          size="small"
          className="gb-table-compact"
          dataSource={filtered}
          pagination={false}
          columns={[
            {
              title: '台站码',
              dataIndex: 'code',
              width: 100,
              render: (value: string) => <span className="gb-mono">{value}</span>,
            },
            {
              title: '实测坐标（十进制 / 度分秒）',
              width: 230,
              render: (_: unknown, row: SurveyRecord) => (
                <div>
                  <div className="gb-mono">
                    {row.lat.toFixed(4)}, {row.lng.toFixed(4)}
                  </div>
                  <div className="gb-hint gb-mono">
                    {row.latDms || toDms(row.lat, 'lat')} {row.lngDms || toDms(row.lng, 'lng')}
                  </div>
                </div>
              ),
            },
            {
              title: '高程 (m)',
              dataIndex: 'elevM',
              width: 90,
              align: 'right',
              className: 'gb-mono',
            },
            { title: '复测日期', dataIndex: 'surveyDate', width: 110, className: 'gb-mono' },
            { title: '测量员', dataIndex: 'surveyor', width: 130, ellipsis: true },
            {
              title: '对账状态',
              dataIndex: 'state',
              width: 110,
              render: (value: SurveyState) => <Tag color={STATE_TAG_COLOR[value]}>{value}</Tag>,
            },
            {
              title: '重试',
              dataIndex: 'retryCount',
              width: 70,
              align: 'right',
              render: (value: number) => <span className="gb-mono">{value}</span>,
            },
            {
              title: '对账备注',
              dataIndex: 'note',
              ellipsis: true,
              render: (value: string) => value || <span className="gb-hint">—</span>,
            },
            {
              title: '操作',
              width: 210,
              render: (_: unknown, row: SurveyRecord) => (
                <Space size={6}>
                  {row.state !== '已认下' ? (
                    <>
                      <Button
                        size="small"
                        type="primary"
                        icon={canRetrySurvey(row.state) ? <ReloadOutlined /> : <CheckOutlined />}
                        onClick={() => void handleRowAction(row)}
                      >
                        {canRetrySurvey(row.state) ? '重试' : '对账'}
                      </Button>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                        更正
                      </Button>
                    </>
                  ) : (
                    <Tag color="green" icon={<CheckOutlined />}>
                      中心已认下
                    </Tag>
                  )}
                  {canRemoveSurvey(row.state) ? (
                    <Popconfirm
                      title="删除复测记录"
                      description={`确认删除 ${row.code}（${row.surveyDate}）的复测记录？`}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void handleRemove(row)}
                    >
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      )}

      <p className="gb-hint">
        提示：台站迁走后复测坐标仍按台站码跟着台站；认下时以测量组实测坐标更新中心台账，
        孔径按中心手里那份（中心台账全量台站）重算并回写登记值。中心名册现有台站码：
        {rosterCodes.length > 0 ? rosterCodes.join('、') : '（空）'}。
      </p>

      <Modal
        open={modalOpen}
        title={editingId ? '更正复测记录（保存后置回待对账）' : '新增复测记录'}
        onCancel={() => setModalOpen(false)}
        onOk={() => void submit()}
        confirmLoading={submitting}
        okText={editingId ? '保存更正' : '登记并待对账'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={{ coordMode: 'decimal' }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="code" label="台站码（对账关键字）" rules={[{ required: true, message: '请填写台站码' }]}>
                <AutoComplete
                  placeholder="如：LTX02"
                  options={rosterCodes.map((code) => ({ label: code, value: code }))}
                  filterOption={(input, option) =>
                    (option?.value ?? '').toUpperCase().includes(input.toUpperCase())
                  }
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="surveyor" label="测量员 / 班组" rules={[{ required: true, message: '请填写测量员' }]}>
                <Input placeholder="如：测绘一组·何川" maxLength={30} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="coordMode" label="坐标录入方式（旧数据只有度分秒时选度分秒，自动补十进制）">
            <Radio.Group
              options={[
                { label: '十进制度', value: 'decimal' },
                { label: '度分秒', value: 'dms' },
              ]}
              optionType="button"
            />
          </Form.Item>
          {coordMode === 'decimal' ? (
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="lat"
                  label="纬度（十进制）"
                  rules={[{ required: true, message: '请填写纬度' }]}
                >
                  <InputNumber min={-90} max={90} step={0.0001} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="lng"
                  label="经度（十进制）"
                  rules={[{ required: true, message: '请填写经度' }]}
                >
                  <InputNumber min={-180} max={180} step={0.0001} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="latDms"
                  label="纬度（度分秒）"
                  rules={[{ required: true, message: '请填写纬度度分秒' }]}
                >
                  <Input placeholder="如：30°50′31.6″N" maxLength={30} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="lngDms"
                  label="经度（度分秒）"
                  rules={[{ required: true, message: '请填写经度度分秒' }]}
                >
                  <Input placeholder="如：103°33′42.8″E" maxLength={30} />
                </Form.Item>
              </Col>
            </Row>
          )}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="elevM" label="高程 (m)" rules={[{ required: true, message: '请填写高程' }]}>
                <InputNumber min={-500} max={9000} step={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="surveyDate" label="复测日期" rules={[{ required: true, message: '请选择复测日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
