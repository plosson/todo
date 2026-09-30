(() => {
  const $ = (sel) => document.querySelector(sel);
  const authGate = $('#auth-gate');
  const main = $('#main');
  const listEl = $('#todo-list');
  const emptyEl = $('#empty');
  const tagFilter = $('#tag-filter');
  let status = 'open';
  let selectedTag = '';
  let me = null;

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
    $('#logout-btn').hidden = true;
    $('#sessions-link').hidden = true;
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
    const { tags } = await tagsRes.json();
    renderTags(tags);
    renderTodos(todos);
  }

  function renderTags(tags) {
    const current = selectedTag;
    tagFilter.innerHTML = '<option value="">All tags</option>';
    for (const t of tags) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = `${t.name} (${t.count})`;
      if (t.name === current) opt.selected = true;
      tagFilter.appendChild(opt);
    }
  }

  function renderTodos(todos) {
    listEl.innerHTML = '';
    emptyEl.hidden = todos.length > 0;
    for (const t of todos) {
      const li = document.createElement('li');
      li.className = 'todo-item' + (t.done ? ' done' : '');
      li.dataset.id = t.id;
      const tagsHtml = t.tags.map((n) => `<span class="tag">${escapeHtml(n)}</span>`).join('');
      li.innerHTML = `
        <button type="button" class="check ${t.done ? 'checked' : ''}" aria-label="Toggle done"></button>
        <div class="todo-body">
          <div class="todo-title">${escapeHtml(t.title)}</div>
          <div class="tags">${tagsHtml}</div>
        </div>
        <button type="button" class="del" aria-label="Delete">×</button>`;
      listEl.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#title-input').value.trim();
    if (!title) return;
    const tagsRaw = $('#tags-input').value.trim();
    const tags = tagsRaw
      ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    const res = await api('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ title, tags }),
    });
    if (res.ok) {
      $('#title-input').value = '';
      $('#tags-input').value = '';
      await refresh();
    }
  });

  listEl.addEventListener('click', async (e) => {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;
    if (e.target.classList.contains('check')) {
      const done = e.target.classList.contains('checked');
      await api(`/api/todos/${id}/${done ? 'uncheck' : 'check'}`, { method: 'POST' });
      await refresh();
    } else if (e.target.classList.contains('del')) {
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

  tagFilter.addEventListener('change', () => {
    selectedTag = tagFilter.value;
    refresh();
  });

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  });

  init();
})();
