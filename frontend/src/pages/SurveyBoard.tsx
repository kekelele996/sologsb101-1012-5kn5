/**
 * 模块 6：/surveys 测量组复测坐标对账台
 *
 * 两份分开管：
 * - 实测坐标认测量组（本页录入/编辑复测记录）；
 * - 台站归属与孔径分档认中心（台站/台阵台账）；
 * - 两边只按台站码 code 对账：中心名册没有的先挂起（待确认）等确认，可重试；
 * - 中心认下的复测进入中心孔径口径，认下不退回（终态，不可改删）；
 * - 台站迁走后复测仍按 code 走，认账后中心取最新认账点位重算孔径。
 *
 * 复用 <StatBadge>、<EmptyPanel>、<ReconcileTag>。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RedoOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import StatBadge from '@/components/common/StatBadge';
import EmptyPanel from '@/components/common/EmptyPanel';
import ReconcileTag from '@/components/common/ReconcileTag';
import { ROUTES } from '@/router';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { selectArrays, selectStations } from '@/stores/arraySlice';
import {
  acceptSurveyCoord,
  createSurveyCoord,
  patchSurveyFilter,
  reconcilePendingSurveys,
  reconcileSurveyCoord,
  removeSurveyCoord,
  resetSurveyFilter,
  selectSurveyCoords,
  selectSurveyFilter,
  updateSurveyCoord,
} from '@/stores/surveySlice';
import { isAccepted, SURVEY_STATUSES, type SurveyCoord, type SurveyStatus } from '@/types/survey';
import {
  decimalToDmsRecord,
  formatLatLng,
  parseDms,
  round,
  validateLatLng,
} from '@/utils/geo';
import { buildSurveyReconcileRows, type SurveyReconcileRow } from '@/utils/reconcile';
import { initDatabase } from '@/utils/db';

interface SurveyFormValues {
  code: string;
  lat: number;
  lng: number;
  latDms: string;
  lngDms: string;
  measuredAt: dayjs.Dayjs | null;
  surveyor: string;
  method: string;
}

const SURVEY_METHODS = ['平板 GNSS', '全站仪', 'RTK', '水准联测'];

export default function SurveyBoard() {
  const dispatch = useAppDispatch();
  const { message } = AntdApp.useApp();

  const surveyCoords = useAppSelector(selectSurveyCoords);
  const stations = useAppSelector(selectStations);
  const arrays = useAppSelector(selectArrays);
  const filter = useAppSelector(selectSurveyFilter);

  /** 中心台阵 id → 名称（归属认中心） */
  const arrayNameById = useMemo(
    () => new Map(arrays.map((array) => [array.id, array.name])),
    [arrays]
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form] = Form.useForm<SurveyFormValues>();

  useEffect(() => {
    if (surveyCoords.length === 0) void initDatabase();
  }, [surveyCoords.length]);

  /** 对账视图：挂上中心名册匹配与偏差 */
  const rows = useMemo<SurveyReconcileRow[]>(() => {
    const keyword = filter.keyword.trim().toUpperCase();
    return buildSurveyReconcileRows(surveyCoords, stations)
      .filter((row) => {
        if (keyword.length > 0) {
          const haystack = `${row.code}${row.surveyor}${row.method}${row.reconcileNote}`.toUpperCase();
          if (!haystack.includes(keyword)) return false;
        }
        if (filter.statuses.length > 0 && !filter.statuses.includes(row.status)) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [filter, stations, surveyCoords]);

  const stats = useMemo(() => {
    const count = (status: SurveyStatus) => surveyCoords.filter((row) => row.status === status).length;
    return {
      total: surveyCoords.length,
      pending: count('待对账'),
      matched: count('待认账'),
      accepted: count('已认账'),
      failed: count('待确认'),
    };
  }, [surveyCoords]);

  /** 度分秒输入变化时尝试反解十进制，十进制变化时回填度分秒（二者互相辅助） */
  const syncDmsToDecimal = () => {
    const latDms = form.getFieldValue('latDms') as string;
    const lngDms = form.getFieldValue('lngDms') as string;
    const lat = parseDms(latDms, 'lat');
    const lng = parseDms(lngDms, 'lng');
    if (lat !== null) form.setFieldValue('lat', lat);
    if (lng !== null) form.setFieldValue('lng', lng);
  };

  const syncDecimalToDms = () => {
    const lat = Number(form.getFieldValue('lat'));
    const lng = Number(form.getFieldValue('lng'));
    if (validateLatLng(lat, lng).length === 0) {
      const dms = decimalToDmsRecord(lat, lng);
      form.setFieldsValue({ latDms: dms.latDms, lngDms: dms.lngDms });
    }
  };

  const openCreate = () => {
    setEditingId(null);
    form.setFieldsValue({
      code: '',
      lat: 30.8,
      lng: 103.5,
      latDms: '',
      lngDms: '',
      measuredAt: dayjs(),
      surveyor: '',
      method: SURVEY_METHODS[0],
    });
    syncDecimalToDms();
    setModalOpen(true);
  };

  const openEdit = (row: SurveyCoord) => {
    if (isAccepted(row)) {
      message.warning('该复测中心已认账，认下不退回，不能修改');
      return;
    }
    setEditingId(row.id);
    form.setFieldsValue({
      code: row.code,
      lat: row.lat,
      lng: row.lng,
      latDms: row.latDms,
      lngDms: row.lngDms,
      measuredAt: dayjs(row.measuredAt),
      surveyor: row.surveyor,
      method: row.method,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    // 优先十进制；十进制缺失/不合法时由度分秒反解（兼容旧数据只有度分秒的场景）
    const rawLat = Number(values.lat);
    const rawLng = Number(values.lng);
    let lat = Number.isFinite(rawLat) ? rawLat : NaN;
    let lng = Number.isFinite(rawLng) ? rawLng : NaN;
    if (validateLatLng(lat, lng).length > 0) {
      const fromDmsLat = parseDms(values.latDms, 'lat');
      const fromDmsLng = parseDms(values.lngDms, 'lng');
      if (fromDmsLat === null || fromDmsLng === null) {
        message.warning('经纬度不合法：请填写十进制坐标，或给出可解析的度分秒（如 30°50′31.6″N）');
        return;
      }
      lat = fromDmsLat;
      lng = fromDmsLng;
    }
    const errors = validateLatLng(lat, lng);
    if (errors.length > 0) {
      message.warning(`经纬度校验未通过：${errors.join('；')}`);
      return;
    }
    const dms =
      values.latDms && values.lngDms
        ? { latDms: values.latDms.trim(), lngDms: values.lngDms.trim() }
        : decimalToDmsRecord(lat, lng);
    setSubmitting(true);
    try {
      const payload = {
        code: values.code.trim().toUpperCase(),
        lat: round(lat, 6),
        lng: round(lng, 6),
        ...dms,
        measuredAt: values.measuredAt ? values.measuredAt.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        surveyor: values.surveyor?.trim() ?? '',
        method: values.method,
      };
      if (editingId) {
        // 编辑后回到「待对账」，需重新按 code 对账（测量组这边重试）
        await dispatch(
          updateSurveyCoord({
            id: editingId,
            patch: {
              ...payload,
              status: '待对账',
              reconcileNote: '测量组已修正复测信息，待重新按台站码对账',
              acceptedAt: null,
            },
          })
        ).unwrap();
        message.success(`复测 ${payload.code} 已修正，请重新对账`);
      } else {
        await dispatch(createSurveyCoord(payload)).unwrap();
        message.success(`复测 ${payload.code} 已登记（${formatLatLng(payload.lat, payload.lng)}），待按台站码对账`);
      }
      setModalOpen(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '复测记录保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const runReconcile = async (id: string) => {
    setBusyId(id);
    try {
      const result = await dispatch(reconcileSurveyCoord(id)).unwrap();
      if (result.status === '待认账') message.success('台站码已对上中心名册，已提交中心认账');
      else message.warning('中心名册暂无此台站码，已挂起「待确认」，核对台站码后可重试');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '对账失败');
    } finally {
      setBusyId(null);
    }
  };

  const runReconcileAll = async () => {
    const targetCount = stats.pending + stats.failed;
    if (targetCount === 0) {
      message.info('没有待对账或待确认可重试的复测记录');
      return;
    }
    const result = await dispatch(reconcilePendingSurveys()).unwrap();
    message.success(`已按台站码批量对账 ${result} 条（已认账的不重复对账、不退回）`);
  };

  const runAccept = async (row: SurveyReconcileRow) => {
    setBusyId(row.id);
    try {
      await dispatch(acceptSurveyCoord(row.id)).unwrap();
      message.success(`已认账 ${row.code}：实测坐标进入中心孔径口径，可到几何页重算孔径`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '认账失败');
    } finally {
      setBusyId(null);
    }
  };

  const runRemove = async (id: string) => {
    try {
      await dispatch(removeSurveyCoord(id)).unwrap();
      message.success('复测记录已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="gb-brand-bar" />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <Typography.Title level={4} style={{ margin: '0 0 4px', color: '#1e3a5f' }}>
            测量组复测坐标对账台
          </Typography.Title>
          <p className="gb-hint">
            实测坐标认测量组、台站归属与孔径分档认中心；两边只按台站码对账，中心认下的进入孔径口径且不退回。
          </p>
        </div>
        <Space wrap>
          <Button icon={<SyncOutlined />} onClick={() => void runReconcileAll()}>
            批量对账（待对账 / 待确认重试）
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            录入复测坐标
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        message="两份分开管的口径"
        description={
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>实测经纬度以测量组平板复测为准；台站归属（属于哪个台阵）与孔径分档以台网中心台账为准。</li>
            <li>两边按台站码对账：中心名册没有该码的复测先挂起「待确认」，测量组核对台站码后可重试。</li>
            <li>台站迁走后复测坐标仍跟台站码；中心认账后孔径按中心手里那份（最新已认账复测，无则初设坐标）重算。</li>
            <li>对账失败由测量组这边重试；中心认下的记录为终态，不退回、不可改删。</li>
            <li>旧数据只有度分秒，结构升级时补出十进制后才能参与孔径计算。</li>
          </ol>
        }
      />

      <div className="gb-stats-row">
        <StatBadge label="复测记录" value={stats.total} suffix="条" tone="info" />
        <StatBadge label="待对账" value={stats.pending} suffix="条" tone="default" />
        <StatBadge label="待中心认账" value={stats.matched} suffix="条" tone="warning" />
        <StatBadge label="已认账（不退回）" value={stats.accepted} suffix="条" tone="success" />
        <StatBadge label="待确认挂起" value={stats.failed} suffix="条" tone={stats.failed > 0 ? 'danger' : 'default'} />
      </div>

      <Card className="gb-panel" size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            allowClear
            placeholder="搜索台站码 / 测量员 / 手段 / 备注"
            style={{ width: 300 }}
            value={filter.keyword}
            onChange={(event) => dispatch(patchSurveyFilter({ keyword: event.target.value }))}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="按对账状态筛选"
            style={{ minWidth: 260 }}
            value={filter.statuses}
            onChange={(value) => dispatch(patchSurveyFilter({ statuses: value as SurveyStatus[] }))}
            options={SURVEY_STATUSES.map((status) => ({ label: status, value: status }))}
          />
          <Button onClick={() => dispatch(resetSurveyFilter())}>重置筛选</Button>
        </Space>

        {rows.length === 0 ? (
          <EmptyPanel
            title="没有复测记录"
            description="外业测量组用平板复测后在此录入实测坐标，按台站码与中心台账对账。"
            actionText="录入复测坐标"
            onAction={openCreate}
          />
        ) : (
          <Table
            rowKey="id"
            size="small"
            className="gb-table-compact"
            dataSource={rows}
            pagination={false}
            scroll={{ x: 1280 }}
            columns={[
              {
                title: '台站码',
                dataIndex: 'code',
                width: 100,
                fixed: 'left',
                render: (value: string) => <span className="gb-mono" style={{ fontWeight: 700 }}>{value}</span>,
              },
              { title: '状态', dataIndex: 'status', width: 130, render: (_: unknown, row) => (
                <ReconcileTag status={row.status} size="small" retryCount={row.retryCount} />
              ) },
              {
                title: '复测坐标（测量组）',
                width: 210,
                render: (_: unknown, row) => (
                  <div>
                    <div className="gb-mono">{row.lat.toFixed(5)}, {row.lng.toFixed(5)}</div>
                    <div className="gb-hint gb-mono">{row.latDms} {row.lngDms}</div>
                  </div>
                ),
              },
              {
                title: '中心初设坐标',
                width: 190,
                render: (_: unknown, row) =>
                  row.centerStation ? (
                    <div>
                      <div className="gb-mono">{row.centerStation.lat.toFixed(5)}, {row.centerStation.lng.toFixed(5)}</div>
                      <div className="gb-hint">偏差 {row.driftKm === null ? '—' : `${round(row.driftKm, 3)} km`}</div>
                    </div>
                  ) : (
                    <Tag color="red">名册无此码</Tag>
                  ),
              },
              { title: '复测日期', dataIndex: 'measuredAt', width: 110, className: 'gb-mono' },
              { title: '测量员', dataIndex: 'surveyor', width: 150 },
              { title: '手段', dataIndex: 'method', width: 100, render: (value: string) => <Tag>{value}</Tag> },
              {
                title: '中心归属',
                width: 150,
                render: (_: unknown, row) =>
                  row.centerStation ? (
                    <Tag color="blue">{arrayNameById.get(row.centerStation.arrayId) ?? '未知台阵'}</Tag>
                  ) : (
                    <span className="gb-hint">待确认</span>
                  ),
              },
              { title: '对账/认账说明', dataIndex: 'reconcileNote', ellipsis: true },
              {
                title: '操作',
                width: 250,
                fixed: 'right',
                render: (_: unknown, row: SurveyReconcileRow) => (
                  <Space size={6} wrap>
                    {row.status === '待认账' ? (
                      <Button
                        size="small"
                        type="primary"
                        icon={<CheckOutlined />}
                        loading={busyId === row.id}
                        onClick={() => void runAccept(row)}
                      >
                        中心认账
                      </Button>
                    ) : null}
                    {row.status === '待对账' || row.status === '待确认' ? (
                      <Button
                        size="small"
                        icon={<RedoOutlined />}
                        loading={busyId === row.id}
                        onClick={() => void runReconcile(row.id)}
                      >
                        {row.status === '待确认' ? '重试对账' : '按码对账'}
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      disabled={isAccepted(row)}
                      onClick={() => openEdit(row)}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="删除复测记录"
                      description={isAccepted(row) ? '中心已认账，认下不退回，不能删除。' : '确认删除该复测记录？'}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void runRemove(row.id)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} disabled={isAccepted(row)}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <p className="gb-hint">
        认账后到「<a href={ROUTES.geometry}>台阵几何与备份</a>」页，孔径与几何平面图按中心口径（已认账复测坐标）重算；
        台站迁走导致的新点位需再次复测并认账，历史已认账记录保留用于追溯。
      </p>

      <Modal
        open={modalOpen}
        title={editingId ? '修正复测坐标（测量组）' : '录入复测坐标（测量组平板）'}
        onCancel={() => setModalOpen(false)}
        onOk={() => void submit()}
        confirmLoading={submitting}
        okText={editingId ? '保存并回到待对账' : '登记复测'}
        destroyOnClose
        width={620}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="code" label="台站码（与中心名册对账的唯一依据）" rules={[{ required: true, message: '请填写台站码' }]}>
            <Input placeholder="如：LTX01（台站迁走也保持此码）" maxLength={20} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="lat" label="纬度（十进制，可由度分秒反解）">
                <InputNumber min={-90} max={90} step={0.00001} style={{ width: '100%' }} onBlur={syncDecimalToDms} placeholder="填十进制或在下方填度分秒" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="lng" label="经度（十进制，可由度分秒反解）">
                <InputNumber min={-180} max={180} step={0.00001} style={{ width: '100%' }} onBlur={syncDecimalToDms} placeholder="填十进制或在下方填度分秒" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="latDms" label="纬度（度分秒，可反解十进制）">
                <Input placeholder="如 30°50′31.6″N" onBlur={syncDmsToDecimal} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="lngDms" label="经度（度分秒，可反解十进制）">
                <Input placeholder="如 103°33′44.6″E" onBlur={syncDmsToDecimal} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="measuredAt" label="复测日期" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="surveyor" label="测量员" rules={[{ required: true, message: '请填写测量员' }]}>
                <Input placeholder="如：周渝" maxLength={20} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="method" label="复测手段" rules={[{ required: true }]}>
                <Select options={SURVEY_METHODS.map((method) => ({ label: method, value: method }))} />
              </Form.Item>
            </Col>
          </Row>
          <p className="gb-hint">旧记录只有度分秒时，填入度分秒会自动补出十进制；没有合法十进制坐标的记录不参与孔径计算。</p>
        </Form>
      </Modal>
    </div>
  );
}
