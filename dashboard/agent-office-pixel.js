/* 2D Pixel Art Multi-Agent Office — crisp pixel sprites, multi-tool desks,
   animated particle effects, office mascot cat, and paired agent conversations. */
(() => {
  'use strict';
  const i18n = window.CodexI18n, ui = i18n.ui;
  const personal = window.CodexOfficePreferences;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hash = v => { let h = 2166136261; for (const c of String(v)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const brief = (v, n = 44) => { const s = Array.from(String(v ?? '').replace(/\s+/g, ' ').trim()); return s.length > n ? s.slice(0, n).join('') + '…' : s.join(''); };

  const TOOL_STYLES = {
    codex:       { label: 'Codex',       short: 'Codex',  emblem: '⬡', color: '#10a37f', jacket: '#148367', trim: '#74e8c4', screen: '#173e38', code: ['#4ade80','#86efac','#34d399'], glow: 'rgba(16,163,127,.32)' },
    claude_code: { label: 'Claude Code', short: 'Claude', emblem: '✴', color: '#d97757', jacket: '#c25e3e', trim: '#f8be9c', screen: '#3b241d', code: ['#fb923c','#fdba74','#fde68a'], glow: 'rgba(217,119,87,.32)' },
    gemini_cli:  { label: 'Gemini CLI',  short: 'Gemini', emblem: '✦', color: '#4285f4', jacket: '#2e67cc', trim: '#9cc3ff', screen: '#1a2747', code: ['#60a5fa','#93c5fd','#a78bfa'], glow: 'rgba(66,133,244,.32)' },
    antigravity: { label: 'Antigravity', short: 'AGY',    emblem: '◎', color: '#7c5cff', jacket: '#5f3fe0', trim: '#c7b8ff', screen: '#241a47', code: ['#c084fc','#a78bfa','#38bdf8'], glow: 'rgba(124,92,255,.36)' },
    cursor:      { label: 'Cursor',      short: 'Cursor', emblem: '▸', color: '#0ea5e9', jacket: '#0c7eb5', trim: '#8fe1ff', screen: '#123042', code: ['#38bdf8','#7dd3fc','#67e8f9'], glow: 'rgba(14,165,233,.32)' },
    opencode:    { label: 'OpenCode',    short: 'Open',   emblem: '>_', color: '#f59e0b', jacket: '#c97c08', trim: '#fde08b', screen: '#3a2b14', code: ['#fbbf24','#fde047','#fb923c'], glow: 'rgba(245,158,11,.32)' },
  };
  const toolStyle = id => TOOL_STYLES[id] || TOOL_STYLES.codex;

  const THEMES = {
    cozy: {
      bg: '#dfe8e2', bgGrid: '#d1ded6', floorA: '#e8d7b9', floorB: '#e1cead', floorSeam: '#cfb994',
      wall: '#f5f1e6', wallShade: '#ddd5c2', wallBorder: '#6b5b49', trim: '#9d7c58',
      windowSkyA: '#a7dcf6', windowSkyB: '#dcf2fc', cloud: '#ffffff',
      rugAlpha: 'rgba(255,255,255,.34)', deskTop: '#c99b68', deskEdge: '#8c643c', deskLeg: '#5a4534',
      signBg: '#234237', signBorder: '#50826d', signText: '#f4fff9', signSub: '#b4dac8',
      ambient: 'rgba(255,236,192,.14)', particle: '#fff6d6', isDark: false,
    },
    cyber: {
      bg: '#0b1220', bgGrid: '#132038', floorA: '#172235', floorB: '#141e30', floorSeam: '#1e2f4a',
      wall: '#1c2942', wallShade: '#111a2e', wallBorder: '#3b5880', trim: '#38bdf8',
      windowSkyA: '#080e1f', windowSkyB: '#162547', cloud: '#38bdf8',
      rugAlpha: 'rgba(56,189,248,.10)', deskTop: '#263854', deskEdge: '#172338', deskLeg: '#0f172a',
      signBg: '#0f1d36', signBorder: '#38bdf8', signText: '#e0f2fe', signSub: '#7dd3fc',
      ambient: 'rgba(99,102,241,.10)', particle: '#7dd3fc', isDark: true,
    },
    garden: {
      bg: '#e2eee6', bgGrid: '#d3e5da', floorA: '#e9ede1', floorB: '#e0e6d6', floorSeam: '#c9d4be',
      wall: '#f5f9f2', wallShade: '#dbe6d5', wallBorder: '#4e6f5b', trim: '#6e9a7c',
      windowSkyA: '#b8e8df', windowSkyB: '#e8f9f0', cloud: '#ffffff',
      rugAlpha: 'rgba(16,163,127,.10)', deskTop: '#d3b289', deskEdge: '#9b7b56', deskLeg: '#5c6b5e',
      signBg: '#214d40', signBorder: '#69b093', signText: '#f2fff8', signSub: '#bce5d4',
      ambient: 'rgba(216,255,226,.14)', particle: '#fbcfe8', isDark: false,
    },
  };

  const SKINS = ['#f3c5a3', '#e6b18a', '#cfa07b', '#a87454', '#f8d5ba'];
  const HAIRS = ['#2b2321', '#543c2e', '#1e293b', '#8d5b3e', '#4c3556', '#7c6f64'];
  const STATUS_COLOR = {
    working: '#10b981', waiting_agents: '#f59e0b', waiting_user: '#f59e0b',
    idle: '#64748b', unknown: '#94a3b8', failed: '#ef4444', interrupted: '#a855f7', archived: '#94a3b8',
  };

  // Rich bilingual dialogue library grounded in real tool / project / activity metadata
  function buildSoloLine(node, locale) {
    const tool = toolStyle(node.agent_tool || 'codex');
    const proj = brief(node.project || 'workspace', 18);
    const model = brief(node.model || '', 20);
    const act = i18n.systemText(node.current_activity || '');
    const isEn = locale === 'en';
    const seed = hash(node.id + ':' + Math.floor(Date.now() / 7000));
    if (node.status === 'working') {
      const zh = [
        `${tool.short} 全速推进「${proj}」：${brief(node.task_summary || act, 26)}`,
        `正在${act || '写代码'}，${model ? model + ' 火力全开 ⚡' : '键盘敲出火星子 ⚡'}`,
        `「${proj}」这段逻辑马上跑通，准备跑回归测试 ✅`,
        tool.short === 'AGY' ? `反重力模式启动！正在重构「${proj}」🚀` :
        tool.short === 'Claude' ? `Claude 细调「${proj}」的每一处边界 ✨` :
        tool.short === 'Gemini' ? `Gemini 长上下文已就绪，全仓检索中 ✦` :
        `Codex 终端连跑中，${proj} 进度稳步上升 💻`,
      ];
      const en = [
        `${tool.short} building ${proj}: ${brief(node.task_summary || act, 28)}`,
        `${act || 'Shipping code'} on ${model || tool.label} ⚡`,
        `Wiring up ${proj} cleanly — unit tests coming right up ✅`,
        tool.short === 'AGY' ? `Antigravity thrusters on for ${proj} 🚀` :
        tool.short === 'Claude' ? `Polishing edge cases across ${proj} ✨` :
        tool.short === 'Gemini' ? `Scanning full repo context for ${proj} ✦` :
        `Codex crunching through ${proj} tasks 💻`,
      ];
      const pool = isEn ? en : zh;
      return pool[seed % pool.length];
    }
    if (node.status === 'waiting_user') {
      return isEn ? `Waiting for your go-ahead on ${proj} 👋` : `「${proj}」这边等你拍板确认一下 👋`;
    }
    if (node.status === 'waiting_agents') {
      return isEn ? `Waiting for subagents to report back… ⏳` : `等子代理同事回报进度中… ⏳`;
    }
    if (node.status === 'failed') {
      return isEn ? `Hit a snag in ${proj} — needs a quick look ⚠️` : `「${proj}」刚才遇到点异常，快来瞅一眼 ⚠️`;
    }
    const idleZh = [
      `本轮已收工，去吧台续杯美式 ☕`,
      `「${proj}」这轮提交稳稳落地，随时待命 ✨`,
      `${tool.short} 缓存热乎着呢，下个需求随时来 🎯`,
      `伸个懒腰～顺便看看邻桌同事在忙啥 👀`,
    ];
    const idleEn = [
      `Turn wrapped! Grabbing a fresh espresso ☕`,
      `${proj} turn complete — standing by for the next one ✨`,
      `${tool.short} prompt cache is warm and ready 🎯`,
      `Stretching out and checking in on the team 👀`,
    ];
    const pool = isEn ? idleEn : idleZh;
    return pool[seed % pool.length];
  }

  function buildPairedDialogue(a, b, relation, locale) {
    const isEn = locale === 'en';
    const ta = toolStyle(a.agent_tool || 'codex').short;
    const tb = toolStyle(b.agent_tool || 'codex').short;
    const na = brief(personal.name(a), 14);
    const nb = brief(personal.name(b), 14);
    const proj = brief(a.project || b.project || 'project', 16);
    const idx = hash(a.id + '|' + b.id + '|' + Math.floor(Date.now() / 6000));

    if (relation === 'hierarchy') {
      const zh = [
        [`@${nb} 「${proj}」这块分支交给你深入排查一下！`, `收到 @${na}！已经在逐文件核对并验证测试 🔍`],
        [`@${nb} 那边的修改进展顺利吗？主干准备合入了`, `快好了 @${na}！最后确认一下样式和边界条件 ✨`],
        [`@${nb} 帮我补一组回归用例，别漏掉异常分支`, `没问题 @${na}，用例马上跑绿 ✅`],
      ];
      const en = [
        [`@${nb} can you take a deep pass on this ${proj} branch?`, `On it @${na}! Auditing every edge case now 🔍`],
        [`@${nb} how is that subtask looking for ${proj}?`, `Almost ready @${na}! Doing one final polish ✨`],
        [`@${nb} mind adding regression checks before we wrap?`, `Already writing them @${na} — green build incoming ✅`],
      ];
      return (isEn ? en : zh)[idx % zh.length];
    }
    if (ta !== tb) {
      const zh = [
        [`@${nb} (${tb}) 我这边 ${ta} 刚把核心逻辑整理好，交棒给你！`, `收到！${tb} 接手继续打磨「${proj}」的体验 🚀`],
        [`${ta} + ${tb} 联手推进「${proj}」，这波配合真丝滑 ✨`, `哈哈，各发挥所长，缓存命中率都飙高了 ⚡`],
        [`@${nb} 你那边长上下文读完了没？`, `搞定了！关键架构脉络已同步，可以直接开工 📚`],
        [`休息两分钟？我去咖啡机打两杯拿铁 ☕`, `太棒了！加一份浓缩，马上继续肝「${proj}」🔥`],
        [`@${nb} 帮我 Cross-Review 一下「${proj}」这段 diff？`, `火速来审！${tb} 视角帮你把边界全兜住 🔎`],
        [`今天像素工坊节奏拉满，晚上去街机台来一局？🕹️`, `成交！先把这轮单测全跑绿再切磋 🏆`],
      ];
      const en = [
        [`@${nb} (${tb}) my ${ta} pass is done — passing the baton!`, `Got it! ${tb} taking over on ${proj} 🚀`],
        [`${ta} + ${tb} tag-teaming ${proj} feels super smooth ✨`, `Best combo — prompt cache is flying today ⚡`],
        [`@${nb} finished scanning the repo context?`, `Yep! Key architecture notes are ready to roll 📚`],
        [`Quick coffee break? Espresso machine is steaming ☕`, `Count me in! Double shot for the next ${proj} sprint 🔥`],
        [`@${nb} mind cross-reviewing my ${proj} diff?`, `On it! ${tb} checking every edge case right now 🔎`],
        [`Pixel Studio is humming today — arcade round later? 🕹️`, `Deal! Right after this test suite turns green 🏆`],
      ];
      return (isEn ? en : zh)[idx % zh.length];
    }
    const zh = [
      [`@${nb} 今天「${proj}」的节奏不错呀！`, `是啊，刚刚那一轮一次过，心情舒畅 🎉`],
      [`办公室那只橘猫又跑到服务器旁边取暖了 🐱`, `只要它不踩键盘快捷键就行哈哈 😄`],
      [`@${nb} 等会儿一起复盘下今天各模型的 Token 占比？`, `好呀，去总览页拉一下趋势图看一眼 📊`],
    ];
    const en = [
      [`@${nb} great momentum on ${proj} today!`, `Totally — that last pass went green on the first try 🎉`],
      [`The office cat is napping on the server rack again 🐱`, `As long as it doesn't step on Cmd+Z haha 😄`],
      [`@${nb} wanna review our token & cache breakdown later?`, `Sure, let's check the Overview trend chart 📊`],
    ];
    return (isEn ? en : zh)[idx % zh.length];
  }

  function catQuip(locale) {
    const zh = ['喵~ 键盘好暖和 🐾', '喵呜，记得喝水哦 💧', '巡视机房中…一切正常 🐱', 'zZz 听着打字声好催眠 ♪'];
    const en = ['Meow~ warm keyboard 🐾', 'Purr… remember to hydrate 💧', 'Server rack patrol… all green 🐱', 'zZz lo-fi typing beats ♪'];
    const list = locale === 'en' ? en : zh;
    return list[Math.floor(Date.now() / 5000) % list.length];
  }

  function create(viewport, onSelect) {
    const host = $('agent-pixel');
    if (!host) return null;

    let pixelTheme = 'cozy';
    try {
      const saved = localStorage.getItem('codex-pixel-theme');
      if (THEMES[saved]) pixelTheme = saved;
    } catch (_) {}

    const canvas = document.createElement('canvas');
    canvas.className = 'agent-pixel-canvas';
    canvas.setAttribute('aria-label', ui('2D 像素风多 Agent 办公室画布'));
    host.replaceChildren(canvas);

    const bubblesLayer = document.createElement('div');
    bubblesLayer.className = 'agent-pixel-bubbles';
    host.append(bubblesLayer);

    const tooltip = document.createElement('div');
    tooltip.className = 'pixel-tooltip';
    tooltip.hidden = true;
    host.append(tooltip);

    // Floating HUD bar (Theme switch + Spark Chat + Office Radio)
    const hud = document.createElement('div');
    hud.className = 'pixel-hud-bar';
    hud.innerHTML =
      '<div class="pixel-theme-group" role="group" aria-label="' + ui('像素主题') + '">' +
        '<button type="button" class="pixel-theme-btn" data-pixel-theme="cozy" aria-pressed="' + (pixelTheme === 'cozy') + '">' + ui('暖木工坊') + '</button>' +
        '<button type="button" class="pixel-theme-btn" data-pixel-theme="cyber" aria-pressed="' + (pixelTheme === 'cyber') + '">' + ui('赛博夜班') + '</button>' +
        '<button type="button" class="pixel-theme-btn" data-pixel-theme="garden" aria-pressed="' + (pixelTheme === 'garden') + '">' + ui('森系庭院') + '</button>' +
      '</div>' +
      '<button type="button" class="pixel-action-btn" id="pixel-spark-chat">💬 ' + ui('触发对话') + '</button>' +
      '<button type="button" class="pixel-action-btn" id="pixel-radio-toggle" aria-expanded="false">📻 ' + ui('电台') + ' <span class="pixel-radio-badge" id="pixel-radio-badge">0</span></button>';
    host.append(hud);

    const toolStrip = document.createElement('div');
    toolStrip.className = 'pixel-tool-strip';
    toolStrip.setAttribute('aria-label', ui('Agent 工具筛选'));
    host.append(toolStrip);

    const radioPanel = document.createElement('section');
    radioPanel.className = 'pixel-radio-panel';
    radioPanel.hidden = true;
    radioPanel.innerHTML =
      '<div class="pixel-radio-head"><span><i class="pixel-radio-live"></i>' + ui('办公室对话电台') + '</span><button type="button" class="text-button" id="pixel-radio-close">' + ui('收起') + '</button></div>' +
      '<div class="pixel-radio-feed" id="pixel-radio-feed"></div>';
    host.append(radioPanel);

    const ctx = canvas.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false, raf = 0, lastTs = 0, animTime = 0;
    let camera = { x: 0, y: 0, zoom: 1.5 };
    let worldSize = { width: 960, height: 640 };
    let rooms = [], actors = new Map(), edgesList = [], selected = '', hovered = '', activeToolFilter = '';
    let observation = 'offline', motionLive = false, topologySig = '', needsFit = true, localeStamp = i18n.locale;
    let drag = null, suppressClick = false;
    let particles = [], activeBubbles = [], radioLog = [], lastChatterAt = 0;
    let cat = { x: 160, y: 180, tx: 220, ty: 180, dir: 1, state: 'walk', timer: 3, bubbleUntil: 0, bubbleText: '' };

    function syncThemeAttr() {
      viewport.dataset.pixelTheme = pixelTheme;
      hud.querySelectorAll('.pixel-theme-btn').forEach(btn => {
        btn.setAttribute('aria-pressed', String(btn.dataset.pixelTheme === pixelTheme));
      });
    }
    syncThemeAttr();

    function syncLocalizedHud() {
      const map = { cozy: ui('暖木工坊'), cyber: ui('赛博夜班'), garden: ui('森系庭院') };
      hud.querySelectorAll('.pixel-theme-btn').forEach(btn => { btn.textContent = map[btn.dataset.pixelTheme]; });
      const spark = hud.querySelector('#pixel-spark-chat');
      const radio = hud.querySelector('#pixel-radio-toggle');
      if (spark) spark.textContent = '💬 ' + ui('触发对话');
      if (radio) radio.innerHTML = '📻 ' + esc(ui('电台')) + ' <span class="pixel-radio-badge" id="pixel-radio-badge">' + radioLog.length + '</span>';
      const head = radioPanel.querySelector('.pixel-radio-head span');
      const close = radioPanel.querySelector('#pixel-radio-close');
      if (head) head.innerHTML = '<i class="pixel-radio-live"></i>' + ui('办公室对话电台');
      if (close) close.textContent = ui('收起');
      canvas.setAttribute('aria-label', ui('2D 像素风多 Agent 办公室画布'));
    }

    function pushRadio(speaker, toolId, text, actorId = '') {
      const nowStr = new Date().toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      radioLog.unshift({ speaker, toolId, text, actorId, time: nowStr });
      if (radioLog.length > 18) radioLog.length = 18;
      const badge = hud.querySelector('#pixel-radio-badge');
      if (badge) badge.textContent = String(radioLog.length);
      renderRadioFeed();
    }

    function renderRadioFeed() {
      const feed = radioPanel.querySelector('#pixel-radio-feed');
      if (!feed) return;
      if (!radioLog.length) {
        feed.innerHTML = '<div style="padding:14px 6px;text-align:center;color:var(--muted);font-size:10px">' + esc(ui('点击「触发对话」看看 AI 同事们在聊什么')) + '</div>';
        return;
      }
      feed.innerHTML = radioLog.map(item => {
        const ts = item.toolId === 'cat' ? { color: '#d97706', short: '🐱' } : toolStyle(item.toolId);
        const attr = item.actorId ? ' data-radio-actor="' + esc(item.actorId) + '" title="' + esc(ui('点击聚焦角色')) + '"' : '';
        return '<div class="pixel-radio-item' + (item.actorId ? ' clickable' : '') + '"' + attr + ' style="--tool-color:' + ts.color + '">' +
          '<div class="pixel-radio-meta"><strong>' + esc(item.speaker) + ' · ' + esc(ts.short) + '</strong><span>' + esc(item.time) + '</span></div>' +
          '<div>' + esc(item.text) + '</div></div>';
      }).join('');
    }

    function triggerChatter(forcePair = false) {
      const list = visibleActors();
      if (!list.length) return;
      const now = performance.now();
      // Remove expired bubbles
      activeBubbles = activeBubbles.filter(b => b.until > now);

      // Try paired conversation between connected agents or multi-tool teammates
      const pairs = [];
      for (const e of edgesList) {
        const a = actors.get(e.source), b = actors.get(e.target);
        if (a && b && a.visible && b.visible) pairs.push([a, b, 'hierarchy']);
      }
      if (!pairs.length || (Math.random() < 0.55 && list.length >= 2)) {
        for (const r of rooms) {
          const rm = r.actors.filter(a => a.visible);
          if (rm.length >= 2) {
            for (let i = 0; i < rm.length; i++) {
              for (let j = i + 1; j < rm.length; j++) {
                const diffTool = rm[i].node.agent_tool !== rm[j].node.agent_tool;
                pairs.push([rm[i], rm[j], diffTool ? 'cross-tool' : 'coworker']);
              }
            }
          }
        }
      }

      if (pairs.length && (forcePair || Math.random() < 0.72)) {
        const pick = pairs[Math.floor(Math.random() * pairs.length)];
        const [a, b, rel] = pick;
        const [lineA, lineB] = buildPairedDialogue(a.node, b.node, rel, i18n.locale);
        activeBubbles = activeBubbles.filter(x => x.actorId !== a.id && x.actorId !== b.id);
        activeBubbles.push({ actorId: a.id, text: lineA, startAt: now, until: now + 6800, isReply: false, partnerId: b.id });
        activeBubbles.push({ actorId: b.id, text: lineB, startAt: now + 1500, until: now + 8400, isReply: true, partnerId: a.id });
        pushRadio(personal.name(a.node), a.node.agent_tool || 'codex', lineA, a.id);
        setTimeout(() => {
          if (visible) pushRadio(personal.name(b.node), b.node.agent_tool || 'codex', lineB, b.id);
        }, 1500);
        // Spawn energy celebration sparks between them
        spawnBurst(a.x, a.y - 24, toolStyle(a.node.agent_tool).color, 6);
        spawnBurst(b.x, b.y - 24, toolStyle(b.node.agent_tool).color, 6);
        return;
      }

      // Single character monologue (prioritize working agents)
      const working = list.filter(a => a.node.status === 'working');
      const pool = working.length ? working : list;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      const line = buildSoloLine(picked.node, i18n.locale);
      activeBubbles = activeBubbles.filter(x => x.actorId !== picked.id);
      activeBubbles.push({ actorId: picked.id, text: line, startAt: now, until: now + 6200, isReply: false, partnerId: '' });
      pushRadio(personal.name(picked.node), picked.node.agent_tool || 'codex', line, picked.id);
    }

    function spawnBurst(x, y, color, count = 5) {
      if (reduced.matches) return;
      for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.6;
        particles.push({
          x, y, vx: Math.cos(ang) * (10 + Math.random() * 14), vy: -14 - Math.random() * 16,
          life: 1.0 + Math.random() * 0.6, maxLife: 1.4, color, kind: 'spark', size: 2 + (i % 2),
        });
      }
    }

    function visibleActors() {
      return [...actors.values()].filter(a => a.visible);
    }

    function buildLayout(nodes) {
      rooms = [];
      actors.clear();
      const byProj = new Map();
      for (const n of nodes) {
        if (!byProj.has(n.project_id)) byProj.set(n.project_id, []);
        byProj.get(n.project_id).push(n);
      }

      const sortedProjects = [...byProj.entries()].sort((a, b) =>
        a[1][0].project.localeCompare(b[1][0].project, 'zh-CN') || a[0].localeCompare(b[0])
      );

      const deskW = 108, deskH = 92, padX = 44, padTop = 82, padBottom = 64, loungeH = 56;
      const roomSpecs = sortedProjects.map(([pid, list]) => {
        const ordered = list.slice().sort((a, b) =>
          (a.kind === 'session' ? 0 : 1) - (b.kind === 'session' ? 0 : 1) || a.created_at - b.created_at || a.id.localeCompare(b.id)
        );
        const cols = Math.max(2, Math.min(5, Math.ceil(Math.sqrt(ordered.length * 1.25))));
        const rows = Math.max(1, Math.ceil(ordered.length / cols));
        const w = Math.max(300, padX * 2 + cols * deskW);
        const h = Math.max(230, padTop + rows * deskH + loungeH + padBottom);
        return { id: pid, name: list[0].project, nodes: ordered, cols, rows, w, h, x: 0, y: 0, actors: [], tools: new Set(list.map(n => n.agent_tool || 'codex')) };
      });

      // Pack rooms cleanly into balanced rows
      const maxRowW = Math.max(760, Math.min(1380, Math.ceil(Math.sqrt(Math.max(1, roomSpecs.length))) * 460));
      let curX = 36, curY = 36, rowH = 0, totalW = 36;
      for (const r of roomSpecs) {
        if (curX > 36 && curX + r.w + 36 > maxRowW) {
          curX = 36; curY += rowH + 34; rowH = 0;
        }
        r.x = curX; r.y = curY;
        curX += r.w + 34;
        rowH = Math.max(rowH, r.h);
        totalW = Math.max(totalW, curX);
      }
      const totalH = Math.max(360, curY + rowH + 40);
      worldSize = { width: Math.max(480, totalW), height: totalH };

      for (const r of roomSpecs) {
        r.nodes.forEach((n, idx) => {
          const col = idx % r.cols;
          const row = Math.floor(idx / r.cols);
          const rowCount = Math.min(r.cols, r.nodes.length - row * r.cols);
          const rowOffset = (r.w - rowCount * deskW) / 2;
          const ax = Math.round(r.x + rowOffset + col * deskW + deskW / 2);
          const ay = Math.round(r.y + padTop + row * deskH + 44);
          const h = hash(n.id);
          const pref = personal.get(n.id);
          const species = pref.species === 'auto' ? ['human', 'human', 'human', 'cow', 'horse'][h % 5] : pref.species;
          const actor = {
            id: n.id, node: n, room: r, x: ax, y: ay,
            skin: SKINS[h % SKINS.length],
            hair: HAIRS[(h >>> 4) % HAIRS.length],
            hairStyle: (h >>> 8) % 3,
            glasses: (h >>> 11) % 3 === 0,
            species,
            deskProp: pref.desk,
            customShirt: pref.shirt,
            phase: (h % 97) * 0.13,
            visible: !activeToolFilter || (n.agent_tool || 'codex') === activeToolFilter,
          };
          actors.set(n.id, actor);
          r.actors.push(actor);
        });
        rooms.push(r);
      }

      if (rooms.length) {
        const r0 = rooms[0];
        cat.x = r0.x + r0.w - 58;
        cat.y = r0.y + r0.h - 32;
        cat.tx = r0.x + 58;
        cat.ty = r0.y + r0.h - 32;
      }
    }

    function renderToolStrip() {
      const counts = new Map();
      for (const a of actors.values()) {
        const t = a.node.agent_tool || 'codex';
        counts.set(t, (counts.get(t) || 0) + 1);
      }
      if (counts.size <= 1) {
        toolStrip.innerHTML = '';
        return;
      }
      const allBtn = '<button type="button" class="pixel-tool-pill" data-pixel-tool="" aria-pressed="' + (!activeToolFilter) + '" style="--tool-color:#12776a"><i></i>' + esc(ui('全部工具')) + '<b>' + actors.size + '</b></button>';
      const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, cnt]) => {
        const st = toolStyle(id);
        return '<button type="button" class="pixel-tool-pill" data-pixel-tool="' + esc(id) + '" aria-pressed="' + (activeToolFilter === id) + '" style="--tool-color:' + st.color + '"><i></i>' + esc(st.label) + '<b>' + cnt + '</b></button>';
      }).join('');
      toolStrip.innerHTML = allBtn + items;
    }

    function applyToolFilter() {
      for (const a of actors.values()) {
        a.visible = !activeToolFilter || (a.node.agent_tool || 'codex') === activeToolFilter;
      }
      renderToolStrip();
    }

    // --- Crisp Pixel Art Drawing Primitives ---
    function px(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }

    function drawPixelWindow(x, y, w, h, theme, t) {
      // Outer frame
      px(x - 2, y - 2, w + 4, h + 4, theme.wallBorder);
      px(x, y, w, h, theme.windowSkyA);
      px(x, y + Math.floor(h * 0.52), w, Math.ceil(h * 0.48), theme.windowSkyB);
      if (theme.isDark) {
        // Twinkling stars + neon city skyline
        for (let i = 0; i < 6; i++) {
          const sx = x + 5 + ((i * 19) % (w - 10));
          const sy = y + 3 + ((i * 7) % 10);
          const blink = Math.sin(t * 2.2 + i * 1.7) > -0.2;
          if (blink) px(sx, sy, 2, 2, i % 2 ? '#e0f2fe' : '#a78bfa');
        }
        // Silhouette towers
        const bld = [[4, 14, 10], [16, 18, 12], [30, 12, 9], [42, 16, 11]];
        for (const [bx, bh, bw] of bld) {
          if (bx + bw > w - 2) continue;
          px(x + bx, y + h - bh, bw, bh, '#0b1426');
          px(x + bx + 2, y + h - bh + 3, 2, 2, '#38bdf8');
          if (bh > 14) px(x + bx + 5, y + h - bh + 7, 2, 2, '#f472b6');
        }
      } else {
        // Drifting pixel clouds
        const cx = x + ((Math.floor(t * 6) + x) % (w + 14)) - 12;
        px(cx, y + 6, 12, 4, theme.cloud);
        px(cx + 2, y + 4, 8, 2, theme.cloud);
        // Distant rooftops
        px(x + 2, y + h - 8, 14, 8, '#a4bdae');
        px(x + 20, y + h - 11, 16, 11, '#93b09f');
        px(x + 39, y + h - 7, 12, 7, '#a8c2b3');
      }
      // Window mullions
      px(x + Math.floor(w / 2) - 1, y, 2, h, theme.wall);
      px(x, y + Math.floor(h * 0.56), w, 2, theme.wall);
      // Sill
      px(x - 3, y + h + 1, w + 6, 3, theme.trim);
    }

    function drawPlant(x, y, t) {
      const sway = reduced.matches ? 0 : Math.round(Math.sin(t * 1.6 + x * 0.1) * 1);
      px(x - 5, y, 10, 8, '#b87654');
      px(x - 6, y - 2, 12, 3, '#cf8d68');
      px(x - 4, y - 1, 8, 2, '#4c382a');
      // Leaves
      px(x - 2 + sway, y - 12, 4, 10, '#2f7a53');
      px(x - 8 + sway, y - 9, 6, 4, '#3d9968');
      px(x + 2 + sway, y - 10, 6, 4, '#4eb37c');
      px(x - 5 + sway, y - 15, 5, 4, '#5ec98f');
      px(x + 1 + sway, y - 14, 5, 4, '#388e60');
    }

    function drawCoffeeBar(x, y, t, theme) {
      // Counter cabinet
      px(x, y, 52, 22, theme.isDark ? '#1e2f47' : '#a8845c');
      px(x - 2, y - 3, 56, 5, theme.isDark ? '#344c6e' : '#e5d5bc');
      px(x + 4, y + 5, 19, 13, theme.isDark ? '#162438' : '#8d6c48');
      px(x + 28, y + 5, 19, 13, theme.isDark ? '#162438' : '#8d6c48');
      // Espresso machine
      px(x + 6, y - 16, 16, 13, '#334155');
      px(x + 8, y - 14, 12, 5, '#475569');
      px(x + 17, y - 13, 2, 2, Math.sin(t * 4) > 0 ? '#10b981' : '#34d399');
      // Cup + rising pixel steam
      px(x + 10, y - 7, 5, 4, '#f8fafc');
      px(x + 28, y - 8, 5, 5, '#fef3c7');
      px(x + 36, y - 8, 5, 5, '#e0f2fe');
      if (!reduced.matches) {
        const sy = Math.floor((t * 10) % 10);
        ctx.fillStyle = 'rgba(255,255,255,.65)';
        ctx.fillRect(Math.round(x + 11 + Math.sin(t * 3) * 1.5), Math.round(y - 11 - sy), 2, 2);
        ctx.fillRect(Math.round(x + 30 + Math.cos(t * 2.5) * 1.5), Math.round(y - 12 - ((sy + 5) % 10)), 2, 2);
      }
    }

    function drawWhiteboard(x, y, theme) {
      px(x - 2, y - 2, 58, 28, theme.isDark ? '#475569' : '#94a3b8');
      px(x, y, 54, 24, theme.isDark ? '#0f172a' : '#fcfdf9');
      // Sticky notes + mini chart
      px(x + 4, y + 4, 7, 7, '#fde047');
      px(x + 13, y + 4, 7, 7, '#86efac');
      px(x + 4, y + 13, 7, 7, '#93c5fd');
      px(x + 13, y + 13, 7, 7, '#fda4af');
      // Mini bar chart on right side of board
      px(x + 28, y + 15, 4, 6, '#10a37f');
      px(x + 34, y + 11, 4, 10, '#7c5cff');
      px(x + 40, y + 8, 4, 13, '#d97757');
      px(x + 46, y + 12, 4, 9, '#4285f4');
    }

    function drawServerRack(x, y, activeCount, t) {
      px(x, y - 26, 20, 34, '#1e293b');
      px(x + 2, y - 24, 16, 30, '#0f172a');
      for (let i = 0; i < 4; i++) {
        px(x + 4, y - 21 + i * 7, 12, 4, '#334155');
        const on = activeCount > 0 ? Math.sin(t * (4 + i * 2) + i) > -0.2 : i === 0;
        px(x + 5, y - 20 + i * 7, 2, 2, on ? '#10b981' : '#475569');
        px(x + 9, y - 20 + i * 7, 2, 2, activeCount > 1 && Math.cos(t * 5 + i) > 0 ? '#38bdf8' : '#334155');
        px(x + 13, y - 20 + i * 7, 2, 2, activeCount > 2 && Math.sin(t * 7 + i) > 0.2 ? '#a855f7' : '#334155');
      }
    }

    function drawSofa(x, y, theme) {
      const base = theme.isDark ? '#314563' : '#6c8d82';
      const cushion = theme.isDark ? '#425d85' : '#85a69b';
      px(x, y, 48, 18, base);
      px(x + 3, y + 5, 42, 11, cushion);
      px(x - 3, y + 3, 5, 15, base);
      px(x + 46, y + 3, 5, 15, base);
      // Throw pillows
      px(x + 6, y + 4, 8, 7, '#e2a36b');
      px(x + 34, y + 4, 8, 7, '#f2d388');
    }

    function drawWallDecor(r, theme, t) {
      // Decorative fairy string lights / neon LED strip / hanging ivy along back wall
      if (theme.isDark) {
        // Cyber neon LED bar along top edge of back wall
        px(r.x + 8, r.y + 4, r.w - 16, 2, '#1e3a5f');
        for (let sx = r.x + 12; sx < r.x + r.w - 16; sx += 18) {
          const glowOn = Math.sin(t * 2.5 + sx * 0.08) > -0.3;
          px(sx, r.y + 4, 8, 2, glowOn ? (sx % 36 === 0 ? '#a855f7' : '#38bdf8') : '#1e3a5f');
        }
      } else if (pixelTheme === 'garden') {
        // Hanging pixel botanical ivy garland
        for (let sx = r.x + 10; sx < r.x + r.w - 14; sx += 16) {
          const drop = 4 + ((sx * 7) % 6);
          px(sx, r.y + 3, 4, drop, '#4e9c6c');
          px(sx + 3, r.y + 4, 3, Math.max(2, drop - 2), '#6bc28a');
          if ((sx / 16) % 3 === 0) px(sx + 1, r.y + 3 + drop, 2, 2, '#f9a8d4'); // cherry blossom dot
        }
      } else {
        // Cozy warm Edison fairy string lights
        for (let sx = r.x + 16; sx < r.x + r.w - 18; sx += 22) {
          const sag = Math.round(Math.sin(((sx - r.x) / r.w) * Math.PI * 3) * 2);
          px(sx - 6, r.y + 3 + sag, 14, 1, '#8c765a');
          const bright = Math.sin(t * 2.2 + sx * 0.15) > -0.35;
          px(sx, r.y + 4 + sag, 3, 3, bright ? '#fde68a' : '#d6b66f');
          if (bright) {
            ctx.fillStyle = 'rgba(253,224,71,.22)';
            ctx.fillRect(sx - 2, r.y + 2 + sag, 7, 7);
          }
        }
      }

      // Live Pixel Wall Clock next to whiteboard
      const clockX = r.x + r.w - 94, clockY = r.y + 15;
      if (clockX > r.x + 90) {
        px(clockX - 7, clockY - 7, 14, 14, theme.wallBorder);
        px(clockX - 5, clockY - 5, 10, 10, theme.isDark ? '#0f172a' : '#fffdf7');
        const nowD = new Date();
        const minAng = (nowD.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
        const hrAng = (((nowD.getHours() % 12) + nowD.getMinutes() / 60) / 12) * Math.PI * 2 - Math.PI / 2;
        ctx.strokeStyle = theme.isDark ? '#38bdf8' : '#1e293b';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(clockX, clockY); ctx.lineTo(clockX + Math.cos(hrAng) * 3.2, clockY + Math.sin(hrAng) * 3.2);
        ctx.moveTo(clockX, clockY); ctx.lineTo(clockX + Math.cos(minAng) * 4.4, clockY + Math.sin(minAng) * 4.4);
        ctx.stroke();
        px(clockX - 0.5, clockY - 0.5, 1.5, 1.5, '#ef4444');
      }
    }

    function drawArcadeCabinet(x, y, t) {
      // Cute retro pixel arcade cabinet with animated CRT screen
      px(x, y - 22, 18, 30, '#312e81');
      px(x + 2, y - 20, 14, 4, '#f43f5e'); // marquee banner
      px(x + 4, y - 19, 10, 2, '#fef08a');
      px(x + 2, y - 14, 14, 10, '#0f172a'); // screen bezel
      px(x + 4, y - 12, 10, 6, '#1e3a5f');
      // Animated mini invader / paddle dot on arcade screen
      const bx = x + 5 + Math.floor((Math.sin(t * 3.5) + 1) * 3.5);
      px(bx, y - 10, 2, 2, '#4ade80');
      px(x + 6, y - 8, 5, 1.5, '#38bdf8');
      // Control deck + joystick + buttons
      px(x - 1, y - 4, 20, 4, '#4338ca');
      px(x + 3, y - 6, 2, 3, '#ef4444');
      px(x + 11, y - 4, 2, 2, '#facc15');
      px(x + 14, y - 4, 2, 2, '#22d3ee');
    }

    function drawBookshelf(x, y, theme) {
      px(x, y - 20, 26, 28, theme.isDark ? '#1e2f47' : '#96714c');
      px(x + 2, y - 18, 22, 24, theme.isDark ? '#132033' : '#7a593a');
      const spines = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
      for (let row = 0; row < 3; row++) {
        const sy = y - 16 + row * 8;
        px(x + 2, sy + 6, 22, 2, theme.isDark ? '#2d4363' : '#b8926a');
        for (let b = 0; b < 6; b++) {
          px(x + 3 + b * 3.3, sy + (b % 2), 2.5, 6 - (b % 2), spines[(b + row * 2) % spines.length]);
        }
      }
    }

    function drawWaterCooler(x, y, t) {
      px(x, y - 8, 12, 16, '#e2e8f0');
      px(x + 2, y - 4, 8, 4, '#cbd5e1');
      px(x + 3, y - 3, 2, 2, '#ef4444');
      px(x + 7, y - 3, 2, 2, '#3b82f6');
      // Blue water jug
      px(x + 1, y - 20, 10, 12, '#7dd3fc');
      px(x + 2, y - 18, 8, 8, '#38bdf8');
      px(x + 3, y - 16 + (Math.floor(t * 2) % 3), 2, 2, '#e0f2fe');
    }

    function drawRoom(r, theme, t) {
      // Soft architectural drop shadow
      ctx.fillStyle = theme.isDark ? 'rgba(0,0,0,.52)' : 'rgba(20,48,38,.11)';
      ctx.fillRect(r.x + 7, r.y + 9, r.w, r.h);

      // Floor tiles with theme-specific texture
      px(r.x, r.y, r.w, r.h, theme.floorA);
      const tile = 16;
      for (let ty = r.y + 46; ty < r.y + r.h; ty += tile) {
        const rowShift = ((ty - r.y) / tile) % 2 ? 8 : 0;
        for (let tx = r.x; tx < r.x + r.w; tx += tile) {
          if (((Math.floor((tx + rowShift) / tile) + Math.floor(ty / tile)) % 2) === 0) {
            px(tx, ty, Math.min(tile, r.x + r.w - tx), Math.min(tile, r.y + r.h - ty), theme.floorB);
          }
        }
        px(r.x, ty, r.w, 1, theme.floorSeam);
      }
      if (theme.isDark) {
        // Subtle cyber glowing floor bus line
        ctx.fillStyle = 'rgba(56,189,248,.10)';
        ctx.fillRect(r.x + 18, r.y + r.h - 52, r.w - 36, 2);
      }

      // Back wall
      px(r.x, r.y, r.w, 46, theme.wall);
      px(r.x, r.y + 42, r.w, 4, theme.wallShade);
      px(r.x, r.y + 45, r.w, 2, theme.trim);
      drawWallDecor(r, theme, t);

      // Windows along back wall
      for (let wx = r.x + 24; wx + 64 < r.x + r.w - 104; wx += 90) {
        drawPixelWindow(wx, r.y + 10, 54, 26, theme, t);
      }

      // Whiteboard on top-right wall
      drawWhiteboard(r.x + r.w - 72, r.y + 11, theme);

      // Woven workspace carpet with subtle framed border
      px(r.x + 18, r.y + 56, r.w - 36, r.h - 114, theme.rugAlpha);
      ctx.strokeStyle = theme.isDark ? 'rgba(56,189,248,.16)' : 'rgba(130,104,72,.16)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 20, r.y + 58, r.w - 40, r.h - 118);

      // Bottom cozy lounge & studio amenity strip
      const ly = r.y + r.h - 44;
      drawCoffeeBar(r.x + 20, ly + 10, t, theme);
      if (r.w >= 380) drawBookshelf(r.x + 86, ly + 18, theme);
      if (r.w >= 300) drawSofa(r.x + Math.floor(r.w / 2) - 24, ly + 12, theme);
      if (r.w >= 410) drawArcadeCabinet(r.x + r.w - 94, ly + 18, t);
      if (r.w >= 330) drawWaterCooler(r.x + r.w - 64, ly + 18, t);
      const activeInRoom = r.actors.filter(a => a.node.status === 'working').length;
      drawServerRack(r.x + r.w - 36, ly + 20, activeInRoom, t);
      drawPlant(r.x + 14, r.y + 52, t);
      drawPlant(r.x + r.w - 14, r.y + 52, t);

      // Outer pixel room border
      ctx.strokeStyle = theme.wallBorder;
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);

      // Project nameplate banner at top-left
      const label = brief(r.name, 22);
      ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = Math.max(126, ctx.measureText(label).width + 30 + r.tools.size * 12);
      px(r.x + 12, r.y - 14, tw, 22, theme.signBg);
      ctx.strokeStyle = theme.signBorder;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 12, r.y - 14, tw, 22);
      ctx.fillStyle = theme.signText;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, r.x + 20, r.y - 3);
      // Colored tool dots on the room signboard
      let dx = r.x + tw - 10;
      for (const tid of [...r.tools].reverse()) {
        px(dx, r.y - 6, 7, 7, toolStyle(tid).color);
        dx -= 11;
      }
    }

    function drawDeskAndActor(a, theme, t) {
      if (!a.visible) return;
      const x = a.x, y = a.y;
      const n = a.node;
      const ts = toolStyle(n.agent_tool || 'codex');
      const working = observation === 'live' && n.status === 'working';
      const waiting = ['waiting_agents', 'waiting_user'].includes(n.status);
      const failed = n.status === 'failed';
      const isSel = a.id === selected, isHov = a.id === hovered;
      const bob = working && !reduced.matches ? Math.round(Math.sin(t * 7 + a.phase) * 1.2) : 0;
      const typing = working && !reduced.matches ? Math.floor((t * 8 + a.phase) % 2) : 0;
      const blink = Math.floor((t * 1.2 + a.phase * 3) % 7) === 0 && ((t * 1.2 + a.phase * 3) % 1) < 0.08;

      // Active / Selected pulsing floor aura ring
      if (working || isSel || isHov) {
        const pulse = reduced.matches ? 0 : Math.sin(t * 4 + a.phase) * 3;
        ctx.save();
        ctx.strokeStyle = isSel ? '#ffffff' : ts.color;
        ctx.lineWidth = isSel ? 2.5 : 2;
        ctx.globalAlpha = isSel ? 0.95 : (working ? 0.65 : 0.5);
        ctx.beginPath();
        ctx.ellipse(x, y + 12, 32 + pulse * 0.5, 14 + pulse * 0.25, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (working) {
          ctx.fillStyle = ts.glow;
          ctx.fill();
        }
        ctx.restore();
      }

      // Office chair behind character
      px(x - 11, y - 16, 22, 18, '#334155');
      px(x - 9, y - 14, 18, 12, '#475569');
      px(x - 3, y + 2, 6, 8, '#1e293b');

      // --- Pixel Character (behind desk) ---
      const jacket = a.customShirt && a.customShirt !== 'auto' ? a.customShirt : ts.jacket;
      // Torso / Jacket
      px(x - 9, y - 9 + bob, 18, 13, jacket);
      px(x - 3, y - 9 + bob, 6, 12, ts.trim); // shirt accent stripe
      px(x - 9, y - 10 + bob, 18, 2, '#1e293b'); // collar outline

      // Antigravity floating anti-gravity pixel halo ring!
      if ((n.agent_tool || 'codex') === 'antigravity') {
        const hy = y - 34 + Math.round(Math.sin(t * 3.5 + a.phase) * 2);
        px(x - 8, hy, 16, 2, '#c084fc');
        px(x - 10, hy + 1, 3, 2, '#38bdf8');
        px(x + 7, hy + 1, 3, 2, '#38bdf8');
      }

      // Head by species (human / cow / horse)
      const hy = y - 24 + bob;
      if (a.species === 'cow') {
        px(x - 8, hy, 16, 14, '#f5f0e6');
        px(x - 8, hy, 6, 6, '#27272a'); // cow spot
        px(x + 3, hy + 5, 5, 5, '#27272a');
        px(x - 10, hy - 2, 3, 4, '#d4c5b0'); // horns
        px(x + 7, hy - 2, 3, 4, '#d4c5b0');
        px(x - 6, hy + 9, 12, 5, '#f2b8b5'); // pink snout
        px(x - 4, hy + 5, 2, 2, '#18181b');
        px(x + 2, hy + 5, 2, 2, '#18181b');
      } else if (a.species === 'horse') {
        px(x - 7, hy - 1, 14, 15, '#9a623c');
        px(x - 3, hy - 3, 6, 5, '#472a19'); // mane
        px(x - 7, hy - 4, 3, 4, '#845231'); // ears
        px(x + 4, hy - 4, 3, 4, '#845231');
        px(x - 5, hy + 9, 10, 5, '#c48d65'); // muzzle
        px(x - 4, hy + 4, 2, 2, '#18181b');
        px(x + 2, hy + 4, 2, 2, '#18181b');
      } else {
        // Crisp pixel human head
        px(x - 7, hy, 14, 14, a.skin);
        // Hair style
        px(x - 8, hy - 3, 16, 5, a.hair);
        if (a.hairStyle === 1) { px(x - 8, hy + 1, 3, 9, a.hair); px(x + 5, hy + 1, 3, 9, a.hair); }
        else if (a.hairStyle === 2) { px(x - 4, hy - 6, 8, 3, a.hair); }
        // Eyes
        if (blink) {
          px(x - 4, hy + 6, 3, 1, '#1e293b');
          px(x + 2, hy + 6, 3, 1, '#1e293b');
        } else {
          px(x - 4, hy + 5, 2, 3, '#1e293b');
          px(x + 2, hy + 5, 2, 3, '#1e293b');
          px(x - 4, hy + 5, 1, 1, '#ffffff');
          px(x + 2, hy + 5, 1, 1, '#ffffff');
        }
        // Glasses
        if (a.glasses) {
          px(x - 6, hy + 4, 5, 1, '#334155'); px(x + 1, hy + 4, 5, 1, '#334155');
          px(x - 1, hy + 5, 2, 1, '#334155');
        }
        // Subtle smile
        px(x - 2, hy + 10, 4, 1, '#b47464');
      }

      // Animated typing arms
      const leftArmY = y - 2 + (typing ? -2 : 0);
      const rightArmY = y - 2 + (typing ? 0 : -2);
      px(x - 12, leftArmY, 4, 7, jacket);
      px(x + 8, rightArmY, 4, 7, jacket);
      px(x - 12, leftArmY + 5, 4, 3, a.skin);
      px(x + 8, rightArmY + 5, 4, 3, a.skin);

      // --- Pixel Desk (in front of character) ---
      px(x - 34, y + 2, 68, 16, theme.deskTop);
      px(x - 34, y + 18, 68, 4, theme.deskEdge);
      px(x - 31, y + 22, 4, 8, theme.deskLeg);
      px(x + 27, y + 22, 4, 8, theme.deskLeg);
      // Tool color accent strip on desk front edge
      px(x - 34, y + 18, 68, 2, ts.color);

      // Monitor (center-front of desk) + side monitor for Main Agents
      const dual = n.kind === 'session';
      const mw = dual ? 28 : 22;
      px(x - Math.floor(mw / 2), y - 10, mw, 16, '#1e293b');
      px(x - Math.floor(mw / 2) + 2, y - 8, mw - 4, 12, ts.screen);
      px(x - 3, y + 6, 6, 3, '#475569');
      if (dual) {
        // Secondary side terminal monitor for Main Agents
        px(x + 16, y - 6, 13, 12, '#1e293b');
        px(x + 18, y - 4, 9, 8, ts.screen);
        px(x + 19, y - 2, 6, 1.5, working ? ts.trim : '#475569');
        px(x + 19, y + 1, 4, 1.5, working ? ts.code[0] : '#475569');
      }
      // Animated scrolling code lines on monitor
      const scroll = working && !reduced.matches ? Math.floor(t * 7 + a.phase) : 0;
      for (let row = 0; row < 4; row++) {
        const len = 4 + ((row * 7 + scroll * 3) % (mw - 10));
        const col = working ? ts.code[(row + scroll) % ts.code.length] : '#475569';
        px(x - Math.floor(mw / 2) + 4, y - 6 + row * 3, len, 1.5, col);
      }
      // Monitor screen glow spill on desk when working
      if (working) {
        ctx.fillStyle = ts.glow;
        ctx.fillRect(x - 20, y + 4, 40, 12);
        // Subtle floating tool micro-emblem above active monitor
        ctx.save();
        ctx.globalAlpha = 0.72 + Math.sin(t * 4 + a.phase) * 0.22;
        ctx.fillStyle = ts.trim;
        ctx.font = 'bold 8px ui-monospace, monospace';
        ctx.fillText(ts.emblem || '✦', x + Math.floor(mw / 2) - 4, y - 15 + Math.sin(t * 3 + a.phase) * 1.5);
        ctx.restore();
      } else if (n.status === 'idle' && !reduced.matches && Math.sin(t * 1.4 + a.phase) > 0.45) {
        // Gentle floating lo-fi music note for relaxed idle coworkers
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = theme.isDark ? '#93c5fd' : '#64748b';
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText('♪', x + 12, y - 24 - ((t * 8 + a.phase * 5) % 8));
        ctx.restore();
      }

      // Keyboard & Mouse
      px(x - 10, y + 10, 16, 4, '#334155');
      if (working && !reduced.matches) {
        px(x - 8 + (Math.floor(t * 14) % 12), y + 11, 2, 2, ts.trim);
      }
      px(x + 10, y + 11, 4, 3, '#475569');

      // Desk props (coffee mug / mini plant / notebook)
      if (a.deskProp === 'plant') {
        px(x - 28, y + 4, 7, 6, '#c27854');
        px(x - 27, y - 1, 5, 5, '#34a86e');
      } else if (a.deskProp === 'notebook') {
        px(x - 29, y + 5, 10, 8, '#fef3c7');
        px(x - 27, y + 7, 6, 1, '#94a3b8');
      } else {
        // Default: pixel coffee mug + tiny steam
        px(x - 27, y + 5, 6, 6, '#f8fafc');
        px(x - 26, y + 5, 4, 2, '#6b4226');
        if (!reduced.matches && Math.sin(t * 2 + a.phase) > 0) {
          px(x - 25, y + 1 - Math.floor((t * 6) % 4), 2, 2, 'rgba(255,255,255,.55)');
        }
      }

      // Status LED gem on right corner of desk
      const stCol = observation === 'live' ? (STATUS_COLOR[n.status] || '#94a3b8') : '#94a3b8';
      px(x + 22, y + 6, 6, 6, '#1e293b');
      px(x + 23, y + 7, 4, 4, stCol);

      // Emote icon above head for waiting / failed
      if (waiting) {
        const ey = y - 38 + Math.round(Math.sin(t * 4) * 2);
        px(x + 10, ey, 14, 10, '#fef3c7');
        ctx.strokeStyle = '#d97706'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 10, ey, 14, 10);
        ctx.fillStyle = '#92400e'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
        ctx.fillText(n.status === 'waiting_user' ? '?' : '…', x + 17, ey + 6);
        ctx.textAlign = 'left';
      } else if (failed) {
        const ey = y - 38 + Math.round(Math.sin(t * 6) * 1.5);
        px(x + 10, ey, 12, 11, '#fee2e2');
        ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 10, ey, 12, 11);
        ctx.fillStyle = '#b91c1c'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
        ctx.fillText('!', x + 16, ey + 6);
        ctx.textAlign = 'left';
      }

      // Crisp Nametag + Tool Badge below desk
      const tagName = brief(personal.name(n), 12);
      ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, sans-serif';
      const nw = Math.min(88, Math.max(46, ctx.measureText(tagName).width + 22));
      const tagX = Math.round(x - nw / 2), tagY = y + 25;
      px(tagX, tagY, nw, 15, theme.isDark ? 'rgba(15,23,42,.92)' : 'rgba(255,255,255,.94)');
      ctx.strokeStyle = isSel ? ts.color : (theme.isDark ? '#3b5273' : '#c6d6cc');
      ctx.lineWidth = isSel ? 1.8 : 1;
      ctx.strokeRect(tagX, tagY, nw, 15);
      // Colored tool pill strip on left
      px(tagX + 2, tagY + 2, 4, 11, ts.color);
      ctx.fillStyle = theme.isDark ? '#e2e8f0' : '#1d362d';
      ctx.textBaseline = 'middle';
      ctx.fillText(tagName, tagX + 10, tagY + 8, nw - 14);
    }

    function drawEdges(t, theme) {
      for (const e of edgesList) {
        const a = actors.get(e.source), b = actors.get(e.target);
        if (!a || !b || !a.visible || !b.visible) continue;
        const activeDown = observation === 'live' && b.node.status === 'working';
        const hi = selected && (e.source === selected || e.target === selected) || hovered && (e.source === hovered || e.target === hovered);
        const col = e.kind === 'delegation' ? '#f59e0b' : e.kind === 'collaboration' ? '#a855f7' : '#38bdf8';

        // Manhattan / stepped pixel cable path
        const sx = a.x, sy = a.y + 16, tx = b.x, ty = b.y + 16;
        const midY = Math.round((sy + ty) / 2);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, midY);
        ctx.lineTo(tx, midY);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = col;
        ctx.lineWidth = activeDown || hi ? 2.5 : 1.5;
        ctx.globalAlpha = activeDown || hi ? 0.85 : (theme.isDark ? 0.28 : 0.32);
        if (!activeDown && !hi) ctx.setLineDash([4, 4]);
        ctx.stroke();

        // Flowing glowing data packets along active or highlighted cables!
        if ((activeDown || hi) && !reduced.matches) {
          ctx.setLineDash([]);
          const segs = [[sx, sy, sx, midY], [sx, midY, tx, midY], [tx, midY, tx, ty]];
          const lens = segs.map(s => Math.hypot(s[2] - s[0], s[3] - s[1]));
          const totalLen = lens.reduce((u, v) => u + v, 0) || 1;
          for (let k = 0; k < 2; k++) {
            let d = (((t * 72 + k * (totalLen / 2) + hash(e.source + e.target) % 60) % totalLen) + totalLen) % totalLen;
            let pxX = sx, pxY = sy;
            for (let i = 0; i < segs.length; i++) {
              if (d <= lens[i] || i === segs.length - 1) {
                const frac = lens[i] ? d / lens[i] : 0;
                pxX = segs[i][0] + (segs[i][2] - segs[i][0]) * frac;
                pxY = segs[i][1] + (segs[i][3] - segs[i][1]) * frac;
                break;
              }
              d -= lens[i];
            }
            ctx.globalAlpha = 1;
            px(pxX - 3, pxY - 3, 6, 6, '#ffffff');
            px(pxX - 2, pxY - 2, 4, 4, col);
          }
        }
        ctx.restore();
      }
    }

    function drawOfficeCat(dt, t) {
      if (!rooms.length) return;
      if (!reduced.matches) {
        cat.timer -= dt;
        if (cat.state === 'walk') {
          const dx = cat.tx - cat.x, dy = cat.ty - cat.y, dist = Math.hypot(dx, dy);
          if (dist < 4) {
            cat.state = 'sit'; cat.timer = 3 + Math.random() * 4;
          } else {
            cat.x += (dx / dist) * 26 * dt;
            cat.y += (dy / dist) * 26 * dt;
            cat.dir = dx >= 0 ? 1 : -1;
          }
        } else if (cat.timer <= 0) {
          const r = rooms[Math.floor(Math.random() * rooms.length)];
          cat.tx = r.x + 48 + Math.random() * Math.max(40, r.w - 96);
          cat.ty = r.y + r.h - 28;
          cat.state = 'walk';
          cat.timer = 6;
        }
      }
      const cx = Math.round(cat.x), cy = Math.round(cat.y);
      const step = cat.state === 'walk' && !reduced.matches ? Math.floor(t * 6) % 2 : 0;
      // Cute pixel orange tabby cat
      px(cx - 6, cy - 5, 12, 7, '#f59e0b');
      px(cx - 4, cy - 5, 2, 3, '#b45309'); // tabby stripes
      px(cx, cy - 5, 2, 3, '#b45309');
      // Head
      const hx = cat.dir > 0 ? cx + 3 : cx - 9;
      px(hx, cy - 10, 7, 6, '#fbbf24');
      px(hx, cy - 12, 2, 2, '#f59e0b'); // ears
      px(hx + 5, cy - 12, 2, 2, '#f59e0b');
      px(hx + (cat.dir > 0 ? 4 : 1), cy - 8, 1.5, 1.5, '#1e293b'); // eye
      // Tail wag
      const tx = cat.dir > 0 ? cx - 8 : cx + 6;
      px(tx, cy - 7 + (Math.sin(t * 5) > 0 ? -1 : 0), 3, 4, '#d97706');
      // Paws
      px(cx - 4, cy + 2, 2, 2 + step, '#fef3c7');
      px(cx + 2, cy + 2, 2, 2 + (1 - step), '#fef3c7');
    }

    function updateAndDrawParticles(dt, t, theme) {
      if (reduced.matches) return;
      // Spawn subtle working code sparks
      for (const a of actors.values()) {
        if (a.visible && observation === 'live' && a.node.status === 'working' && Math.random() < dt * 2.4) {
          const ts = toolStyle(a.node.agent_tool || 'codex');
          particles.push({
            x: a.x + (Math.random() - 0.5) * 26,
            y: a.y - 14,
            vx: (Math.random() - 0.5) * 8,
            vy: -14 - Math.random() * 10,
            life: 1.2, maxLife: 1.2, color: ts.trim, kind: 'glyph',
            glyph: ['✦', '{ }', '</>', '⚡', '★', '01'][Math.floor(Math.random() * 6)],
            size: 2,
          });
        }
      }
      // Ambient garden petals or cyber fireflies
      if (particles.length < 48 && Math.random() < dt * 3.5) {
        particles.push({
          x: Math.random() * worldSize.width,
          y: pixelTheme === 'garden' ? 0 : Math.random() * worldSize.height,
          vx: pixelTheme === 'garden' ? 12 + Math.random() * 10 : (Math.random() - 0.5) * 10,
          vy: pixelTheme === 'garden' ? 14 + Math.random() * 10 : -6 - Math.random() * 6,
          life: 4.5, maxLife: 4.5, color: theme.particle, kind: 'ambient', size: pixelTheme === 'garden' ? 3 : 2,
        });
      }

      const next = [];
      for (const p of particles) {
        p.life -= dt;
        if (p.life <= 0) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
        ctx.save();
        ctx.globalAlpha = alpha * (p.kind === 'ambient' ? 0.65 : 0.9);
        if (p.kind === 'glyph') {
          ctx.fillStyle = p.color;
          ctx.font = 'bold 8px ui-monospace, monospace';
          ctx.fillText(p.glyph, p.x, p.y);
        } else {
          px(p.x, p.y, p.size, p.size, p.color);
        }
        ctx.restore();
        next.push(p);
      }
      particles = next;
    }

    function worldToScreen(wx, wy) {
      return {
        x: (wx - camera.x) * camera.zoom + canvas.clientWidth / 2,
        y: (wy - camera.y) * camera.zoom + canvas.clientHeight / 2,
      };
    }

    function screenToWorld(sx, sy) {
      return {
        x: (sx - canvas.clientWidth / 2) / camera.zoom + camera.x,
        y: (sy - canvas.clientHeight / 2) / camera.zoom + camera.y,
      };
    }

    function syncSpeechBubbles(now) {
      const shown = activeBubbles.filter(b => b.startAt <= now && b.until > now);
      const occupied = [];
      const w = host.clientWidth, h = host.clientHeight;
      const frag = [];
      for (const b of shown) {
        const a = actors.get(b.actorId);
        if (!a || !a.visible) continue;
        const pt = worldToScreen(a.x, a.y - 34);
        if (pt.x < 16 || pt.x > w - 16 || pt.y < 76 || pt.y > h - 60) continue;
        const bx = Math.max(114, Math.min(w - 114, pt.x));
        const rect = { l: bx - 108, r: bx + 108, t: pt.y - 58, b: pt.y };
        if (occupied.some(o => rect.l < o.r && rect.r > o.l && rect.t < o.b && rect.b > o.t)) continue;
        occupied.push(rect);
        const ts = toolStyle(a.node.agent_tool || 'codex');
        const working = observation === 'live' && a.node.status === 'working';
        frag.push(
          '<div class="pixel-bubble ' + (b.isReply ? 'pair-reply' : '') + '" data-pixel-actor="' + esc(a.id) + '" style="left:' + bx.toFixed(1) + 'px;top:' + pt.y.toFixed(1) + 'px;--tool-color:' + ts.color + '">' +
            '<div class="pixel-bubble-head"><span class="pixel-bubble-tool">' + esc(ts.short) + '</span><span class="pixel-bubble-name">' + esc(brief(personal.name(a.node), 14)) + '</span>' +
            (working ? '<span class="pixel-bubble-dots"><i></i><i></i><i></i></span>' : '') +
            '</div><div class="pixel-bubble-text">' + esc(b.text) + '</div></div>'
        );
      }
      if (cat.bubbleUntil > now && rooms.length) {
        const cpt = worldToScreen(cat.x, cat.y - 16);
        if (cpt.x > 60 && cpt.x < w - 60 && cpt.y > 76 && cpt.y < h - 60) {
          frag.push(
            '<div class="pixel-bubble cat-bubble" style="left:' + cpt.x.toFixed(1) + 'px;top:' + cpt.y.toFixed(1) + 'px">' +
              '<div class="pixel-bubble-head"><span>🐱 ' + esc(ui('办公室橘猫')) + '</span></div>' +
              '<div class="pixel-bubble-text">' + esc(cat.bubbleText) + '</div></div>'
          );
        }
      }
      const html = frag.join('');
      if (bubblesLayer.dataset.lastHtml !== html) {
        bubblesLayer.dataset.lastHtml = html;
        bubblesLayer.innerHTML = html;
      }
    }

    function renderFrame(ts) {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
      lastTs = ts;
      animTime += dt;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = host.clientWidth || 1, ch = host.clientHeight || 1;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }

      const theme = THEMES[pixelTheme] || THEMES.cozy;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = false;

      // Background canvas with subtle pixel dot-grid
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, cw, ch);
      const step = Math.max(16, Math.round(24 * camera.zoom));
      const ox = ((cw / 2 - camera.x * camera.zoom) % step + step) % step;
      const oy = ((ch / 2 - camera.y * camera.zoom) % step + step) % step;
      ctx.fillStyle = theme.bgGrid;
      for (let gx = ox; gx < cw; gx += step) {
        for (let gy = oy; gy < ch; gy += step) {
          ctx.fillRect(Math.round(gx), Math.round(gy), 2, 2);
        }
      }

      // World transform
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      ctx.scale(camera.zoom, camera.zoom);
      ctx.translate(-camera.x, -camera.y);

      for (const r of rooms) drawRoom(r, theme, animTime);
      drawEdges(animTime, theme);

      // Draw active paired dialogue glowing chat arc + traveling pixel signal orb
      const now = performance.now();
      for (const b of activeBubbles) {
        if (b.partnerId && b.startAt <= now && b.until > now) {
          const a1 = actors.get(b.actorId), a2 = actors.get(b.partnerId);
          if (a1 && a2 && a1.visible && a2.visible) {
            const cpx = (a1.x + a2.x) / 2, cpy = Math.min(a1.y, a2.y) - 62;
            ctx.save();
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(a1.x, a1.y - 26);
            ctx.quadraticCurveTo(cpx, cpy, a2.x, a2.y - 26);
            ctx.stroke();
            if (!reduced.matches) {
              const u = (animTime * 0.9 + (b.isReply ? 0.5 : 0)) % 1;
              const iu = 1 - u;
              const ox = iu * iu * a1.x + 2 * iu * u * cpx + u * u * a2.x;
              const oy = iu * iu * (a1.y - 26) + 2 * iu * u * cpy + u * u * (a2.y - 26);
              ctx.setLineDash([]);
              px(ox - 3, oy - 3, 6, 6, '#fffbeb');
              px(ox - 2, oy - 2, 4, 4, '#f59e0b');
            }
            ctx.restore();
          }
        }
      }

      // Depth-sorted actors
      const sortedActors = visibleActors().sort((a, b) => a.y - b.y);
      for (const a of sortedActors) drawDeskAndActor(a, theme, animTime);
      drawOfficeCat(dt, animTime);
      updateAndDrawParticles(dt, animTime, theme);

      ctx.restore();

      // Subtle atmospheric lighting overlay
      const grad = ctx.createRadialGradient(cw * 0.25, ch * 0.2, 40, cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.8);
      grad.addColorStop(0, theme.ambient);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cw, ch);

      ctx.restore();

      // Periodic lively agent conversations (every ~6.5s)
      if (!reduced.matches && now - lastChatterAt > 6500 && actors.size) {
        lastChatterAt = now;
        if (Math.random() < 0.18) {
          cat.bubbleText = catQuip(i18n.locale);
          cat.bubbleUntil = now + 4600;
          pushRadio(ui('办公室橘猫'), 'cat', cat.bubbleText);
        } else {
          triggerChatter(false);
        }
      }
      syncSpeechBubbles(now);
      $('agent-zoom-label').textContent = Math.round(camera.zoom * 100) + '%';

      raf = requestAnimationFrame(renderFrame);
    }

    function fit() {
      const cw = Math.max(320, host.clientWidth - 48);
      const ch = Math.max(240, host.clientHeight - 130);
      const z = Math.max(0.45, Math.min(2.0, Math.min(cw / worldSize.width, ch / worldSize.height)));
      camera.zoom = z;
      camera.x = worldSize.width / 2;
      camera.y = worldSize.height / 2 + 8;
      needsFit = false;
    }

    function zoom(factor, cx, cy) {
      const prev = camera.zoom;
      const next = Math.max(0.4, Math.min(3.0, prev * factor));
      if (cx !== undefined && cy !== undefined) {
        const before = screenToWorld(cx, cy);
        camera.zoom = next;
        const after = screenToWorld(cx, cy);
        camera.x += before.x - after.x;
        camera.y += before.y - after.y;
      } else {
        camera.zoom = next;
      }
    }

    function pan(dx, dy) {
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
    }

    function focus(id) {
      const a = actors.get(id);
      if (!a) return;
      camera.x = a.x + ($('agent-detail').hidden ? 0 : 120 / camera.zoom);
      camera.y = a.y;
      if (camera.zoom < 1.35) camera.zoom = 1.45;
      // Have the clicked character greet you!
      const now = performance.now();
      const line = buildSoloLine(a.node, i18n.locale);
      activeBubbles = activeBubbles.filter(x => x.actorId !== a.id);
      activeBubbles.push({ actorId: a.id, text: line, startAt: now, until: now + 6200, isReply: false, partnerId: '' });
      spawnBurst(a.x, a.y - 24, toolStyle(a.node.agent_tool || 'codex').color, 6);
    }

    function hitActor(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const pt = screenToWorld(clientX - rect.left, clientY - rect.top);
      let best = null, bestDist = 42;
      for (const a of actors.values()) {
        if (!a.visible) continue;
        const d = Math.hypot(pt.x - a.x, pt.y - (a.y - 2));
        if (d < bestDist) { best = a; bestDist = d; }
      }
      return best;
    }

    function hitCat(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const pt = screenToWorld(clientX - rect.left, clientY - rect.top);
      return Math.hypot(pt.x - cat.x, pt.y - (cat.y - 4)) < 18;
    }

    function showTooltip(a, sx, sy) {
      if (!a) { tooltip.hidden = true; return; }
      const n = a.node, ts = toolStyle(n.agent_tool || 'codex');
      tooltip.innerHTML =
        '<div class="pixel-tooltip-top"><span class="pixel-bubble-tool" style="--tool-color:' + ts.color + '">' + esc(ts.label) + '</span><span>' + esc(n.kind === 'subagent' ? 'Subagent' : ui('主 Agent')) + ' · ' + esc(n.project) + '</span></div>' +
        '<strong>' + esc(n.task_summary || n.title) + '</strong>' +
        '<small>' + esc(n.status_label) + ' · ' + esc(n.model) + '</small>';
      tooltip.hidden = false;
      tooltip.style.left = Math.max(10, Math.min(sx + 16, host.clientWidth - 260)) + 'px';
      tooltip.style.top = Math.max(10, Math.min(sy + 14, host.clientHeight - 125)) + 'px';
    }

    // Event bindings
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y, moved: false, id: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', e => {
      const rect = canvas.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        camera.x = drag.cx - dx / camera.zoom;
        camera.y = drag.cy - dy / camera.zoom;
        tooltip.hidden = true;
        return;
      }
      const hit = hitActor(e.clientX, e.clientY);
      hovered = hit ? hit.id : '';
      canvas.classList.toggle('hovering', Boolean(hit) || hitCat(e.clientX, e.clientY));
      showTooltip(hit, e.clientX - rect.left, e.clientY - rect.top);
    });
    const endDrag = e => {
      if (!drag) return;
      const wasMoved = drag.moved;
      if (canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
      drag = null;
      canvas.classList.remove('dragging');
      if (!wasMoved && e) {
        if (hitCat(e.clientX, e.clientY)) {
          cat.bubbleText = catQuip(i18n.locale);
          cat.bubbleUntil = performance.now() + 5000;
          spawnBurst(cat.x, cat.y - 10, '#f59e0b', 6);
          pushRadio(ui('办公室橘猫'), 'cat', cat.bubbleText);
          return;
        }
        const hit = hitActor(e.clientX, e.clientY);
        if (hit) onSelect(hit.id);
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', () => endDrag(null));
    canvas.addEventListener('pointerleave', () => { hovered = ''; tooltip.hidden = true; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.0028), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    bubblesLayer.addEventListener('click', e => {
      const b = e.target.closest('[data-pixel-actor]');
      if (b) onSelect(b.dataset.pixelActor);
    });

    hud.addEventListener('click', e => {
      const themeBtn = e.target.closest('button[data-pixel-theme]');
      if (themeBtn && THEMES[themeBtn.dataset.pixelTheme]) {
        pixelTheme = themeBtn.dataset.pixelTheme;
        try { localStorage.setItem('codex-pixel-theme', pixelTheme); } catch (_) {}
        syncThemeAttr();
        return;
      }
      if (e.target.closest('#pixel-spark-chat')) {
        lastChatterAt = performance.now();
        triggerChatter(true);
        return;
      }
      if (e.target.closest('#pixel-radio-toggle')) {
        radioPanel.hidden = !radioPanel.hidden;
        e.target.closest('#pixel-radio-toggle').setAttribute('aria-expanded', String(!radioPanel.hidden));
        renderRadioFeed();
      }
    });
    radioPanel.addEventListener('click', e => {
      if (e.target.closest('#pixel-radio-close')) {
        radioPanel.hidden = true;
        hud.querySelector('#pixel-radio-toggle')?.setAttribute('aria-expanded', 'false');
        return;
      }
      const item = e.target.closest('[data-radio-actor]');
      if (item && actors.has(item.dataset.radioActor)) {
        onSelect(item.dataset.radioActor);
      }
    });
    toolStrip.addEventListener('click', e => {
      const pill = e.target.closest('[data-pixel-tool]');
      if (!pill) return;
      activeToolFilter = pill.dataset.pixelTool;
      applyToolFilter();
    });

    function update(data) {
      selected = data.selected || '';
      observation = data.observation || 'offline';
      motionLive = Boolean(data.motion);
      edgesList = data.edges || [];
      const sig = personal.revision + '|' + (data.nodes || []).map(n => [n.id, n.project_id, n.agent_tool || 'codex'].join(':')).join('|');
      if (localeStamp !== i18n.locale) {
        localeStamp = i18n.locale;
        activeBubbles = [];
        cat.bubbleUntil = 0;
        syncLocalizedHud();
        renderRadioFeed();
        renderToolStrip();
        if (actors.size) triggerChatter(true);
      }
      if (sig !== topologySig) {
        topologySig = sig;
        buildLayout(data.nodes || []);
        renderToolStrip();
        if (needsFit || data.fit) fit();
        // Trigger an opening welcome banter when entering Pixel Studio!
        if (!activeBubbles.length && actors.size) {
          lastChatterAt = performance.now();
          triggerChatter(true);
        }
      } else {
        for (const n of data.nodes || []) {
          const a = actors.get(n.id);
          if (a) a.node = n;
        }
        if (data.fit) fit();
      }
    }

    function setVisible(val) {
      visible = Boolean(val);
      host.hidden = !visible;
      if (visible) {
        syncThemeAttr();
        syncLocalizedHud();
        if (!raf) { lastTs = 0; raf = requestAnimationFrame(renderFrame); }
      } else {
        cancelAnimationFrame(raf);
        raf = 0;
        tooltip.hidden = true;
      }
    }

    function debug() {
      return {
        available: true, mode: 'pixel', theme: pixelTheme, visible, ready: 'true',
        actors: [...actors.values()].map(a => ({ id: a.id, tool: a.node.agent_tool || 'codex', status: a.node.status, visible: a.visible })),
        rooms: rooms.length, bubbles: activeBubbles.length, radioCount: radioLog.length,
        camera: { ...camera },
      };
    }

    return { available: true, update, setVisible, fit, zoom, pan, focus, triggerChatter, debug, setPanModifier() {} };
  }

  window.CodexPixelOffice = { create, TOOL_STYLES, toolStyle };
})();
