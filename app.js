/* comit ver1 — 目標管理アプリ */
(() => {
  'use strict';

  const STORAGE_KEY = 'comit.v1';
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- 日付ユーティリティ ----------
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const todayKey = () => keyOf(new Date());
  const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
  const fmtMD = k => { const d = parseKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const fmtFull = k => { const d = parseKey(k); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- データ ----------
  // goal: { id, title, deadline, createdAt, habits:[{id,title,start}], tasks:[{id,title,date}], done:{ 'YYYY-MM-DD': [itemId] } }
  let state = load();
  let selectedDate = todayKey();
  let currentIndex = 0;

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && Array.isArray(data.goals)) return data;
    } catch (e) { /* 破損データは無視 */ }
    return { goals: [] };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('保存できませんでした'); }
  }

  // その日の対象アイテム（毎日の目標 + その日だけの目標）
  function itemsOn(goal, date) {
    const habits = goal.habits.filter(h => h.start <= date);
    const tasks = goal.tasks.filter(t => t.date === date);
    return { habits, tasks, all: [...habits, ...tasks] };
  }
  const isDone = (goal, date, id) => (goal.done[date] || []).includes(id);
  function rateOn(goal, date) {
    const { all } = itemsOn(goal, date);
    if (!all.length) return { done: 0, total: 0, rate: 0 };
    const done = all.filter(i => isDone(goal, date, i.id)).length;
    return { done, total: all.length, rate: done / all.length };
  }
  // 連続達成日数（今日が未達成でも昨日までの連続は維持）
  function streak(goal) {
    let d = todayKey();
    const t = rateOn(goal, d);
    if (!(t.total && t.rate === 1)) d = addDays(d, -1);
    let n = 0;
    while (d >= goal.createdAt) {
      const r = rateOn(goal, d);
      if (r.total && r.rate === 1) { n++; d = addDays(d, -1); } else break;
    }
    return n;
  }
  function totalCommits(goal) {
    return Object.values(goal.done).reduce((s, a) => s + a.length, 0);
  }

  // ---------- 描画 ----------
  const pager = $('#pager');
  const dots = $('#dots');

  function renderAll() {
    $('#todayLabel').textContent = (() => {
      const d = new Date();
      return `${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}）`;
    })();

    if (!state.goals.length) {
      pager.innerHTML = `
        <section class="page"><div class="welcome">
          <img src="assets/leaf.png" alt="">
          <h1>大きな目標を立てよう</h1>
          <p>まずは叶えたい「大きな目標」をひとつ。<br>そのために毎日コミットすることを決めて、<br>一歩ずつ育てていきましょう。</p>
          <button class="btn btn--primary" data-action="add-goal">＋ 目標をつくる</button>
        </div></section>`;
      dots.innerHTML = '';
      return;
    }
    pager.innerHTML = state.goals.map(g => `<section class="page" data-goal="${g.id}"></section>`).join('');
    state.goals.forEach(renderPage);
    dots.innerHTML = state.goals.length > 1 ? state.goals.map(() => '<span></span>').join('') : '';
    currentIndex = Math.min(currentIndex, state.goals.length - 1);
    scrollToIndex(currentIndex, false);
    updateDots();
  }

  function renderPage(goal) {
    const page = pager.querySelector(`[data-goal="${goal.id}"]`);
    if (!page) return;
    const today = todayKey();
    const sel = selectedDate;
    const { habits, tasks } = itemsOn(goal, sel);
    const r = rateOn(goal, sel);
    const st = streak(goal);

    // 期限
    let deadlineChip = '';
    if (goal.deadline) {
      const left = diffDays(today, goal.deadline);
      const txt = left > 0 ? `あと<b>${left}</b>日` : left === 0 ? '<b>今日</b>が期限' : `<b>${-left}</b>日経過`;
      deadlineChip = `<span class="chip ${left <= 7 ? 'chip--warn' : ''}">📅 ${fmtFull(goal.deadline)}まで・${txt}</span>`;
    }
    const startedDays = diffDays(goal.createdAt, today) + 1;

    // リング
    const R = 36, C = 2 * Math.PI * R;
    const gradId = `rg-${goal.id}`;
    const isToday = sel === today;
    const msg = !r.total ? '毎日の目標を追加しよう'
      : r.rate === 1 ? 'すべてコミット！すばらしい🌱'
      : r.done === 0 ? (isToday ? '今日もコミットしよう' : 'コミットなし')
      : `あと${r.total - r.done}つでコンプリート`;

    // 週ストリップ（今日までの7日間）
    const week = [];
    for (let i = 6; i >= 0; i--) week.push(addDays(today, -i));
    const weekHtml = week.map(k => {
      const wr = rateOn(goal, k);
      const full = wr.total && wr.rate === 1;
      const pr = 15, pc = 2 * Math.PI * pr;
      const pie = !full && wr.done ? `<svg class="pie" viewBox="0 0 34 34"><circle cx="17" cy="17" r="${pr}" fill="none" stroke="url(#${gradId})" stroke-width="3" stroke-linecap="round" stroke-dasharray="${pc}" stroke-dashoffset="${pc * (1 - wr.rate)}"/></svg>` : '';
      return `<button class="day ${full ? 'is-full' : ''} ${k === sel ? 'is-selected' : ''} ${k === today ? 'is-today' : ''}" data-action="select-day" data-date="${k}">
        <span class="day__dow">${DOW[parseKey(k).getDay()]}</span>
        <span class="day__dot">${pie}<span>${full ? '✓' : parseKey(k).getDate()}</span></span>
      </button>`;
    }).join('');

    const itemHtml = (it, isHabit) => {
      const done = isDone(goal, sel, it.id);
      let sub = '';
      if (isHabit) {
        const cnt = Object.values(goal.done).filter(a => a.includes(it.id)).length;
        sub = `<div class="item__sub">毎日・累計 <b>${cnt}</b> 回コミット</div>`;
      } else {
        sub = `<div class="item__sub">${isToday ? '今日' : fmtMD(sel)}だけ</div>`;
      }
      return `<div class="item ${done ? 'is-done' : ''}">
        <button class="item__main" data-action="toggle" data-id="${it.id}" aria-pressed="${done}">
          <span class="check"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          <span><div class="item__title">${esc(it.title)}</div>${sub}</span>
        </button>
        <span class="stamp">COMMIT</span>
        <button class="icon-btn" data-action="edit-item" data-id="${it.id}" aria-label="編集">${dotsIcon}</button>
      </div>`;
    };

    page.innerHTML = `
      <svg width="0" height="0" style="position:absolute"><defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1f7ff0"/><stop offset=".6" stop-color="#4cc9c0"/><stop offset="1" stop-color="#86dd68"/>
      </linearGradient></defs></svg>

      <article class="hero">
        <div class="hero__label"><img src="assets/leaf.png" alt="">大きな目標</div>
        <h2 class="hero__title">${esc(goal.title)}</h2>
        <div class="hero__meta">
          ${deadlineChip}
          <span class="chip">🌱 <b>${startedDays}</b>日目</span>
        </div>
        <button class="icon-btn" data-action="edit-goal" aria-label="目標を編集">${dotsIcon}</button>
      </article>

      <div class="summary">
        <div class="ring">
          <svg viewBox="0 0 84 84" width="84" height="84">
            <circle class="ring__track" cx="42" cy="42" r="${R}" fill="none" stroke-width="9"/>
            <circle class="ring__bar" cx="42" cy="42" r="${R}" fill="none" stroke="url(#${gradId})" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - r.rate)}" ${r.done ? '' : 'opacity="0"'}/>
          </svg>
          <div class="ring__text"><div>${r.done}/${r.total}<small>COMMIT</small></div></div>
        </div>
        <div class="summary__body">
          <div class="summary__head">${isToday ? '今日' : `${fmtMD(sel)}（${DOW[parseKey(sel).getDay()]}）`}のコミット</div>
          <div class="summary__msg">${msg}</div>
          <div class="summary__stats">
            <span>🔥 <b>${st}</b>日連続</span>
            <span>✓ 累計<b>${totalCommits(goal)}</b></span>
          </div>
        </div>
      </div>

      <div class="week">${weekHtml}</div>

      <section class="section">
        <div class="section__head">
          <h3 class="section__title">毎日の目標 <span class="section__count">${habits.filter(h => isDone(goal, sel, h.id)).length}/${habits.length}</span></h3>
          <button class="add-btn" data-action="add-item" data-type="habit">＋ 追加</button>
        </div>
        <div class="list">
          ${habits.length ? habits.map(h => itemHtml(h, true)).join('')
            : '<button class="empty" data-action="add-item" data-type="habit">毎日続けることを追加しよう<br>例：毎朝30分勉強する</button>'}
        </div>
      </section>

      <section class="section">
        <div class="section__head">
          <h3 class="section__title">${isToday ? '今日' : fmtMD(sel)}だけの目標 <span class="section__count">${tasks.filter(t => isDone(goal, sel, t.id)).length}/${tasks.length}</span></h3>
          <button class="add-btn" data-action="add-item" data-type="task">＋ 追加</button>
        </div>
        <div class="list">
          ${tasks.length ? tasks.map(t => itemHtml(t, false)).join('')
            : `<button class="empty" data-action="add-item" data-type="task">${isToday ? '今日' : 'この日'}やることを追加しよう</button>`}
        </div>
      </section>

      <section class="section">
        <div class="section__head"><h3 class="section__title">コミット履歴</h3></div>
        ${heatmapHtml(goal)}
      </section>
    `;
  }

  const dotsIcon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>';

  // 直近5週間のヒートマップ（日曜はじまり）
  function heatmapHtml(goal) {
    const today = todayKey();
    const end = addDays(today, 6 - parseKey(today).getDay());
    const start = addDays(end, -34);
    let cells = DOW.map(d => `<div class="heat__dow">${d}</div>`).join('');
    for (let k = start; k <= end; k = addDays(k, 1)) {
      if (k > today) { cells += '<div class="heat__cell is-empty"></div>'; continue; }
      const r = rateOn(goal, k);
      const lv = !r.done ? 0 : r.rate === 1 ? 4 : r.rate >= .66 ? 3 : r.rate >= .33 ? 2 : 1;
      cells += `<div class="heat__cell l${lv} ${k === today ? 'is-today' : ''}" title="${fmtMD(k)} ${r.done}/${r.total}"></div>`;
    }
    return `<div class="heat"><div class="heat__grid">${cells}</div>
      <div class="heat__legend">少<i class="heat__cell"></i><i class="heat__cell l1"></i><i class="heat__cell l2"></i><i class="heat__cell l3"></i><i class="heat__cell l4"></i>コンプリート</div></div>`;
  }

  // ---------- ページ送り（左右フリック） ----------
  function scrollToIndex(i, smooth = true) {
    pager.scrollTo({ left: i * pager.clientWidth, behavior: smooth ? 'smooth' : 'instant' });
  }
  function updateDots() {
    [...dots.children].forEach((d, i) => d.classList.toggle('is-active', i === currentIndex));
  }
  let scrollTimer;
  pager.addEventListener('scroll', () => {
    const i = Math.round(pager.scrollLeft / pager.clientWidth);
    if (i !== currentIndex) { currentIndex = i; updateDots(); }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      // 目標を切り替えたら表示日を今日に戻す
      if (selectedDate !== todayKey()) { selectedDate = todayKey(); state.goals.forEach(renderPage); }
    }, 400);
  }, { passive: true });
  window.addEventListener('resize', () => scrollToIndex(currentIndex, false));

  const currentGoal = () => state.goals[currentIndex];
  const goalOf = el => state.goals.find(g => g.id === el.closest('[data-goal]')?.dataset.goal);

  // ---------- 操作 ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const goal = goalOf(el);
    switch (el.dataset.action) {
      case 'add-goal': openGoalSheet(); break;
      case 'edit-goal': openGoalSheet(goal); break;
      case 'select-day':
        selectedDate = el.dataset.date;
        renderPage(goal);
        break;
      case 'toggle': toggle(goal, el.dataset.id, el); break;
      case 'add-item': openItemSheet(goal, el.dataset.type); break;
      case 'edit-item': {
        const id = el.dataset.id;
        const h = goal.habits.find(x => x.id === id);
        openItemSheet(goal, h ? 'habit' : 'task', h || goal.tasks.find(x => x.id === id));
        break;
      }
    }
  });
  $('#fab').addEventListener('click', () => openGoalSheet());

  function toggle(goal, id, el) {
    const list = goal.done[selectedDate] || (goal.done[selectedDate] = []);
    const idx = list.indexOf(id);
    const committing = idx < 0;
    if (committing) list.push(id); else list.splice(idx, 1);
    if (!list.length) delete goal.done[selectedDate];
    save();
    if (committing) {
      navigator.vibrate?.(12);
      const rect = el.querySelector('.check').getBoundingClientRect();
      burst(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    const before = { scroll: el.closest('.page').scrollTop };
    renderPage(goal);
    pager.querySelector(`[data-goal="${goal.id}"]`).scrollTop = before.scroll;
    const r = rateOn(goal, selectedDate);
    if (committing && r.rate === 1) toast(selectedDate === todayKey() ? '🎉 今日の目標をすべてコミット！' : '🎉 この日の目標をコンプリート！');
  }

  // ---------- ボトムシート ----------
  const sheet = $('#sheet');
  const sheetForm = $('#sheetForm');
  let onSubmit = null, onDelete = null;

  function openSheet({ title, body, submitLabel = '保存', deletable = false, submit, del }) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = body;
    $('#sheetSubmit').textContent = submitLabel;
    $('#sheetDelete').hidden = !deletable;
    onSubmit = submit; onDelete = del;
    sheet.hidden = false;
    setTimeout(() => sheetForm.querySelector('input[type=text]')?.focus(), 250);
  }
  function closeSheet() { sheet.hidden = true; onSubmit = onDelete = null; }
  sheet.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
  sheetForm.addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(sheetForm));
    if (!data.title?.trim()) { sheetForm.querySelector('[name=title]').focus(); return; }
    data.title = data.title.trim();
    onSubmit?.(data);
    closeSheet();
  });
  $('#sheetDelete').addEventListener('click', () => { onDelete?.(); closeSheet(); });

  function openGoalSheet(goal) {
    const edit = !!goal;
    openSheet({
      title: edit ? '大きな目標を編集' : '新しい大きな目標',
      submitLabel: edit ? '保存' : '目標をつくる',
      deletable: edit,
      body: `
        <label class="field"><span class="field__label">大きな目標</span>
          <input class="input" type="text" name="title" maxlength="60" placeholder="例：TOEIC 800点をとる" value="${edit ? esc(goal.title) : ''}"></label>
        <label class="field"><span class="field__label">期限（達成予定日）</span>
          <input class="input" type="date" name="deadline" min="${todayKey()}" value="${edit ? goal.deadline || '' : ''}">
          <div class="field__hint">未設定でもOK。設定すると残り日数を表示します。</div></label>`,
      submit: data => {
        if (edit) {
          goal.title = data.title; goal.deadline = data.deadline || '';
          save(); renderPage(goal);
        } else {
          state.goals.push({ id: uid(), title: data.title, deadline: data.deadline || '', createdAt: todayKey(), habits: [], tasks: [], done: {} });
          save();
          currentIndex = state.goals.length - 1;
          selectedDate = todayKey();
          renderAll();
          toast('🌱 目標をつくりました。毎日の目標を追加しよう');
        }
      },
      del: () => {
        if (!confirm(`「${goal.title}」を削除しますか？\nコミット記録もすべて消えます。`)) return;
        state.goals = state.goals.filter(g => g !== goal);
        save();
        currentIndex = Math.max(0, currentIndex - 1);
        renderAll();
      },
    });
  }

  function openItemSheet(goal, type, item) {
    const edit = !!item;
    const habitStart = selectedDate;
    openSheet({
      title: edit ? '目標を編集' : 'コミットする目標を追加',
      submitLabel: edit ? '保存' : '追加',
      deletable: edit,
      body: `
        <label class="field"><span class="field__label">内容</span>
          <input class="input" type="text" name="title" maxlength="50" placeholder="${type === 'habit' ? '例：毎朝30分 英単語' : '例：模試の申し込み'}" value="${edit ? esc(item.title) : ''}"></label>
        ${edit ? '' : `<div class="field"><span class="field__label">種類</span>
          <div class="seg">
            <label><input type="radio" name="type" value="habit" ${type === 'habit' ? 'checked' : ''}><span>毎日<small>くり返しコミット</small></span></label>
            <label><input type="radio" name="type" value="task" ${type === 'task' ? 'checked' : ''}><span>${selectedDate === todayKey() ? '今日' : fmtMD(selectedDate)}だけ<small>その日かぎり</small></span></label>
          </div></div>`}`,
      submit: data => {
        if (edit) item.title = data.title;
        else if (data.type === 'habit') goal.habits.push({ id: uid(), title: data.title, start: habitStart });
        else goal.tasks.push({ id: uid(), title: data.title, date: selectedDate });
        save(); renderPage(goal);
      },
      del: () => {
        if (!confirm(`「${item.title}」を削除しますか？`)) return;
        goal.habits = goal.habits.filter(x => x !== item);
        goal.tasks = goal.tasks.filter(x => x !== item);
        for (const k of Object.keys(goal.done)) {
          goal.done[k] = goal.done[k].filter(id => id !== item.id);
          if (!goal.done[k].length) delete goal.done[k];
        }
        save(); renderPage(goal);
      },
    });
  }

  // ---------- 演出 ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-show'), 2400);
  }
  const LEAF_COLORS = ['#1f7ff0', '#38b4ee', '#4cc9c0', '#86dd68'];
  function burst(x, y) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (let i = 0; i < 10; i++) {
      const s = document.createElement('i');
      s.className = 'leaf';
      const a = Math.random() * Math.PI * 2, dist = 30 + Math.random() * 40;
      s.style.left = `${x - 7}px`; s.style.top = `${y - 7}px`;
      s.style.background = LEAF_COLORS[i % LEAF_COLORS.length];
      s.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
      s.style.setProperty('--dy', `${Math.sin(a) * dist - 20}px`);
      s.style.setProperty('--r', `${Math.random() * 360}deg`);
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  // 日付が変わったら再描画（アプリを開きっぱなしの場合）
  let lastDay = todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lastDay !== todayKey()) {
      lastDay = selectedDate = todayKey();
      renderAll();
    }
  });

  // ---------- 起動 ----------
  renderAll();
  const splash = $('#splash');
  const hideSplash = () => { splash.classList.add('is-hidden'); setTimeout(() => splash.remove(), 700); };
  window.addEventListener('load', () => setTimeout(hideSplash, 1600));
  splash.addEventListener('click', hideSplash);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ブラウザでの確認用
  window.__comit = { get state() { return state; } };
})();
