/* Offline UI localization. Only source-authored literals and the initial static
   shell are translated. Interpolated project names, titles, task excerpts and
   model identifiers are never passed through the catalog. */
(() => {
  'use strict';
  const en = {
    'Codex · AI 工作台':'Codex Office · Workspace',
    '工作台导航':'Workspace navigation','Codex 工作台首页':'Codex workspace home','主导航':'Primary navigation',
    '跳转到内容':'Skip to content','工作空间':'Workspace','总览':'Overview','Agent 画布':'Agent canvas',
    '项目':'Projects','模型':'Models','探索分析':'Explore','数据与口径':'Data & methodology',
    '用量总览':'Usage overview','Agent 工作画布':'Agent workspace','项目投入':'Project spend','模型使用':'Model usage',
    '了解投入，追踪变化，让每一份用量清晰可见。':'Understand spending, follow trends, and see where your usage goes.',
    '跨项目查看会话编排、代理组织与当前工作。':'Observe chat orchestration, agent relationships, and current work across projects.',
    '从投入分布到项目详情，找到用量背后的变化。':'Explore spending patterns and the usage behind each project.',
    '查看模型用量、成本构成与代理分工。':'Compare model usage, estimated costs, and agent roles.',
    '在同一筛选范围内，从更多角度理解你的用量。':'Explore more perspectives using the same shared filters.',
    '了解数据完整性、计价覆盖与每个指标的含义。':'Understand data completeness, pricing coverage, and each metric.',
    '本地快照':'Local snapshot','本地服务 · 用量快照':'Local service · Usage snapshot',
    '重新载入已生成的报表':'Reload the already generated report','重新载入报表':'Reload report',
    '快照生成时间':'Snapshot generated','全局筛选':'Global filters','时间范围':'Date range',
    '今天':'Today','昨天':'Yesterday','近 7 天':'Last 7 days','近 30 天':'Last 30 days','近 90 天':'Last 90 days',
    '全部历史':'All history','自定义日期':'Custom dates','全部项目':'All projects','全部模型':'All models',
    '项目筛选':'Project filter','模型筛选':'Model filter','重置':'Reset','开始日期':'Start date','结束日期':'End date',
    '应用日期':'Apply dates','全部项目 · 全部模型':'All projects · All models','已计价 Token':'Priced tokens',
    'API 等价估算':'API-equivalent estimate','API 等价金额':'API-equivalent cost',
    '根据已匹配的 API 价格折算，不是套餐实际账单':'Estimated using matched API prices; not your subscription bill',
    '已知价格部分 · 非实际账单':'Known-price portion · Not an actual bill','总 Token':'Total tokens',
    '输入 + 输出':'Input + output','模型续跑':'Model continuations',
    '累计用量正向变化次数，包含工具调用后的继续执行，不等于用户任务数或标准 API 请求数':'Positive cumulative usage increments, including continuations after tools; not user tasks or standard API requests',
    '模型继续执行的次数':'Number of model continuations','缓存命中率':'Cache hit rate','命中 Token / 输入 Token':'Cached tokens / Input tokens',
    '用量趋势':'Usage trend','每天的用量变化':'Daily usage','趋势指标':'Trend metric','金额':'Cost','续跑':'Continuations',
    '已计价金额':'Priced cost','悬浮或聚焦日期查看用量，点击查看当天明细。':'Hover or focus a date to see usage; click for the daily breakdown.',
    '值得关注':'Highlights','当前范围':'Selected range','启用 JavaScript 查看当前范围的分析。':'Enable JavaScript to explore the selected range.',
    '主要投入项目':'Top projects by spend','按已计价金额排序 · 未计价部分单独标注':'Ranked by priced cost · Unpriced usage marked separately',
    '全部项目 ↗':'All projects ↗','模型使用分布':'Model distribution','按总 Token 占比':'Share of total tokens','模型详情 ↗':'Model details ↗',
    '用量明细（前 50 行）':'Usage details (first 50 rows)','日期':'Date','当前为静态快照。启用 JavaScript 后可使用筛选、图表和完整明细。':'This is a static snapshot. Enable JavaScript for filters, charts, and full details.',
    '本地观察快照':'Local observation snapshot','刷新状态':'Refresh status','暂停更新':'Pause updates','进入专注画布':'Enter focused canvas',
    '隐藏导航与用量筛选，最大化画布；Esc 退出':'Hide navigation and usage filters; press Esc to exit',
    '专注画布 ⛶':'Focus canvas ⛶','退出专注 ⛶':'Exit focus ⛶','退出专注画布':'Exit focused canvas',
    'Agent 组织画布':'Agent organization canvas','画布筛选与操作':'Canvas filters and controls','画布场景':'Canvas scene',
    '拟人化员工与项目工位':'Human-like employees and project workspaces','办公室':'Office','监狱':'Prison','关系图':'Graph',
    '趣味监狱外观，不改变 Agent 权限':'A playful prison theme; agent permissions are unchanged','原有组织关系图':'Original organization graph',
    '观察范围':'Observation window','当前与最近工作':'Current & recent work','最近 24 小时':'Last 24 hours','最近 7 天':'Last 7 days',
    '全部会话（含归档）':'All chats (including archived)','代理状态':'Agent status','状态':'Status','全部状态':'All statuses',
    '执行中':'Working','等待回应':'Waiting for response','待确认 / 失败':'Unconfirmed / Failed','查找':'Search','查找会话 / Agent':'Find a chat / agent',
    '搜索 Agent':'Search agents','协作连线':'Collaboration links','折叠分支':'Collapse branches','展开分支':'Expand branches',
    '三维场景暂不可用':'3D scene unavailable','当前浏览器没有可用的 WebGL2，或图形上下文暂时丢失。原关系图与任务详情仍可使用。':'WebGL2 is unavailable or the graphics context was lost. The organization graph and task details are still available.',
    '打开关系图':'Open graph','缩小画布':'Zoom out','放大画布':'Zoom in','适应画布':'Fit canvas','适应':'Fit',
    '定位正在执行的 Agent':'Locate a working agent','执行待确认':'Work status unconfirmed','图例与口径':'Legend & methodology',
    '图例与口径 ⌃':'Legend & methodology ⌃','场景与员工':'Scenes & employees','组织关系':'Organization',
    '会话业务委托':'Cross-chat delegation','会话内 subagent':'In-chat subagent','历史协作记录':'Historical collaboration',
    '下游分支状态':'Downstream status','近期执行 · 流动':'Recent work · Flow','等待 · 缓慢呼吸':'Waiting · Slow pulse',
    '本轮已结束 · 静止':'Turn ended · Still','待确认 · 点线':'Unconfirmed · Dotted','失败 · 静止':'Failed · Still',
    '当前状态来自本地记录；日期筛选只影响节点的用量，不改变当前组织结构。':'Status comes from local records. Date filters affect node usage, not the current organization.',
    '本轮结束不等于项目完成。发起记录与当前业务上级分别保留。':'A completed turn does not mean a completed project. Creation history and current business parent are kept separately.',
    '一个员工对应一个真实主 Agent 或 Subagent，一个办公区对应一个项目。执行中的员工会敲键盘、抬头看屏幕和使用鼠标，并有身体辉光、地面光环与头顶光点；这些动作是近期执行记录的拟人化表现，不是真实操作的逐项还原。气泡只展示任务短摘录与可确认的活动记录，不展示内部思考过程；空间不足时简化为状态提示，悬浮、聚焦或点选后展开。默认去掉人物 ID 尾号，姓名和分支在检查时显示。“定位执行”依次定位当前筛选中的执行员工。人物与桌椅均为真实三维对象，监狱仅是外观主题，不改变身份和权限。':'Each employee represents a real main agent or subagent; each workspace represents a project. Typing, looking at screens, mouse use, and glow effects illustrate recent execution records, not a replay of actual actions. Bubbles show short task excerpts and observable activities, never internal reasoning. When space is limited, hover, focus, or select to expand. ID suffixes are hidden; names and branches appear on inspection. Locate working cycles through working employees in the current filters. People and furniture are real 3D geometry. The prison is a visual theme only, with no permission changes.',
    '同色工位表示会话归属，上方青色连线表示会话内关系，金色表示独立会话间的业务委托，箭头指向下游。人物反映自身状态，连线反映下游分支状态；绿色流动仅表示近期记录，不代表消息传输或任务合并。暂停、离线、连接中断或过期时停止执行动作与光效，只保留最后记录。系统“减少动态效果”会禁用动画，但保留可信执行状态的静态提示。关系图保留完整组织树。':'Matching desk colors show chat ownership. Cyan links indicate in-chat relationships; gold links indicate business delegation between independent chats. Arrows point downstream. Employees show their own state; links show downstream branch state. Green flow indicates recent records, not message transfer or task merging. Motion and glow stop when paused, offline, disconnected, or stale. Reduced-motion preferences disable animation while retaining static indicators of observed work. The graph retains the full organization tree.',
    '拖动平移 · ⌘ / Ctrl + 滚轮缩放 · 0 适应 · 连线活动为记录观察':'Drag to pan · ⌘ / Ctrl + wheel to zoom · 0 to fit · Link activity is record-based',
    '左键旋转 · 右键 / Shift + 拖动平移 · 滚轮缩放 · 点选人物 · 0 适应':'Left-drag to rotate · Right / Shift-drag to pan · Wheel to zoom · Select a person · 0 to fit',
    '代理详情':'Agent details','项目分析':'Project analysis','项目投入排行':'Project spend ranking',
    '投入规模不代表业务价值或 ROI':'Spending does not measure business value or ROI','搜索项目':'Search projects','项目排序':'Project sort',
    '按已计价金额':'By priced cost','按总 Token':'By total tokens','按续跑次数':'By continuations','计价覆盖':'Pricing coverage',
    '趋势':'Trend','没有匹配的项目，请调整筛选。':'No matching projects. Adjust your filters.','模型分析':'Model analysis',
    '代理使用分布':'Agent distribution','主代理与子代理的 Token、续跑及已计价金额':'Tokens, continuations, and priced cost for main agents and subagents',
    '选择一个常用视图，或自由组合统计维度与指标。':'Choose a preset or combine dimensions and metrics.','常用分析':'Analysis presets',
    '缓存表现':'Cache performance','每日趋势':'Daily trend','使用时段':'Usage hours','代理分工':'Agent roles','未计价用量':'Unpriced usage',
    '统计维度':'Dimension','衡量指标':'Metric','排序':'Sort','指标从高到低':'Metric: high to low','指标从低到高':'Metric: low to high',
    '按维度顺序':'Dimension order','探索展示方式':'Explore display mode','图表':'Chart','表格':'Table',
    '未匹配价格的模型':'Models without matched prices','Token 和续跑仍完整统计，金额显示“未计价”。覆盖率跟随全局筛选。':'Tokens and continuations are still counted; cost is shown as Unpriced. Coverage follows the global filters.',
    '统计口径':'Methodology','金额如何计算？':'How is cost calculated?',
    'API 等价估算是按本地价格快照折算的已计价小计，不是 ChatGPT / Codex 套餐实际账单。未缓存输入、缓存读取、缓存写入、输出分别使用对应单价；未匹配价格的用量不计入金额。':'API-equivalent estimates use a local price snapshot for the priced subtotal; they are not ChatGPT or Codex subscription bills. Uncached input, cache reads, cache writes, and output use their respective rates. Unmatched usage is excluded from the amount.',
    '缓存命中率与缓存节省':'Cache hit rate & savings',
    '缓存命中率 = 缓存读取 Token ÷ 输入 Token。请求命中率 = 发生缓存读取的模型续跑 ÷ 总续跑。缓存命中是服务端读取，不是本地文件缓存。缓存节省是同一已计价用量相对于无缓存输入价格的理论差额，不是实际退款。':'Cache hit rate = cached input tokens / input tokens. Request hit rate = continuations with cache reads / all continuations. Cache hits are server-side reads, not a local file cache. Savings are the theoretical difference against uncached input prices for the same priced usage, not a refund.',
    '模型续跑、会话和推理 Token':'Continuations, chats & reasoning tokens',
    '模型续跑指累计 Token 正向变化一次，包含使用工具后继续执行；不等于用户任务数或标准 API 请求数。会话按当前范围内不同会话去重。推理 Token 是输出的一部分，不重复计费。':'A continuation is one positive change in cumulative tokens, including execution after a tool. It is not a user task or standard API request. Chats are deduplicated within the selected range. Reasoning tokens are part of output and are not billed twice.',
    '筛选、比较与数据更新':'Filters, comparisons & updates',
    '所有页面使用同一组日期、项目和模型筛选。对比使用紧邻所选范围的前一个等长周期；若包含未结束的今天、前期历史不足或计价覆盖差异超过 2 个百分点，将标明不可直接比较。':'All pages share date, project, and model filters. Comparisons use the immediately preceding equal-length period. Incomplete today, insufficient history, or a pricing coverage difference over 2 percentage points makes a comparison unreliable and is marked accordingly.',
    '报表是本地离线快照，每日任务运行后更新。右上角重新载入会读取最新生成的文件，不会触发扫描。来源记录只保存安全元数据，不包含对话正文。':'The report is a local offline snapshot, updated by the daily task. Reload reads the newest generated file without scanning. Usage records retain metadata, not conversation bodies.',
    '当日用量':'Daily usage','关闭当日明细':'Close daily details','仅查看这一天':'Filter to this day',
    '周一':'Mon','周二':'Tue','周三':'Wed','周四':'Thu','周五':'Fri','周六':'Sat','周日':'Sun',
    '项目 × 模型':'Project × Model','月份':'Month','星期':'Weekday','小时':'Hour','星期 × 小时':'Weekday × Hour',
    '工作目录':'Working directory','主 / 子代理':'Main agent / Subagent','子代理角色':'Subagent role','来源入口':'Source surface',
    '发起端':'Originator','推理等级':'Reasoning effort','Codex 版本':'Codex version','模型供应商':'Model provider','上下文窗口':'Context window',
    '缓存命中 Token':'Cached input tokens','缓存节省估算':'Estimated cache savings','输入 Token':'Input tokens','未缓存输入 Token':'Uncached input tokens',
    '缓存写入 Token':'Cache-write tokens','输出 Token':'Output tokens','推理 Token':'Reasoning tokens','推理占输出':'Reasoning / Output',
    '请求命中率':'Request hit rate','会话数':'Chats','未计价续跑':'Unpriced continuations','未计价 Token':'Unpriced tokens',
    '平均每次 Token':'Average tokens / Continuation','每次已计价续跑金额':'Priced cost / Continuation','理论额外节省上限':'Theoretical extra savings ceiling',
    '未知':'Unknown','未计价':'Unpriced','部分未计价':'Partly unpriced',' · 查看缺失':' · Review missing prices','暂无用量 · 查看口径':'No usage · View methodology',
    '项目详情':'Project details','含快照当日，周期尚未结束':'Includes snapshot day; period is incomplete',
    '所选范围超出快照日期':'Range extends beyond the snapshot date','前期历史不足，暂不计算环比':'Insufficient previous history for comparison',
    '前期无用量，暂无环比':'No previous usage to compare','对比 ':'Compared with ','已知价格部分 · 另有 ':'Known-price portion · Another ',
    ' Token 未计价':' tokens unpriced','按 API 价格折算 · 非实际账单':'API-equivalent · Not an actual bill',
    '输入 ':'Input ',' · 输出 ':' · Output ',' 个会话 · ':' chats · ',' 个项目':' projects',
    '累计 Token 正向变化次数':'Positive cumulative token increments','命中 ':'Cached ',' / 输入 ':' / Input ',
    '前期为 0，暂无环比':'Previous usage is zero; no comparison','较前期 ':'vs. previous period: ','其中推理 ':'Reasoning: ',
    '所选周期日均 ':'Daily average: ',' 次续跑':' continuations','尚无可计价用量':'No priced usage yet',
    '前后期价格覆盖不同，金额暂不比较':'Pricing coverage differs; cost is not compared','缓存折价节省约 ':'Estimated cache savings: ',
    '缓存读取量已计入输入 Token':'Cache reads are included in input tokens',
    '金额仅含已计价部分；琥珀色标记表示当天存在未计价用量。点击日期查看明细。':'Cost includes priced usage only. Amber dots mark days with unpriced usage. Click a date for details.',
    '当前范围暂无用量。':'No usage in this range.','试试扩大日期范围。':'Try a wider date range.',
    '投入集中在哪':'Where usage concentrates',' 的 Token':' of tokens','查看项目详情 →':'View project details →',
    '金额尚不完整':'Cost is incomplete',' Token 尚未计价':' tokens unpriced','涉及 ':'Across ',
    ' 次续跑，估算金额只含已匹配价格的部分。':' continuations; estimates include matched prices only.',
    '查看未计价模型 →':'View unpriced models →','缓存使用情况':'Cache usage',' 的输入命中缓存':' of input served from cache',
    '按当前价格，相比无缓存输入基准节省约 ':'Estimated savings against uncached input at current prices: ',
    '查看项目缓存表现 →':'View project cache performance →','用量最高的一天':'Peak usage day','已计价 ':'Priced ',
    '用量尚未计价':'Usage is unpriced','查看当天构成 →':'View daily breakdown →','当前范围暂无数据':'No data in this range',
    '各模型 Token 占比':'Token share by model',' · 含未计价用量':' · Includes unpriced usage',
    '当前范围暂无用量，请调整筛选。':'No usage in this range. Adjust your filters.',
    '当前用量尚未计价。':'This usage is not priced yet.','切换到 Token 或续跑次数查看趋势。':'Switch to tokens or continuations to see the trend.',
    '每月':'Monthly ','每日':'Daily ','点击查看该月':'Click for this month','点击查看当天构成':'Click for the daily breakdown',
    '，查看明细':'; View details','Token 趋势':'Token trend','显示 ':'Showing ','收起至前 10 项':'Show top 10','查看全部项目':'Show all projects',
    ' 个模型 · ':' models · ',' 个会话':' chats','按 Token':'By tokens','返回项目列表':'Back to projects',
    '项目每日 Token':'Daily project tokens','与全局筛选同步':'Uses global filters','点击日期，查看当日模型贡献。':'Click a date to see model contributions.',
    '模型贡献':'Model contributions','项目用量明细':'Project usage details','按日期与模型聚合 · 最近 50 项':'Grouped by date and model · Latest 50 rows',
    '探索全部明细 →':'Explore all details →','计价覆盖 ':'Pricing coverage: ',' 命中 Token':' cached tokens',
    '当前筛选下暂无用量':'No usage for these filters','使用中的模型':'Models used',' 次模型续跑':' model continuations','Token 覆盖 ':'Token coverage: ',
    ' 次续跑尚未计价':' continuations unpriced','未匹配价格':'No matched price','部分已计价':'Partly priced','已匹配价格':'Price matched',
    'API 等价估算 · Token 占比 ':'API-equivalent · Token share: ','当前价格快照未匹配 · 用量仍完整统计':'No match in the price snapshot · Usage still counted',
    '仅分析此模型 →':'Filter to this model →','当前范围暂无模型用量':'No model usage in this range',
    ' · 仅显示存在未计价用量的分组':' · Only groups with unpriced usage',
    ' · 乐观上限：假设全部输入均命中缓存，不代表实际可节省金额':' · Optimistic ceiling assuming all input is cached; not achievable savings',
    '个时段':'hour slots','项':'items','时间图始终按日期排列；超过 120 天自动按月聚合。可切换表格查看精确数值。':'Time charts use chronological order; ranges over 120 days group by month. Switch to the table for exact values.',
    '当前范围没有匹配的数据':'No matching data in this range','图表展示前 24 项，全部结果见表格。':'Chart shows the top 24 items. See the table for all results.',
    '悬浮或聚焦查看 Token、续跑次数与金额。':'Hover or focus to see tokens, continuations, and cost.',' 未计价不等于零消耗。':' Unpriced does not mean zero usage.',
    '此快照没有小时级数据，请重新生成报表。':'This snapshot has no hourly data. Regenerate the report.',
    '颜色越深，当前指标越高。同一星期、同一小时的用量合并展示。':'Darker cells mean higher values. Usage is combined by weekday and hour.',
    '高 · 琥珀色为未计价':'High · Amber means unpriced','低':'Low','共 ':'Total: ',' 项 · 第 ':' items · Page ',' 页':'',
    '上一页':'Previous','下一页':'Next','Token 计价覆盖':'Token pricing coverage','续跑计价覆盖':'Continuation pricing coverage',
    ' 次续跑未计价':' continuations unpriced','缓存请求命中率':'Cache request hit rate',' 次续跑命中缓存':' continuations with cache hits',
    '当前范围没有未计价用量。':'No unpriced usage in this range.','价格快照版本：':'Price snapshot: ','。报表生成于 ':'. Report generated: ',
    '查看价格来源 ↗':'View pricing source ↗','当前范围记录到 ':'Recorded in this range: ',' 个缓存写入 Token。':' cache-write tokens.',
    '当前范围观察到 0 个缓存写入 Token；可能确实无写入，也可能数据源未提供该字段。':'No cache-write tokens were observed in this range. There may be no writes, or the source may not provide this field.',
    '用量构成':'usage breakdown','含未计价用量':'Includes unpriced usage',' 次':' continuations',
    '开始日期不能晚于结束日期':'Start date cannot be after end date','请选择 100 年以内的日期范围':'Choose a range within 100 years',
    '当前快照没有 Agent 数据，请重新生成报表。':'This snapshot has no agent data. Regenerate the report.',
    '活动时间未知':'Activity time unknown','刚刚':'Just now',' 分钟前':' min ago',' 小时前':' hr ago',' 天前':' days ago',
    '状态待确认':'Status unconfirmed','最近活动超过 5 分钟，不能据此确认仍在运行或判断卡住':'Last activity is over 5 minutes old; ongoing execution or a stalled state cannot be confirmed',
    '主 Agent · 编排':'Main agent · Orchestrator','主 Agent':'Main agent',' 续跑':' continuations','当前用量范围暂无记录':'No records in the usage range',
    '独立会话':'Independent chat',' · 关联结构':' · Relationship context',' 分支':' branches','展开':'Expand','收起':'Collapse',
    ' 活动':' active',' 个历史 subagents':' historical subagents','无当前分支':'No current branches',' 会话 · ':' chats · ',' 执行 / 等待':' working / waiting',
    'Agent 虚拟办公室画布':'Agent virtual office canvas','Agent 趣味监狱画布':'Agent prison-themed canvas','会话':'Chats','活动':'Active',
    '已暂停自动观察':'Auto-observation paused','本地观察 · ':'Local observation · Every ',' 秒更新':'s',
    '连接中断 · 保留最后观察':'Disconnected · Last observation retained','离线观察快照':'Offline observation snapshot','观察于 ':'Observed at ',
    '继续更新':'Resume updates','定位执行 · ':'Locate working · ','暂无执行':'No observed work',
    '按当前项目、模型和状态筛选，依次定位近期有执行记录的 Agent':'Cycle through agents with recent work records in the current project, model, and status filters',
    '观察已暂停或不可确认，不推断仍在执行':'Observation paused or unconfirmed; ongoing execution is not inferred',
    '重新载入':'Reload','状态来自本地回合记录，非运行时订阅。':'Status comes from local turn records, not a runtime subscription.',
    '观察服务失去连接，保留最后记录；可以点击刷新状态重试。':'Disconnected from the observation service. Last records retained; refresh to retry.',
    '离线快照不能持续观察；双击 run-workspace.command 启动本地服务。':'Offline snapshots cannot observe continuously. Run run-workspace.command to start the local service.',
    ' 日期只筛选节点用量；任务说明为本轮请求短摘录或会话标题。':' Dates filter node usage only. Task descriptions are short current-request excerpts or chat titles.',
    '节点金额为自身用量，不包含下属；范围 ':'Node costs are own usage, excluding descendants; range ',
    '，用量快照 ':', usage snapshot ','.* 表示部分未计价。本轮结束不等于项目完成。':'. * means partly unpriced. A turn ending does not mean the project is complete.',
    '。* 表示部分未计价。本轮结束不等于项目完成。':'. * means partly unpriced. A turn ending does not mean the project is complete.',
    '当前范围没有匹配的工作':'No matching work in this range',
    '可以查看最近会话，或调整项目、模型和状态筛选。':'View recent chats or adjust project, model, and status filters.',
    '可以查看最近的会话，或调整项目、模型和状态筛选。':'View recent chats or adjust project, model, and status filters.',
    '查看最近 24 小时':'View last 24 hours','下游分支近期执行（本地记录观察）':'Recent downstream work (local-record observation)',
    '下游等待代理':'Downstream waiting for agents','下游等待确认':'Downstream waiting for confirmation',
    '下游本轮已结束，不代表已合并':'Downstream turn ended; does not imply a merge','下游有失败记录':'Downstream failure recorded',
    '下游状态待确认':'Downstream status unconfirmed','下游已中断':'Downstream interrupted','下游已归档':'Downstream archived',
    '历史协作记录，不代表正在传输':'Historical collaboration; does not imply live transfer','业务委托':'Business delegation','会话内代理':'In-chat agent','协作':'Collaboration',
    '观察数据暂不可确认，恢复连接后再保存。':'Observation is unconfirmed. Reconnect before saving.',
    '定位 ':'Locate ','主':'Main','归属主 Agent':'Owning main agent','直接上级 Subagent':'Direct parent subagent',
    '会话内下属':'In-chat children','业务上级':'Business parent','委托的独立会话':'Delegated independent chats',
    '关闭代理详情':'Close agent details','当前主要任务 · ':'Current main task · ','最近活动':'Last activity','发起会话':'Initiating chat',
    '自身用量 · ':'Own usage · ','API 等价已计价小计':'Priced API-equivalent subtotal','当前组织分支合计（含自身）：':'Current branch total (including self): ',
    '。结果返回不代表已经验收或合并。':'. Returned results do not imply acceptance or merging.',
    '打开原会话 ↗':'Open original chat ↗','查看项目用量 ↗':'View project usage ↗','身份与数据来源':'Identity & source','会话 ID：':'Chat ID: ',
    '状态来自本地最新回合记录；不是对运行进程的确定性探测。只展示标题、代理组织和安全元数据，不展示完整聊天、思考过程或命令输出。':'Status comes from the latest local turn records, not a definitive process probe. Only titles, organization, and metadata are shown; never full chats, reasoning, or command output.',
    '独立会话 · 主 Agent':'Independent chat · Main agent','会话内 Subagent':'In-chat subagent','本轮请求短摘录':'Short current-request excerpt','会话标题':'Chat title',
    'Agent 连接关系':'Agent relationships','不适用；这是会话内代理':'Not applicable; this is an in-chat agent','独立编排 / 未指定':'Independent / Not assigned',
    '没有可确认的发起记录':'No confirmed creation record','归属会话':'Owning chat','归属待确认':'Ownership unconfirmed',
    '业务编排 · ':'Business orchestration · ','只修改工作台的业务关系，不修改原会话，不发送任何 Agent 指令。':'Only changes workspace business relationships. It does not modify chats or send agent instructions.',
    '无上级 · 独立编排':'No parent · Independent','保存业务层级':'Save business hierarchy','恢复自动':'Restore automatic',
    '手动指定':'Manually assigned','按发起记录组织':'Organized by creation records',
    '观察数据暂不可确认，恢复后再保存。':'Observation is unconfirmed. Reconnect before saving.','请通过本地服务打开后修改。':'Open through the local service to edit.',
    '本地服务不可用':'Local service unavailable','无效的观察数据':'Invalid observation data','正在保存…':'Saving…','保存失败':'Save failed',
    '已保存，仅影响工作台业务层级。':'Saved. Only the workspace business hierarchy was changed.',
    '可旋转的三维 Agent 办公空间':'Rotatable 3D agent workspace',' 主 Agent / ':' main agents / ','主 Agent · ':'Main agent · ',
    '归属主 Agent：':'Owning main agent: ','归属主 Agent 待确认':'Owning main agent unconfirmed',
    '独立会话；会话间连接为业务委托':'Independent chat; cross-chat links are business delegations',
    '离线记录':'Offline record','暂停观察':'Observation paused','观察待确认':'Observation unconfirmed','最后记录':'Last record',
    '等待代理':'Waiting for agents','等待确认':'Waiting for confirmation','本轮失败':'Turn failed',' · 记录观察':' · Record-based observation',
    ' 位员工 · ':' employees · ',' 个项目办公区':' project workspaces',' 位正在执行':' working','观察已暂停':'Observation paused','执行状态待确认':'Execution unconfirmed',
    '主 → Subagent':'Main → Subagent','执行中 · 记录观察':'Working · Record-based observation','本轮已结束':'Turn ended',
    '已中断':'Interrupted','已归档':'Archived','没有可确认的当前回合状态':'No confirmed current-turn status','尚无活动记录':'No activity recorded',
    '执行本地操作':'Running local operations','修改项目文件':'Editing project files','推进当前工作':'Working on the current task',
    '整理工作结果':'Preparing results','查阅资料':'Researching','生成图像':'Generating images','查看图像':'Viewing images',
    '整理会话上下文':'Organizing chat context','处理代理分支动态':'Handling agent branch activity','更新工作计划':'Updating the work plan',
    '会话已归档；不代表业务目标完成':'Chat archived; the business objective may not be complete',
    '最新回合记录；本轮结束不等于整个项目完成':'Latest turn record; a turn ending does not mean the entire project is complete',
    '最近 5 分钟内有未结束回合的活动记录；不是运行时订阅确认':'Activity recorded in an unfinished turn within 5 minutes; not confirmed by a runtime subscription',
    '未结束记录已超过 5 分钟或存在时钟差异；无法确认是否仍在运行，不据此判断卡住':'Unfinished record is over 5 minutes old or clocks differ. Ongoing work is unconfirmed; this does not imply a stall.',
    '等待其他代理返回':'Waiting for other agents','等待用户回应':'Waiting for user response',
    '定时任务更新':'Scheduled task update','使用工具 · ':'Using tool · ','单人隔间':'Single cells','休闲办公室':'Casual office',
    '没有找到本地 Codex 会话数据库':'No local Codex chat database found','读取会话元数据失败：':'Failed to read chat metadata: ',
    '回合或关系记录读取不完整：':'Incomplete turn or relationship records: ','没有回合历史库，无法判断当前执行状态':'No turn-history database; current execution cannot be determined',
    '业务编排配置读取失败：':'Failed to read business hierarchy: ','忽略循环业务关系，相关会话保持独立':'Cyclic business relationships ignored; affected chats remain independent',
    '数据源暂不可读，保留上次观察':'Data source unreadable; last observation retained',
    '业务上下级只能选择存在的独立会话，不能选择 subagent':'Business parents must be existing independent chats, not subagents',
    '这会形成循环委托，请选择其他业务上级':'This would create a delegation cycle. Choose another business parent.',
    '无有效会话数据':'No valid chat data','无法读取当前会话记录':'Unable to read current chat records',
    '，':', ','。':'.','：':': '
  };
  const escapeRE = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const matcher = new RegExp(Object.keys(en).sort((a,b)=>b.length-a.length).map(escapeRE).join('|'),'g');
  const normalize = value => /^en(?:-US)?$/i.test(value||'') ? 'en' : /^zh(?:-CN)?$/i.test(value||'') ? 'zh-CN' : null;
  let locale='zh-CN';
  try {locale=normalize(new URLSearchParams(location.hash.slice(1)).get('lang')) || normalize(new URLSearchParams(location.search).get('lang')) || normalize(localStorage.getItem('codex-office-locale')) || locale;} catch (_) {}
  const translate = source => locale==='en' ? String(source).replace(matcher,key=>en[key]) : String(source);
  // Tagged templates translate literal segments only, never interpolated values.
  function ui(strings,...values) {
    if(typeof strings==='string')return translate(strings);
    return strings.reduce((text,part,index)=>text+translate(part)+(index<values.length?String(values[index]??''):''),'');
  }
  const dictionary = source => new Proxy(source,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);return typeof value==='string'?translate(value):value;}});
  const integer = value => Math.round(value||0).toLocaleString(locale==='en'?'en-US':'zh-CN');
  function compact(value) {
    if(locale==='en')return value>=1e9?(value/1e9).toFixed(2)+'B':value>=1e6?(value/1e6).toFixed(2)+'M':value>=1e3?(value/1e3).toFixed(2)+'K':integer(value);
    return value>=1e8?(value/1e8).toFixed(2)+'亿':value>=1e4?(value/1e4).toFixed(2)+'万':integer(value);
  }
  // Backend-authored status metadata: exact matches and one fixed tool prefix.
  // Arbitrary titles, task excerpts, names, and unknown records stay untouched.
  function systemText(value) {
    if(locale!=='en')return String(value??'');
    if(Object.hasOwn(en,value))return en[value];
    for(const prefix of ['使用工具 · ','读取会话元数据失败：','回合或关系记录读取不完整：','业务编排配置读取失败：'])if(String(value??'').startsWith(prefix))return en[prefix]+String(value).slice(prefix.length);
    return String(value??'');
  }
  const bindings=[];
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()) {
    if(node.parentElement?.closest('script,style,noscript,[data-user-content]'))continue;
    if(/\p{Script=Han}/u.test(node.nodeValue))bindings.push({node,source:node.nodeValue});
  }
  for(const element of document.querySelectorAll('[aria-label],[title],[placeholder]'))for(const attribute of ['aria-label','title','placeholder']) {
    const source=element.getAttribute(attribute);
    if(source&&/\p{Script=Han}/u.test(source))bindings.push({element,attribute,source});
  }
  function applyShell() {
    document.documentElement.lang=locale==='en'?'en':'zh-CN';
    document.title=translate('Codex · AI 工作台');
    for(const binding of bindings)if(binding.node?.isConnected)binding.node.nodeValue=translate(binding.source);else if(binding.element?.isConnected)binding.element.setAttribute(binding.attribute,translate(binding.source));
    const button=document.getElementById('locale-switch');
    if(button){button.querySelector('.locale-code').textContent=locale==='en'?'中':'EN';button.querySelector('.nav-label').textContent=locale==='en'?'切换到中文':'Switch to English';button.setAttribute('aria-label',locale==='en'?'切换到中文':'Switch to English');button.setAttribute('title',locale==='en'?'切换到中文':'Switch to English');}
  }
  function setLocale(value) {
    const next=normalize(value);if(!next||next===locale)return false;locale=next;
    try {localStorage.setItem('codex-office-locale',locale);} catch (_) { /* The URL remains the offline fallback. */ }
    applyShell();window.dispatchEvent(new CustomEvent('codex:locale-change',{detail:{locale}}));return true;
  }
  window.CodexI18n=Object.freeze({ui,translate,dictionary,systemText,integer,compact,setLocale,get locale(){return locale;},get catalog(){return en;}});
  document.getElementById('locale-switch')?.addEventListener('click',()=>setLocale(locale==='en'?'zh-CN':'en'));
  applyShell();
})();
