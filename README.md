# sologsb101-1012 地震台阵仪器标定与布设台账

面向地震台阵建设与运维班组的纯前端单页应用：把台站布设、仪器安装与逐次标定结果写成可追溯的台账。数据全部保存在浏览器本地（IndexedDB），不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env && docker compose up -d --build
```

启动完成后访问：**http://localhost:22812**

常用命令：

```bash
docker compose ps                 # 查看容器状态
docker compose logs -f frontend   # 查看 nginx 访问日志
docker compose down               # 停止并移除容器
docker compose up -d --build      # 修改代码后重新构建
```

> 宿主端口由 `.env` 中的 `FRONTEND_PORT` 控制（默认 22812）。
> 容器为纯静态 nginx，无数据库服务、不挂载任何命名卷，可随时删除重建。

## 二、技术栈

| 层次 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | React 18.3（函数组件 + Hooks） | 页面全部 `lazy` 懒加载并 `Suspense` 兜底 |
| 语言 | TypeScript 5.6（strict） | 构建脚本执行 `tsc --noEmit` 类型检查 |
| UI 组件 | Ant Design 5.22 + @ant-design/icons | 中文语言包，表格 / 表单 / Modal / 徽标 |
| 构建 | Vite 5 | 产物 `dist/`，交给 nginx 托管 |
| 状态管理 | Redux Toolkit 2 + react-redux 9 | `arraySlice` / `instrumentSlice` / `calibrationSlice` / `surveySlice` |
| 路由 | React Router 6（`createBrowserRouter`） | 路径与提示词逐字一致，支持深链刷新 |
| 持久化 | Dexie 4（IndexedDB，库名 `gbseisarray`） | 结构版本 v3 + upgrade 迁移 + liveQuery 订阅 |
| 容器 | node:20-alpine 构建 → nginx:alpine 运行 | 多阶段构建，运行阶段 `chmod -R a+rX` |

## 三、路由与功能模块

| 路由 | 页面 | 消费模型 | 主要交互 |
| --- | --- | --- | --- |
| `/arrays` | 台阵与台站台账 | Array、Station、Instrument | 新建/编辑/删除台阵，按布设日期、运行状态与孔径分档筛选；卡片回显台站数、仪器数与标定合格率，可一键按经纬度重算孔径 |
| `/stations/:id/instruments` | 台站仪器登记与安装位置维护 | Station、Instrument | 新增/编辑/删除台站（经纬度范围校验 + 度分秒显示、基岩类型、高程），登记仪器（类型/型号/序列号**唯一性校验**/安装日期/状态），登记后自动生成下一次标定待办 |
| `/calibrations` | 标定记录台 | Calibration、Instrument | 录入灵敏度、自噪与脉冲响应结论（按类型区间自动初判）、灵敏度相对上次的变化、批量改结论、灵敏度趋势折线图 |
| `/replacements` | 合格评定与更换提醒 | Replace、Calibration、Instrument | 按 365 天标定周期评定，超期未标定与不合格仪器高亮；登记更换并推进状态机（待更换→已更换→已复核），流转到「已更换」时回写仪器序列号 |
| `/surveys` | 测量组复测坐标对账台 | SurveyCoord、Station | 录入平板复测实测坐标（度分秒可反解十进制）；按台站码与中心名册对账，名册没有的挂起「待确认」可重试；中心「认账」后进入孔径口径（认下不退回，终态不可改删） |
| `/geometry` | 台阵几何视图与结构版本 | 全部模型 | 孔径/几何图/辐射距离统一按**中心口径**（最新已认账复测坐标优先、未认账回退初设），可一键按中心口径重算全部孔径与分档、SVG 平面图、结构版本查看、全量 JSON（六表）导入导出 |

带 `:id` 的层级路由在直接深链访问时同样可用：若 IndexedDB 中查不到该台阵，页面渲染 `<RouteMissingPanel>` 友好空态（含「返回台阵台账」与可用 id 快捷跳转），不会白屏。

## 四、目录结构

```
sologsb101-1012/
├── README.md
├── docker-compose.yml          # name: gbseisarray，不写 version
├── Dockerfile                  # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
├── nginx.conf                  # try_files $uri $uri/ /index.html; + gzip
├── .env / .env.example         # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── .gitignore
└── frontend/
    ├── Dockerfile              # 前端独立构建用（同样多阶段 + chmod -R a+rX）
    ├── nginx.conf              # 前端独立托管用
    ├── .dockerignore
    ├── package.json            # build = tsc --noEmit && vite build
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    ├── public/favicon.svg
    └── src/
        ├── main.tsx            # Provider + ConfigProvider + RouterProvider
        ├── App.tsx             # 侧边导航 + 顶部上下文条 + 页脚，并启动各表订阅
        ├── types/              # array / station / instrument / calibration / replace / survey / filter
        ├── stores/             # arraySlice / instrumentSlice / calibrationSlice / surveySlice / store.ts
        ├── components/common/  # QualifyTag / FilterBar / StatBadge / EmptyPanel / RouteMissingPanel / ReconcileTag
        ├── hooks/              # useIdbTable / useCalibHistory
        ├── pages/              # ArrayList / StationInstruments / CalibrationBoard / ReplaceBoard / GeometryView / SurveyBoard
        ├── router/index.tsx    # 路由表（路径与提示词逐字一致）
        ├── styles/main.css
        └── utils/              # geo.ts（Haversine/孔径/度分秒解析）/ db.ts（Dexie 封装）/ export.ts（导入导出与结论）/ reconcile.ts（按码对账与中心口径）
```

## 五、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:22812
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览构建产物
```

## 六、数据存储说明

- **存储位置**：浏览器 IndexedDB，库名 `gbseisarray`，当前结构版本 `v3`。读写统一经 `frontend/src/utils/db.ts` 封装，页面组件不直接触碰 Dexie 实例。
- **数据表（六张）**：`arrays`（台阵）、`stations`（中心台站台账：归属/初设坐标）、`instruments`（仪器）、`calibrations`（标定）、`replaces`（更换）、`surveyCoords`（**测量组复测坐标，与中心台账分开管**）。
- **两份分开管的坐标口径**：实测坐标认测量组（`surveyCoords.lat/lng`），台站归属（`arrayId`）与孔径分档认中心（`arrays`/`stations`）。两边只按台站码 `code` 对账（复测记录不绑定台站 id）。
- **复测对账状态机**：`待对账 →（按 code 对账）→ 待认账 →（中心认账）→ 已认账`；中心名册没有该码时挂起 `待确认`，由测量组核对后**重试对账**（计 `retryCount`）。`已认账` 为终态：进入中心孔径口径，**认下不退回**、不可改删。台站迁走后复测坐标仍跟台站码，同码取**最新一次已认账**，旧认账保留追溯。
- **孔径重算口径**：一律按「中心手里那份」——每个台站码有已认账复测则用复测坐标，否则回退中心初设坐标；未认账/挂起复测不参与。可在 `/geometry` 一键重算全部台阵，或在台站仪器页重算单台阵。
- **升级迁移**：`v1` 保留初版结构；`v2` 补齐索引并回填历史缺失字段；`v3` 新增 `surveyCoords` 表，并把「只有度分秒」的旧复测经 `geo.parseDms()` 解析**补出十进制 lat/lng**（补不出的留 0、不参与孔径）。调整字段结构时递增 `DB_VERSION` 并补迁移。
- **首屏播种**：`initDatabase()` 在 `arrays` 表为空时幂等播种：2 个台阵 / 5 个台站 / 8 台仪器 / 14 条标定 / 3 条更换 / 7 条复测（含同码两次认账的迁址样本 LTX01、待认账 LTX03、挂起 HX99、待对账 LTX04、仅度分秒的 HX01 旧记录），覆盖对账各状态。
- **实时同步**：`utils/db.ts` 的 `watchTable()` 基于 Dexie `liveQuery` 订阅表变化，`App.tsx` 挂载时启动订阅并把数据 dispatch 到 Redux slice，页面只读 selector。
- **业务规则**：标定周期 365 天（超期即在更换提醒页高亮）；响应结论自动初判规则为「灵敏度落在类型区间内（宽频带 800~3000、短周期 100~800、强震 0.1~5）且自噪 ≤ 3.5」，最终以标定报告为准；仪器序列号全局唯一；更换状态机为 待更换 → 已更换 → 已复核，流转到「已更换」时把新序列号回写到仪器档案并置为在用。
- **备份与恢复**：`/geometry` 页可导出包含六张表的 JSON 快照（旧备份缺 `surveyCoords` 时按空数组兼容），支持「覆盖导入」与「追加导入（重新分配 id；复测记录只换 id、台站码保留以便重新对账）」；备份时间写入 `localStorage`，页脚与几何页均展示结构版本号。
- **离线可用**：应用为纯静态资源，无任何网络请求；换浏览器或清空站点数据后数据不跟随，需通过 JSON 备份迁移。
