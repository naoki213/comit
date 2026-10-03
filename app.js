/* comit ver2 — 目標管理アプリ */
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
  const sundayOf = k => addDays(k, -parseKey(k).getDay());
  const fmtMD = k => { const d = parseKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const fmtFull = k => { const d = parseKey(k); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- データ ----------
  // goal: { id, title, deadline, createdAt,
  //         habits:[{id,title,start,archivedAt?,pauses?:[[from,to)]}],
  //         tasks:[{id,title,date,carriedFrom?}],
  //         done:{ 'YYYY-MM-DD': [itemId] } }
  let state = load();
  let selectedDate = todayKey();
  let currentIndex = 0;
  const weekPos = new Map();     // 目標ごとの表示中の週（index）
  const archiveOpen = new Set(); // アーカイブ欄を開いている目標

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

  // 毎日の目標がその日に対象かどうか（アーカイブ・休止期間を除く）
  const habitActiveOn = (h, d) =>
    h.start <= d &&
    !(h.archivedAt && d >= h.archivedAt) &&
    !(h.pauses || []).some(([from, to]) => d >= from && d < to);

  // その日の対象アイテム（毎日の目標 + その日だけの目標）
  function itemsOn(goal, date) {
    const habits = goal.habits.filter(h => habitActiveOn(h, date));
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
  const totalCommits = goal => Object.values(goal.done).reduce((s, a) => s + a.length, 0);
  // 過去の未完了の「今日だけの目標」
  const leftovers = goal => goal.tasks
    .filter(t => t.date < todayKey() && !isDone(goal, t.date, t.id))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 曜日欄の週の範囲：目標を作った週〜期限の週（期限なしは1年先まで）
  function weekRange(goal) {
    const today = todayKey();
    let end = goal.deadline || addDays(today, 365);
    if (end < today) end = today;
    const weeks = [];
    for (let w = sundayOf(goal.createdAt); w <= sundayOf(end); w = addDays(w, 7)) weeks.push(w);
    return weeks;
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
    currentIndex = Math.min(currentIndex, state.goals.length - 1);
    scrollToIndex(currentIndex, false);
    state.goals.forEach(renderPage);
    dots.innerHTML = state.goals.length > 1 ? state.goals.map(() => '<span></span>').join('') : '';
    updateDots();
  }

  const dotsIcon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>';
  const checkIcon = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderPage(goal) {
    const page = pager.querySelector(`[data-goal="${goal.id}"]`);
    if (!page) return;
    const today = todayKey();
    const sel = selectedDate;
    const isToday = sel === today;
    const isFuture = sel > today;
    const { habits, tasks } = itemsOn(goal, sel);
    const r = rateOn(goal, sel);
    const gradId = `rg-${goal.id}`;
    const dayName = isToday ? '今日' : fmtMD(sel);

    // 期限
    let deadlineChip = '';
    if (goal.deadline) {
      const left = diffDays(today, goal.deadline);
      const txt = left > 0 ? `あと<b>${left}</b>日` : left === 0 ? '<b>今日</b>が期限' : `<b>${-left}</b>日経過`;
      deadlineChip = `<span class="chip ${left <= 7 ? 'chip--warn' : ''}">📅 ${fmtFull(goal.deadline)}まで・${txt}</span>`;
    }

    // リング
    const R = 36, C = 2 * Math.PI * R;
    const msg = isFuture ? (r.total ? `${r.total}件の予定` : '予定はまだありません')
      : !r.total ? '毎日の目標を追加しよう'
      : r.rate === 1 ? 'すべてコミット！すばらしい🌱'
      : r.done === 0 ? (isToday ? '今日もコミットしよう' : 'コミットなし')
      : `あと${r.total - r.done}つでコンプリート`;

    const itemHtml = (it, isHabit) => {
      const done = isDone(goal, sel, it.id);
      let sub;
      if (isHabit) {
        const cnt = Object.values(goal.done).filter(a => a.includes(it.id)).length;
        sub = `毎日・累計 <b>${cnt}</b> 回コミット`;
      } else {
        sub = it.carriedFrom ? `${fmtMD(it.carriedFrom)}から持ち越し` : `${dayName}だけ`;
      }
      const main = isFuture
        ? `<div class="item__main"><span class="check"></span><span><div class="item__title">${esc(it.title)}</div><div class="item__sub">${sub}</div></span></div>`
        : `<button class="item__main" data-action="toggle" data-id="${it.id}" aria-pressed="${done}">
            <span class="check">${checkIcon}</span>
            <span><div class="item__title">${esc(it.title)}</div><div class="item__sub">${sub}</div></span>
          </button>`;
      return `<div class="item ${done ? 'is-done' : ''} ${isFuture ? 'is-future' : ''}">
        ${main}
        <span class="stamp">COMMIT</span>
        <button class="icon-btn" data-action="edit-item" data-id="${it.id}" aria-label="編集">${dotsIcon}</button>
      </div>`;
    };

    // やり残し（今日を表示しているときだけ）
    const left = isToday ? leftovers(goal) : [];
    const leftHtml = left.length ? `
      <section class="section carry">
        <div class="section__head">
          <h3 class="section__title">やり残し <span class="section__count">${left.length}</span></h3>
          ${left.length > 1 ? '<button class="add-btn" data-action="carry-all">すべて今日へ</button>' : ''}
        </div>
        <div class="list">
          ${left.map(t => `<div class="carry__item">
            <div class="carry__body"><div class="item__title">${esc(t.title)}</div>
              <div class="item__sub">${fmtMD(t.date)}（${DOW[parseKey(t.date).getDay()]}）の目標・未完了</div></div>
            <button class="pill pill--primary" data-action="carry" data-id="${t.id}">今日へ</button>
            <button class="pill" data-action="drop" data-id="${t.id}">削除</button>
          </div>`).join('')}
        </div>
      </section>` : '';

    // アーカイブ済みの毎日の目標
    const archived = goal.habits.filter(h => h.archivedAt);
    const archiveHtml = archived.length ? `
      <details class="archive" data-archive ${archiveOpen.has(goal.id) ? 'open' : ''}>
        <summary>アーカイブ済み（${archived.length}）</summary>
        ${archived.map(h => `<div class="archive__item">
          <div class="carry__body"><div class="item__title">${esc(h.title)}</div>
            <div class="item__sub">${fmtMD(addDays(h.archivedAt, -1))}まで・記録は保存されています</div></div>
          <button class="pill pill--primary" data-action="restore" data-id="${h.id}">復元</button>
          <button class="pill pill--danger" data-action="purge" data-id="${h.id}">削除</button>
        </div>`).join('')}
      </details>` : '';

    page.innerHTML = `
      <svg width="0" height="0" style="position:absolute"><defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1f7ff0"/><stop offset=".6" stop-color="#4cc9c0"/><stop offset="1" stop-color="#86dd68"/>
      </linearGradient></defs></svg>

      <article class="hero">
        <div class="hero__label"><img src="assets/leaf.png" alt="">大きな目標</div>
        <h2 class="hero__title">${esc(goal.title)}</h2>
        <div class="hero__meta">
          ${deadlineChip}
          <span class="chip">🌱 <b>${diffDays(goal.createdAt, today) + 1}</b>日目</span>
        </div>
        <button class="icon-btn" data-action="edit-goal" aria-label="目標を編集">${dotsIcon}</button>
      </article>

      <div class="summary ${isFuture ? 'is-future' : ''}">
        <div class="ring">
          <svg viewBox="0 0 84 84" width="84" height="84">
            <circle class="ring__track" cx="42" cy="42" r="${R}" fill="none" stroke-width="9"/>
            <circle class="ring__bar" cx="42" cy="42" r="${R}" fill="none" stroke="url(#${gradId})" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - r.rate)}" ${r.done ? '' : 'opacity="0"'}/>
          </svg>
          <div class="ring__text"><div>${r.done}/${r.total}<small>COMMIT</small></div></div>
        </div>
        <div class="summary__body">
          <div class="summary__head">${isToday ? '今日のコミット' : `${fmtMD(sel)}（${DOW[parseKey(sel).getDay()]}）の${isFuture ? '予定' : 'コミット'}`}</div>
          <div class="summary__msg">${msg}</div>
          <div class="summary__stats">
            <span>🔥 <b>${streak(goal)}</b>日連続</span>
            <span>✓ 累計<b>${totalCommits(goal)}</b></span>
          </div>
        </div>
      </div>

      ${weekbarHtml(goal, gradId)}

      ${leftHtml}

      <section class="section">
        <div class="section__head">
          <h3 class="section__title">毎日の目標 <span class="section__count">${habits.filter(h => isDone(goal, sel, h.id)).length}/${habits.length}</span></h3>
          <button class="add-btn" data-action="add-item" data-type="habit">＋ 追加</button>
        </div>
        <div class="list">
          ${habits.length ? habits.map(h => itemHtml(h, true)).join('')
            : '<button class="empty" data-action="add-item" data-type="habit">毎日続けることを追加しよう<br>例：毎朝30分勉強する</button>'}
        </div>
        ${archiveHtml}
      </section>

      <section class="section">
        <div class="section__head">
          <h3 class="section__title">${dayName}だけの目標 <span class="section__count">${tasks.filter(t => isDone(goal, sel, t.id)).length}/${tasks.length}</span></h3>
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
    setupWeeks(page, goal);
  }

  // ---------- 曜日欄（日曜はじまり・週単位で左右スクロール） ----------
  function weekbarHtml(goal, gradId) {
    const today = todayKey();
    const pages = weekRange(goal).map(w => {
      let days = '';
      for (let i = 0; i < 7; i++) {
        const k = addDays(w, i);
        const out = k < goal.createdAt;
        const future = k > today;
        const wr = rateOn(goal, k);
        const full = !future && wr.total && wr.rate === 1;
        const pr = 15, pc = 2 * Math.PI * pr;
        const pie = !out && !future && !full && wr.done
          ? `<svg class="pie" viewBox="0 0 34 34"><circle cx="17" cy="17" r="${pr}" fill="none" stroke="url(#${gradId})" stroke-width="3" stroke-linecap="round" stroke-dasharray="${pc}" stroke-dashoffset="${pc * (1 - wr.rate)}"/></svg>`
          : '';
        const hasPlan = future && goal.tasks.some(t => t.date === k);
        const cls = ['day', full && 'is-full', k === selectedDate && 'is-selected', k === today && 'is-today',
          out && 'is-out', future && 'is-future', k === goal.deadline && 'is-deadline'].filter(Boolean).join(' ');
        days += `<button class="${cls}" ${out ? 'disabled' : `data-action="select-day" data-date="${k}"`}>
          <span class="day__dow">${DOW[i]}</span>
          <span class="day__dot">${pie}<span>${full ? '✓' : parseKey(k).getDate()}</span></span>
          <span class="day__mark ${hasPlan ? 'is-on' : ''}"></span>
        </button>`;
      }
      return `<div class="weeks__page">${days}</div>`;
    }).join('');
    return `<div class="weekbar">
      <div class="weekbar__head">
        <span class="weekbar__label" data-week-label></span>
        <button class="pill" data-action="go-today">今日</button>
      </div>
      <div class="weeks" data-weeks>${pages}</div>
    </div>`;
  }

  function setupWeeks(page, goal) {
    const el = page.querySelector('[data-weeks]');
    const label = page.querySelector('[data-week-label]');
    const weeks = weekRange(goal);
    const fallback = Math.max(0, weeks.indexOf(sundayOf(selectedDate)));
    let idx = Math.min(weekPos.has(goal.id) ? weekPos.get(goal.id) : fallback, weeks.length - 1);
    const setLabel = i => {
      const s = weeks[i], e = addDays(s, 6);
      const y = parseKey(s).getFullYear();
      label.textContent = `${y}年 ${fmtMD(s)} 〜 ${fmtMD(e)}`;
    };
    el.scrollLeft = idx * el.clientWidth;
    setLabel(idx);
    el.addEventListener('scroll', () => {
      const i = Math.min(weeks.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
      if (i !== idx) { idx = i; weekPos.set(goal.id, i); setLabel(i); }
    }, { passive: true });
  }

  // 直近5週間のヒートマップ（日曜はじまり）
  function heatmapHtml(goal) {
    const today = todayKey();
    const end = addDays(sundayOf(today), 6);
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
  let scrollTimer, settledIndex = 0;
  pager.addEventListener('scroll', () => {
    const i = Math.round(pager.scrollLeft / pager.clientWidth);
    if (i !== currentIndex) { currentIndex = i; updateDots(); }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      // 目標を切り替えたら表示日・表示週を今日に戻す
      if (currentIndex === settledIndex) return;
      settledIndex = currentIndex;
      if (selectedDate !== todayKey() || weekPos.size) {
        selectedDate = todayKey();
        weekPos.clear();
        state.goals.forEach(renderPage);
      }
    }, 400);
  }, { passive: true });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { scrollToIndex(currentIndex, false); state.goals.forEach(renderPage); }, 150);
  });

  const goalOf = el => state.goals.find(g => g.id === el.closest('[data-goal]')?.dataset.goal);
  const rerender = (goal, anchor) => {
    const page = pager.querySelector(`[data-goal="${goal.id}"]`);
    const top = page?.scrollTop;
    renderPage(goal);
    if (page) page.scrollTop = top;
  };

  // ---------- 操作 ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const goal = goalOf(el);
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'add-goal': openGoalSheet(); break;
      case 'edit-goal': openGoalSheet(goal); break;
      case 'settings': openSettings(); break;
      case 'select-day':
        selectedDate = el.dataset.date;
        rerender(goal);
        break;
      case 'go-today':
        selectedDate = todayKey();
        weekPos.delete(goal.id);
        rerender(goal);
        break;
      case 'toggle': toggle(goal, id, el); break;
      case 'add-item': openItemSheet(goal, el.dataset.type); break;
      case 'edit-item': {
        const h = goal.habits.find(x => x.id === id);
        openItemSheet(goal, h ? 'habit' : 'task', h || goal.tasks.find(x => x.id === id));
        break;
      }
      case 'carry': carry(goal, [goal.tasks.find(t => t.id === id)]); break;
      case 'carry-all': carry(goal, leftovers(goal)); break;
      case 'drop': {
        const t = goal.tasks.find(x => x.id === id);
        if (!confirm(`「${t.title}」を削除しますか？`)) return;
        removeItem(goal, t);
        save(); rerender(goal);
        break;
      }
      case 'restore': restoreHabit(goal, goal.habits.find(h => h.id === id)); break;
      case 'purge': {
        const h = goal.habits.find(x => x.id === id);
        if (!confirm(`「${h.title}」を完全に削除しますか？\nこれまでのコミット記録も消えます。`)) return;
        removeItem(goal, h);
        save(); rerender(goal);
        break;
      }
    }
  });
  // アーカイブ欄の開閉状態を覚えておく
  document.addEventListener('toggle', e => {
    if (!e.target.matches?.('[data-archive]')) return;
    const goal = goalOf(e.target);
    if (goal) e.target.open ? archiveOpen.add(goal.id) : archiveOpen.delete(goal.id);
  }, true);
  $('#fab').addEventListener('click', () => openGoalSheet());

  function toggle(goal, id, el) {
    if (selectedDate > todayKey()) return; // 未来はコミット不可
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
    rerender(goal);
    const r = rateOn(goal, selectedDate);
    if (committing && r.rate === 1) toast(selectedDate === todayKey() ? '🎉 今日の目標をすべてコミット！' : '🎉 この日の目標をコンプリート！');
  }

  function carry(goal, tasks) {
    const today = todayKey();
    tasks.forEach(t => { t.carriedFrom = t.carriedFrom || t.date; t.date = today; });
    save(); rerender(goal);
    toast(`${tasks.length}件を今日の目標に移しました`);
  }

  function archiveHabit(goal, h) {
    h.archivedAt = todayKey();
    save(); rerender(goal);
    toast('アーカイブしました。記録は残っています');
  }
  function restoreHabit(goal, h) {
    const today = todayKey();
    // アーカイブしていた期間は「休止」として達成率に含めない
    if (h.archivedAt < today) h.pauses = [...(h.pauses || []), [h.archivedAt, today]];
    delete h.archivedAt;
    save(); rerender(goal);
    toast('毎日の目標に戻しました');
  }
  function removeItem(goal, item) {
    goal.habits = goal.habits.filter(x => x !== item);
    goal.tasks = goal.tasks.filter(x => x !== item);
    for (const k of Object.keys(goal.done)) {
      goal.done[k] = goal.done[k].filter(id => id !== item.id);
      if (!goal.done[k].length) delete goal.done[k];
    }
  }

  // ---------- ボトムシート ----------
  const sheet = $('#sheet');
  const sheetForm = $('#sheetForm');
  let onSubmit = null, onDelete = null;

  function openSheet({ title, body, submitLabel = '保存', deleteLabel = '削除', deletable = false, noSubmit = false, submit, del }) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = body;
    $('#sheetSubmit').textContent = submitLabel;
    $('#sheetSubmit').hidden = noSubmit;
    $('#sheetCancel').textContent = noSubmit ? '閉じる' : 'キャンセル';
    $('#sheetDelete').textContent = deleteLabel;
    $('#sheetDelete').hidden = !deletable;
    onSubmit = submit; onDelete = del;
    sheet.hidden = false;
    if (!noSubmit) setTimeout(() => sheetForm.querySelector('input[type=text]')?.focus(), 250);
  }
  function closeSheet() { sheet.hidden = true; onSubmit = onDelete = null; }
  sheet.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
  sheetForm.addEventListener('submit', e => {
    e.preventDefault();
    if (!onSubmit) return;
    const data = Object.fromEntries(new FormData(sheetForm));
    if (!data.title?.trim()) { sheetForm.querySelector('[name=title]')?.focus(); return; }
    data.title = data.title.trim();
    onSubmit(data);
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
          <input class="input" type="date" name="deadline" ${edit ? `min="${goal.createdAt}"` : `min="${todayKey()}"`} value="${edit ? goal.deadline || '' : ''}">
          <div class="field__hint">未設定でもOK。設定すると残り日数を表示します。</div></label>`,
      submit: data => {
        if (edit) {
          goal.title = data.title; goal.deadline = data.deadline || '';
          weekPos.delete(goal.id);
          save(); rerender(goal);
        } else {
          state.goals.push({ id: uid(), title: data.title, deadline: data.deadline || '', createdAt: todayKey(), habits: [], tasks: [], done: {} });
          save();
          currentIndex = settledIndex = state.goals.length - 1;
          selectedDate = todayKey();
          weekPos.clear();
          renderAll();
          toast('🌱 目標をつくりました。毎日の目標を追加しよう');
        }
      },
      del: () => {
        if (!confirm(`「${goal.title}」を削除しますか？\nコミット記録もすべて消えます。`)) return;
        state.goals = state.goals.filter(g => g !== goal);
        save();
        currentIndex = settledIndex = Math.max(0, currentIndex - 1);
        renderAll();
      },
    });
  }

  function openItemSheet(goal, type, item) {
    const edit = !!item;
    const date = selectedDate;
    const isHabit = edit && goal.habits.includes(item);
    const dayLabel = date === todayKey() ? '今日' : fmtMD(date);
    openSheet({
      title: edit ? '目標を編集' : 'コミットする目標を追加',
      submitLabel: edit ? '保存' : '追加',
      deletable: edit,
      deleteLabel: isHabit ? 'アーカイブ' : '削除',
      body: `
        <label class="field"><span class="field__label">内容</span>
          <input class="input" type="text" name="title" maxlength="50" placeholder="${type === 'habit' ? '例：毎朝30分 英単語' : '例：模試の申し込み'}" value="${edit ? esc(item.title) : ''}"></label>
        ${edit ? (isHabit ? '<div class="field__hint">アーカイブすると今日から表示されなくなります。これまでの記録は残り、いつでも復元できます。</div>' : '') : `<div class="field"><span class="field__label">種類</span>
          <div class="seg">
            <label><input type="radio" name="type" value="habit" ${type === 'habit' ? 'checked' : ''}><span>毎日<small>${date === todayKey() ? 'くり返しコミット' : `${fmtMD(date)}から毎日`}</small></span></label>
            <label><input type="radio" name="type" value="task" ${type === 'task' ? 'checked' : ''}><span>${dayLabel}だけ<small>その日かぎり</small></span></label>
          </div></div>`}`,
      submit: data => {
        if (edit) item.title = data.title;
        else if (data.type === 'habit') goal.habits.push({ id: uid(), title: data.title, start: date });
        else goal.tasks.push({ id: uid(), title: data.title, date });
        save(); rerender(goal);
      },
      del: () => {
        if (isHabit) { archiveHabit(goal, item); return; }
        if (!confirm(`「${item.title}」を削除しますか？`)) return;
        removeItem(goal, item);
        save(); rerender(goal);
      },
    });
  }

  // ---------- バックアップ ----------
  function openSettings() {
    const n = state.goals.length;
    openSheet({
      title: 'データとバックアップ',
      noSubmit: true,
      body: `
        <div class="info">
          <div>📱 この端末に保存中・目標 <b>${n}</b> 件</div>
          <div>🗂 最後のバックアップ：<b>${state.lastBackup ? fmtFull(state.lastBackup) : 'まだありません'}</b></div>
        </div>
        <button type="button" class="menu-btn" id="exportBtn">
          <span class="menu-btn__icon">⬇️</span>
          <span><b>バックアップを書き出す</b><small>すべての目標と記録をファイルに保存します</small></span>
        </button>
        <label class="menu-btn">
          <span class="menu-btn__icon">⬆️</span>
          <span><b>バックアップから復元</b><small>今のデータはバックアップの内容で上書きされます</small></span>
          <input type="file" id="importInput" accept="application/json,.json" hidden>
        </label>
        <p class="field__hint">機種変更やブラウザのデータ削除に備えて、ときどき書き出しておくと安心です。iPhoneでは「ホーム画面に追加」して使うとデータが消えにくくなります。</p>`,
    });
    $('#exportBtn').addEventListener('click', exportData);
    $('#importInput').addEventListener('change', e => importData(e.target.files[0]));
  }

  async function exportData() {
    const today = todayKey();
    const payload = { app: 'comit', version: 2, exportedAt: new Date().toISOString(), goals: state.goals };
    const name = `comit-backup-${today.replaceAll('-', '')}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ files: [file], title: 'comit バックアップ' });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // 共有をキャンセル
      toast('書き出しに失敗しました'); return;
    }
    state.lastBackup = today;
    save();
    closeSheet();
    toast('バックアップを書き出しました');
  }

  function validBackup(data) {
    return data && Array.isArray(data.goals) && data.goals.every(g =>
      g && typeof g.id === 'string' && typeof g.title === 'string' && typeof g.createdAt === 'string' &&
      Array.isArray(g.habits) && Array.isArray(g.tasks) && g.done && typeof g.done === 'object');
  }

  async function importData(file) {
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { data = null; }
    if (!validBackup(data)) { toast('comitのバックアップファイルではありません'); return; }
    const when = data.exportedAt ? fmtFull(keyOf(new Date(data.exportedAt))) : '日付不明';
    if (!confirm(`今のデータ（目標${state.goals.length}件）を、バックアップ（${when}・目標${data.goals.length}件）で上書きします。\nよろしいですか？`)) return;
    state = { goals: data.goals, lastBackup: state.lastBackup };
    save();
    closeSheet();
    currentIndex = settledIndex = 0;
    selectedDate = todayKey();
    weekPos.clear();
    renderAll();
    toast('バックアップから復元しました');
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
      weekPos.clear();
      renderAll();
    }
  });

  // ---------- 起動 ----------
  renderAll();
  const splash = $('#splash');
  const hideSplash = () => { splash.classList.add('is-hidden'); setTimeout(() => splash.remove(), 700); };
  window.addEventListener('load', () => setTimeout(hideSplash, 1600));
  splash.addEventListener('click', hideSplash);

  // ブラウザにデータを消されにくくする
  navigator.storage?.persist?.().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ブラウザでの確認用
  window.__comit = { get state() { return state; } };
})();
