// Presentational component; the workbench router owns navigation and filters.
(() => {
  'use strict';
  const root = document.getElementById('app-sidebar');
  if (!root) return;
  const items = [...root.querySelectorAll('.nav-item[data-page]')];
  window.WorkspaceSidebar = Object.freeze({
    setActive(page) {
      for (const item of items) {
        const selected = item.dataset.page === page;
        item.classList.toggle('active', selected);
        if (selected) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      }
    }
  });
})();
