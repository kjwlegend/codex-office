/* Version checks are on demand; ordinary and offline reports make no GitHub requests. */
(() => {
  'use strict';
  const {ui} = window.CodexI18n;
  const metadata = JSON.parse(document.getElementById('app-release-data').textContent);
  const toggle = document.getElementById('release-toggle'), panel = document.getElementById('release-panel');
  const check = document.getElementById('check-release'), link = document.getElementById('release-link');
  const live = ['http:', 'https:'].includes(location.protocol) && ['127.0.0.1', 'localhost'].includes(location.hostname);
  const messages = {
    idle: '检查 GitHub 最新 Release', loading: '正在检查 GitHub…',
    update_available: '有新版本可用', up_to_date: '已是最新版本', local_ahead: '当前版本高于最新 Release',
    no_release: '尚未发布 Release', uncomparable: '此 Release 标签无法自动比较版本',
    error: '无法连接 GitHub，请稍后重试', unavailable: '请重新启动工作台后检查更新',
    offline: '启动本地工作台后可检查更新'
  };
  let state = {status: live ? 'idle' : 'offline'}, pending = false;
  function render() {
    const status = state.status;
    panel.dataset.status = status;
    document.getElementById('release-current').textContent = metadata.current_version;
    document.getElementById('release-latest').textContent = state.latest_version || '—';
    document.getElementById('release-status').textContent = ui(state.reason === 'rate_limit' ? 'GitHub 检查暂受限制，请稍后重试' : messages[status] || messages.error);
    const checked = document.getElementById('release-checked'), time = new Date(state.checked_at);
    checked.hidden = !state.checked_at || !Number.isFinite(time.getTime());
    if (!checked.hidden) checked.textContent = ui('最近检查：') + time.toLocaleTimeString(window.CodexI18n.locale === 'en' ? 'en-US' : 'zh-CN', {hour: '2-digit', minute: '2-digit'});
    check.disabled = pending || !live;
    check.textContent = ui(pending ? '正在检查…' : '检查更新');
    link.href = metadata.releases_url;
    // Keep all external links within this repository, even with an invalid API response.
    if (typeof state.release_url === 'string' && state.release_url.startsWith(metadata.releases_url + '/tag/')) link.href = state.release_url;
    toggle.querySelector('.release-update-dot').hidden = status !== 'update_available';
    toggle.setAttribute('aria-label', ui('版本与更新') + ' · ' + metadata.current_version + ' · ' + ui(messages[status] || messages.error));
    toggle.title = toggle.getAttribute('aria-label');
  }
  async function inspect(refresh = false) {
    if (pending || !live) return;
    pending = true; state = {status: 'loading'}; render();
    try {
      const response = await fetch('/api/release' + (refresh ? '?refresh=1' : ''), {cache: 'no-store', signal: AbortSignal.timeout(8000)});
      if (response.status === 404) state = {status: 'unavailable'};
      else {
        if (!response.ok) throw Error();
        const result = await response.json();
        if (!['update_available', 'up_to_date', 'local_ahead', 'no_release', 'uncomparable', 'error'].includes(result.status)) throw Error();
        state = result;
      }
    } catch (_) { state = {status: 'error'}; }
    finally { pending = false; render(); }
  }
  function close(restoreFocus = false) {
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    if (['idle', 'error', 'unavailable'].includes(state.status)) inspect();
    document.getElementById('close-release').focus();
  });
  check.addEventListener('click', () => inspect(true));
  document.getElementById('close-release').addEventListener('click', () => close(true));
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
  });
  window.addEventListener('codex:locale-change', render);
  window.addEventListener('hashchange', () => close());
  render();
})();
