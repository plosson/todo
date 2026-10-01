(() => {
  const $ = (sel) => document.querySelector(sel);
  const authGate = $('#auth-gate');
  const main = $('#main');
  const groupsEl = $('#groups');
  const emptyEl = $('#empty');
  const tagChips = $('#tag-chips');
  const fab = $('#fab');
  const sheet = $('#add-form');
  const titleInput = $('#title-input');
  const tagsInput = $('#tags-input');
  let status = 'open';
  let selectedTag = '';
  let allTags = [];
  let me = null;

  const VIEW_TITLES = { open: 'Open', done: 'Done', all: 'Everything' };
  const EMPTY = {
    open: ['All clear', 'Nothing left to do. Tap + to add something.'],
    done: ['Nothing done yet', 'Checked-off todos show up here.'],
    all: ['Your list is empty', 'Tap + to add your first todo.'],
  };
  const CHECK_ANIMATION_MS = 320;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    return res;
  }

  async function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const meRes = await api('/api/auth/me');
    if (meRes.ok) {
      me = await meRes.json();
      showMain();
      await refresh();
      return;
    }
    await showAuth();
  }

  async function showAuth() {
    authGate.hidden = false;
    main.hidden = true;
    fab.hidden = true;
    $('#logout-btn').hidden = true;
    $('#sessions-link').hidden = true;
    $('#view-title').textContent = 'Todo';
    $('#view-subtitle').textContent = '';
    const methods = await (await api('/api/auth/methods')).json();
    const buttons = $('#auth-buttons');
    buttons.innerHTML = '';
    if (methods.google) {
      const a = document.createElement('a');
      a.className = 'btn primary';
      a.href = '/api/auth/google/start?redirectTo=/';
      a.textContent = 'Continue with Google';
      buttons.appendChild(a);
    }
    if (methods.dev) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary';
      b.id = 'dev-login';
      b.textContent = 'Continue as dev';
      b.addEventListener('click', async () => {
        const res = await api('/api/auth/dev', {
          method: 'POST',
          body: JSON.stringify({ email: 'dev@localhost', displayName: 'Dev User' }),
        });
        if (res.ok) location.reload();
        else alert('Dev login failed');
      });
      buttons.appendChild(b);
    }
    if (!methods.google && !methods.dev) {
      buttons.innerHTML = '<p class="muted">No sign-in methods configured.</p>';
    }
  }

  function showMain() {
    authGate.hidden = true;
    main.hidden = false;
    fab.hidden = false;
    $('#logout-btn').hidden = false;
    $('#sessions-link').hidden = false;
  }

  async function refresh() {
    const params = new URLSearchParams({ status });
    if (selectedTag) params.set('tag', selectedTag);
    const [todosRes, tagsRes] = await Promise.all([
      api('/api/todos?' + params),
      api('/api/tags'),
    ]);
    if (!todosRes.ok) {
      if (todosRes.status === 401) return showAuth();
      return;
    }
    const { todos } = await todosRes.json();
    allTags = (await tagsRes.json()).tags;
    renderHeader(todos);
    renderTagChips();
    renderTodos(todos);
  }

  function renderHeader(todos) {
    $('#view-title').textContent = selectedTag ? `#${selectedTag}` : VIEW_TITLES[status];
    const today = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date());
    const open = todos.filter((t) => !t.done).length;
    const done = todos.length - open;
    const count =
      status === 'done' ? `${done} done` : status === 'all' ? `${open} open · ${done} done` : `${open} open`;
    $('#view-subtitle').textContent = `${today} · ${count}`;
  }

  function renderTagChips() {
    if (selectedTag && !allTags.some((t) => t.name === selectedTag)) selectedTag = '';
    tagChips.innerHTML = '';
    tagChips.hidden = allTags.length === 0;
    tagChips.appendChild(tagChip('', 'All tags', null));
    for (const t of allTags) tagChips.appendChild(tagChip(t.name, t.name, t.count));
  }

  function tagChip(name, label, count) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag-chip' + (name === selectedTag ? ' active' : '');
    b.dataset.tag = name;
    if (name) b.style.setProperty('--h', String(tagHue(name)));
    b.textContent = label;
    if (count !== null) {
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(count);
      b.appendChild(n);
    }
    return b;
  }

  function renderTodos(todos) {
    groupsEl.innerHTML = '';
    emptyEl.hidden = todos.length > 0;
    if (todos.length === 0) {
      const [title, copy] = EMPTY[status];
      $('#empty-title').textContent = title;
      $('#empty-copy').textContent = copy;
      return;
    }
    if (status === 'all') {
      const open = todos.filter((t) => !t.done);
      const done = todos.filter((t) => t.done);
      if (open.length) groupsEl.appendChild(group(null, open));
      if (done.length) groupsEl.appendChild(group('Completed', done));
    } else {
      groupsEl.appendChild(group(null, todos));
    }
  }

  function group(title, todos) {
    const section = document.createElement('section');
    section.className = 'group';
    if (title) {
      const h = document.createElement('h2');
      h.className = 'group-title';
      h.innerHTML = `${escapeHtml(title)} <span class="count">${todos.length}</span>`;
      section.appendChild(h);
    }
    const ul = document.createElement('ul');
    ul.className = 'todo-list';
    for (const t of todos) ul.appendChild(todoItem(t));
    section.appendChild(ul);
    return section;
  }

  function todoItem(t) {
    const li = document.createElement('li');
    li.className = 'todo-item' + (t.done ? ' done' : '');
    li.dataset.id = t.id;
    const tagsHtml = t.tags
      .map((n) => `<span class="tag" style="--h:${tagHue(n)}">${escapeHtml(n)}</span>`)
      .join('');
    const via =
      t.createdVia && t.createdVia.kind === 'api_token'
        ? `<span class="via" title="Added by an agent">${BOT_ICON}${escapeHtml(t.createdVia.label || 'agent')}</span>`
        : '';
    const meta = tagsHtml || via ? `<div class="meta">${tagsHtml}${via}</div>` : '';
    li.innerHTML = `
      <button type="button" class="check ${t.done ? 'checked' : ''}" aria-label="Toggle done">${CHECK_ICON}</button>
      <div class="todo-body">
        <div class="todo-title">${escapeHtml(t.title)}</div>
        ${meta}
      </div>
      <button type="button" class="del" aria-label="Delete">${TRASH_ICON}</button>`;
    return li;
  }

  // Hues spread far apart so neighbouring tags never look alike.
  const TAG_HUES = [250, 205, 165, 135, 28, 340, 285, 8];

  /** Same tag name, same colour, everywhere. */
  function tagHue(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return TAG_HUES[h % TAG_HUES.length];
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const CHECK_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>';
  const TRASH_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  const BOT_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>';

  // --- Add sheet -----------------------------------------------------------

  function openSheet() {
    if (selectedTag && !tagsInput.value) tagsInput.value = selectedTag;
    renderSuggestions();
    sheet.inert = false;
    document.body.classList.add('sheet-open');
    titleInput.focus();
  }

  function closeSheet() {
    document.body.classList.remove('sheet-open');
    sheet.inert = true;
    fab.focus();
  }

  function currentTagInput() {
    return tagsInput.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function renderSuggestions() {
    const box = $('#tag-suggestions');
    box.innerHTML = '';
    const chosen = new Set(currentTagInput().map((t) => t.toLowerCase()));
    for (const t of allTags) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tag suggestion' + (chosen.has(t.name) ? ' chosen' : '');
      b.style.setProperty('--h', String(tagHue(t.name)));
      b.dataset.tag = t.name;
      b.textContent = t.name;
      box.appendChild(b);
    }
  }

  fab.addEventListener('click', openSheet);
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) closeSheet();
  });
  tagsInput.addEventListener('input', renderSuggestions);

  $('#tag-suggestions').addEventListener('click', (e) => {
    const b = e.target.closest('.suggestion');
    if (!b) return;
    const tags = currentTagInput();
    const i = tags.findIndex((t) => t.toLowerCase() === b.dataset.tag);
    if (i >= 0) tags.splice(i, 1);
    else tags.push(b.dataset.tag);
    tagsInput.value = tags.join(', ');
    renderSuggestions();
  });

  sheet.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    const res = await api('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ title, tags: currentTagInput() }),
    });
    if (res.ok) {
      // Stay open for quick entry of several todos in a row.
      titleInput.value = '';
      tagsInput.value = selectedTag;
      titleInput.focus();
      await refresh();
      renderSuggestions();
    }
  });

  // --- List interactions ---------------------------------------------------

  groupsEl.addEventListener('click', async (e) => {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;
    const check = e.target.closest('.check');
    if (check) {
      const done = check.classList.contains('checked');
      if (!done) {
        // Let the check animation play before the item leaves the list.
        check.classList.add('checked');
        item.classList.add('completing');
        await new Promise((r) => setTimeout(r, CHECK_ANIMATION_MS));
      }
      await api(`/api/todos/${id}/${done ? 'uncheck' : 'check'}`, { method: 'POST' });
      await refresh();
    } else if (e.target.closest('.del')) {
      if (!confirm('Delete this todo?')) return;
      await api(`/api/todos/${id}`, { method: 'DELETE' });
      await refresh();
    }
  });

  document.querySelectorAll('.chip[data-status]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-status]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      status = chip.dataset.status;
      refresh();
    });
  });

  tagChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.tag-chip');
    if (!chip) return;
    selectedTag = chip.dataset.tag;
    refresh();
  });

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  });

  init();
})();
