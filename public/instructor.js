(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TOKEN_KEY = 'gv309-week9-admin';
  let meta = null, content = null, ws = null, token = null, view = null, answers = {};
  let seminar = null, aq = null, mode = 'group', timeOffset = 0, errTimer = null;
  let tableHtmlCache = '', answersHtmlCache = '', pendingAnswers = false;

  function showError(msg) {
    const el = $('error'); el.textContent = msg; el.hidden = false;
    clearTimeout(errTimer); errTimer = setTimeout(() => { el.hidden = true; }, 8000);
  }
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
  const qIndex = id => content.questions.findIndex(q => q.id === id);
  const semGroups = () => view.groups.filter(g => g.seminar === seminar);
  const short = g => `${g.seminar}.${g.number}`;

  // The answer fields of a question, as on the server.
  function fieldsOf(q) {
    if (q.table) {
      const out = [];
      for (const r of q.table.rows) for (const c of q.table.columns) {
        const key = `${r.id}.${c.id}`;
        if (!(q.table.fixed && key in q.table.fixed)) out.push(key);
      }
      return out;
    }
    return q.parts.map(p => p.id);
  }
  const text = (g, qid, key) => ((answers[g.id] || {})[qid] || {})[key] || '';
  function progress(g, q) {
    const keys = fieldsOf(q);
    const filled = keys.filter(k => text(g, q.id, k).trim()).length;
    const w = keys.reduce((n, k) => n + countWords(text(g, q.id, k)), 0);
    return { filled, total: keys.length, words: w };
  }

  // ------------------------------------------------------------ login
  function loginScreen() {
    $('main').innerHTML = `<section class="panel" style="max-width:460px">
      <h2>Log in</h2>
      <label class="field"><span>Instructor password</span><input type="password" id="pw" autocomplete="current-password"></label>
      <button class="btn" id="login" type="button">Log in</button></section>`;
    const go = async () => {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('pw').value }) });
      if (!r.ok) return showError('Wrong password.');
      token = (await r.json()).token;
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ }
      connect();
    };
    $('login').onclick = go;
    $('pw').onkeydown = e => { if (e.key === 'Enter') go(); };
    $('pw').focus();
  }

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => { $('conn').textContent = ''; send({ type: 'admin', token }); };
    ws.onclose = () => { $('conn').textContent = 'Connection lost. Reconnecting…'; setTimeout(() => { if (token) connect(); }, 1500); };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'adminDenied') {
        token = null; try { sessionStorage.removeItem(TOKEN_KEY); } catch (er) { /* ignore */ }
        ws.onclose = null; ws.close(); loginScreen(); showError('Your login expired (the server restarted). Log in again.');
      } else if (m.type === 'adminHello') {
        content = m.content;
      } else if (m.type === 'admin') {
        view = m.view; timeOffset = view.serverNow - Date.now();
        if (m.full) answers = m.answers; else Object.assign(answers, m.answers);
        const ids = new Set(view.groups.map(g => g.id));
        for (const id of Object.keys(answers)) if (!ids.has(id)) delete answers[id];
        if (!$('controls')) buildShell(); else renderDynamic();
      } else if (m.type === 'error') showError(m.msg);
    };
  }

  // ------------------------------------------------------------ shell
  function buildShell() {
    if (!content || !view) return;
    if (!seminar) seminar = content.seminars[0];
    if (!aq) aq = content.questions[0].id;
    tableHtmlCache = ''; answersHtmlCache = '';
    $('main').innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:16px">
        <div class="tabs" role="tablist" style="margin:0">${content.seminars.map(s => `<button type="button" role="tab" data-s="${esc(s)}" aria-selected="${s === seminar}">Seminar ${esc(s)}</button>`).join('')}</div>
        <div class="row">
          <a class="btn quiet small" href="/" target="_blank" rel="noopener">Open student page</a>
          <button class="btn quiet small" id="csv" type="button">Export CSV (both seminars)</button>
          <button class="btn danger small" id="reset" type="button">Delete all data</button>
        </div>
      </div>
      <section class="panel controls" id="controls"></section>
      <section class="panel">
        <div class="row" style="justify-content:space-between;align-items:baseline"><h2>Groups</h2><span class="hint" id="gsummary" style="margin:0"></span></div>
        <div class="tablewrap" id="table"></div>
      </section>
      <div class="row" style="justify-content:space-between;margin:30px 0 12px">
        <h2 style="margin:0">Answers, seminar ${esc(seminar)}</h2>
        <div class="row">
          <span class="phasebtns" id="aqbtns">${content.questions.map((q, i) => `<button type="button" data-q="${esc(q.id)}">Question ${i + 1}</button>`).join('')}</span>
          <span class="phasebtns" id="modebtns"><button type="button" data-m="group">Each group</button><button type="button" data-m="compare">Groups side by side</button></span>
        </div>
      </div>
      <details class="qtext" id="aqtext"><summary>Show the question</summary><div class="inner"></div></details>
      <div id="answers"></div>`;
    document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { seminar = b.dataset.s; buildShell(); });
    $('csv').onclick = () => { location.href = '/export.csv?token=' + encodeURIComponent(token); };
    $('reset').onclick = () => {
      if (!confirm('Delete every group and every answer in both seminars, and hide all questions again? This cannot be undone. Export the CSV first if you need it.')) return;
      if (!confirm('Really delete everything?')) return;
      send({ type: 'resetAll' });
    };
    document.querySelectorAll('#aqbtns button').forEach(b => b.onclick = () => { aq = b.dataset.q; renderQuestionText(); renderDynamic(); });
    document.querySelectorAll('#modebtns button').forEach(b => b.onclick = () => { mode = b.dataset.m; renderDynamic(); });
    buildControls();
    renderQuestionText();
    renderDynamic();
  }

  function buildControls() {
    $('controls').innerHTML = `
      <div><h2>Seminar ${esc(seminar)}</h2>
        <p class="hint" style="margin:0">Open questions one at a time. Students see open and read-only questions; read-only ones can be read but not edited. Hiding a question keeps its answers.</p></div>
      <div class="qrows">${content.questions.map((q, i) => `
        <div class="qrow">
          <div><strong>Question ${i + 1}</strong> ${esc(q.title)}<div class="hint" id="qprog-${esc(q.id)}" style="margin:2px 0 0"></div></div>
          <span class="phasebtns stbtns" data-q="${esc(q.id)}" role="group" aria-label="Question ${i + 1}">
            <button type="button" data-st="hidden">Hidden</button><button type="button" data-st="open">Open</button><button type="button" data-st="frozen">Read-only</button></span>
          ${q.minutes ? `<button class="btn quiet small" type="button" data-timer="${Number(q.minutes)}">Start ${Number(q.minutes)}-minute timer</button>` : '<span></span>'}
        </div>`).join('')}
      </div>
      <div class="row">
        <label class="row" style="gap:6px">Timer <input type="number" id="mins" min="1" max="240" value="${Number(content.questions[0].minutes) || 20}" style="width:90px"> minutes</label>
        <button class="btn quiet small" id="tstart" type="button">Start timer</button>
        <button class="btn quiet small" id="tstop" type="button">Stop timer</button>
        <span id="tleft" class="hint" style="margin:0"></span>
      </div>`;
    document.querySelectorAll('#controls .stbtns button').forEach(b => b.onclick = () => {
      const qid = b.parentElement.dataset.q, st = b.dataset.st;
      const cur = view.seminars[seminar].status[qid];
      if (st === cur) return;
      const started = semGroups().filter(g => progress(g, content.questions[qIndex(qid)]).filled > 0).length;
      if (st === 'hidden' && started && !confirm(`Hide question ${qIndex(qid) + 1} from seminar ${seminar}? Students will no longer see it. Their answers stay saved and reappear when you open it again.`)) return;
      send({ type: 'setStatus', seminar, question: qid, status: st });
    });
    document.querySelectorAll('#controls [data-timer]').forEach(b => b.onclick = () => send({ type: 'timer', seminar, minutes: Number(b.dataset.timer) }));
    $('tstart').onclick = () => send({ type: 'timer', seminar, minutes: Number($('mins').value) });
    $('tstop').onclick = () => send({ type: 'timer', seminar, minutes: 0 });
  }

  function renderQuestionText() {
    const q = content.questions[qIndex(aq)];
    let h = '';
    for (const p of (q.prompt || [])) h += `<p class="prompt">${mdInline(p)}</p>`;
    if (q.legend) h += `<ol class="legend">${q.legend.map((l, i) => `<li><span class="key">[${i + 1}]</span> ${mdInline(l)}</li>`).join('')}</ol>`;
    if (q.quote) h += `<blockquote class="quote lift">${mdInline(q.quote)}</blockquote>`;
    if (q.parts) h += `<ul class="plain">${q.parts.map(p => `<li>${p.letter ? esc(p.letter) + '. ' : ''}${mdInline(p.label)}</li>`).join('')}</ul>`;
    if (q.table) h += `<p class="hint" style="margin:0">Students fill in the table shown below.</p>`;
    document.querySelector('#aqtext summary').textContent = `Show question ${qIndex(aq) + 1}: ${q.title}`;
    document.querySelector('#aqtext .inner').innerHTML = h;
    answersHtmlCache = '';
  }

  // ------------------------------------------------------------ dynamic parts
  const STATUS_WORD = { hidden: 'Hidden', open: 'Open', frozen: 'Read-only' };
  function pageLabel(p) { return p === 'wait' ? 'Waiting' : `Q${qIndex(p) + 1}`; }
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() + timeOffset - ts) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderDynamic() {
    if (!view || !content || !$('controls')) return;
    const sem = view.seminars[seminar];
    const groups = semGroups();

    // Question controls
    for (const q of content.questions) {
      const st = sem.status[q.id];
      document.querySelectorAll(`#controls .stbtns[data-q="${q.id}"] button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.st === st)));
      const started = groups.filter(g => progress(g, q).filled > 0).length;
      const here = groups.reduce((n, g) => n + (g.pages[q.id] || 0), 0);
      const el = $('qprog-' + q.id);
      if (el) el.textContent = groups.length
        ? `${STATUS_WORD[st]}. Started by ${started} of ${groups.length} group${groups.length === 1 ? '' : 's'}${here ? `; ${here} device${here === 1 ? '' : 's'} on this page now` : ''}.`
        : `${STATUS_WORD[st]}.`;
    }
    tick();

    // Group table
    const online = groups.reduce((n, g) => n + g.online, 0);
    const people = groups.reduce((n, g) => n + g.members.length, 0);
    $('gsummary').textContent = groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'}, ${people} names, ${online} device${online === 1 ? '' : 's'} online` : '';
    let th;
    if (!groups.length) th = '<p class="hint" style="margin:0">No groups yet. They appear here as students create them.</p>';
    else th = `<table class="groups"><thead><tr>
        <th>Group</th><th>Members</th><th>Code</th><th>Now on</th>${content.questions.map((q, i) => `<th>Q${i + 1}${sem.status[q.id] === 'hidden' ? ' <span class="hint">(hidden)</span>' : ''}</th>`).join('')}<th>Last typed</th><th></th>
      </tr></thead><tbody>${groups.map(g => {
        const pages = Object.entries(g.pages).sort((a, b) => (a[0] === 'wait') - (b[0] === 'wait') || qIndex(a[0]) - qIndex(b[0]));
        const last = Math.max(0, ...Object.values(g.lastEdit || {}));
        return `<tr>
          <td><strong>${esc(g.name)}</strong></td>
          <td><span class="dot ${g.online ? 'on' : ''}" title="${g.online} device(s) connected"></span>${esc(g.members.join(', '))}</td>
          <td>${esc(g.code)}</td>
          <td>${g.online ? pages.map(([p, n]) => `${pageLabel(p)}${n > 1 ? ` (${n})` : ''}`).join(', ') || 'Joining' : '<span class="hint">Offline</span>'}</td>
          ${content.questions.map(q => {
            const pr = progress(g, q);
            if (!pr.filled && sem.status[q.id] === 'hidden') return '<td class="hint">–</td>';
            return `<td>${pr.filled}/${pr.total} ${q.table ? 'cells' : 'parts'}<br><span class="hint">${pr.words} words</span></td>`;
          }).join('')}
          <td>${last ? `<span data-ago="${last}">${ago(last)}</span>` : '<span class="hint">Not yet</span>'}</td>
          <td><button class="btn danger small" data-del="${g.id}" type="button">Delete</button></td></tr>`;
      }).join('')}</tbody></table>`;
    if (th !== tableHtmlCache) {
      tableHtmlCache = th;
      $('table').innerHTML = th;
      document.querySelectorAll('#table [data-del]').forEach(b => b.onclick = () => {
        const g = view.groups.find(x => x.id === b.dataset.del);
        if (g && confirm(`Delete ${g.name} (${g.members.join(', ')}) and all its answers?`)) send({ type: 'deleteGroup', groupId: g.id });
      });
    }

    // Answers
    document.querySelectorAll('#aqbtns button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.q === aq)));
    document.querySelectorAll('#modebtns button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === mode)));
    renderAnswers();
  }

  function cellText(s) { return s.trim() ? esc(s) : '<span class="none" aria-label="Empty">–</span>'; }
  function readTable(q, cell) {
    const t = q.table;
    return `<div class="answergrid"><table class="answers readonly">
      <colgroup><col class="rh">${t.columns.map(() => '<col>').join('')}</colgroup>
      <thead><tr><th scope="col">${esc(t.corner || '')}</th>${t.columns.map(c => `<th scope="col">${mdInline(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(r => `<tr><th scope="row">${mdInline(r.label)}</th>${t.columns.map(c => {
        const key = `${r.id}.${c.id}`;
        if (t.fixed && t.fixed[key] != null) return `<td class="fixed"><p>${mdInline(t.fixed[key])}</p></td>`;
        return `<td><span class="celllabel"><span class="short">${esc(c.short || c.label)}</span><span class="full">${mdInline(c.label)}</span></span>${cell(key)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderAnswers() {
    const q = content.questions[qIndex(aq)];
    const groups = semGroups();
    let h;
    if (!groups.length) h = '<p class="hint">No groups in this seminar yet.</p>';
    else if (q.table && mode === 'group') {
      h = groups.map(g => `<section class="panel"><h3>${esc(g.name)}: ${esc(g.members.join(', '))}</h3>
        ${readTable(q, key => `<div class="celltext">${cellText(text(g, q.id, key))}</div>`)}</section>`).join('');
    } else if (q.table) {
      h = `<section class="panel">${readTable(q, key => {
        const got = groups.filter(g => text(g, q.id, key).trim());
        return got.length ? got.map(g => `<div class="entry"><span class="gname">${esc(short(g))}</span><div class="celltext">${esc(text(g, q.id, key))}</div></div>`).join('') : '<span class="none">No answers yet</span>';
      })}</section>`;
    } else if (mode === 'group') {
      h = groups.map(g => `<section class="panel"><h3>${esc(g.name)}: ${esc(g.members.join(', '))}</h3>
        ${q.parts.map(p => {
          const t = text(g, q.id, p.id);
          return `<p class="partlabel small">${p.letter ? esc(p.letter) + '. ' : ''}${mdInline(p.short || p.label)}</p><div class="reading ${t.trim() ? '' : 'empty'}">${t.trim() ? esc(t) : 'Nothing written yet.'}</div><div class="wc">${countWords(t)} words</div>`;
        }).join('')}</section>`).join('');
    } else {
      h = q.parts.map(p => `<section class="panel"><p class="partlabel">${p.letter ? `<span class="letter">${esc(p.letter)}.</span> ` : ''}${mdInline(p.label)}</p>
        ${groups.map(g => {
          const t = text(g, q.id, p.id);
          return `<div class="entry wide"><span class="gname">${esc(g.name)}</span><div class="celltext ${t.trim() ? '' : 'none'}">${t.trim() ? esc(t) : 'Nothing written yet.'}</div></div>`;
        }).join('')}</section>`).join('');
    }
    if (h === answersHtmlCache) return;
    // Do not redraw while the instructor is selecting text to copy.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && $('answers').contains(sel.anchorNode)) { pendingAnswers = true; return; }
    answersHtmlCache = h; pendingAnswers = false;
    $('answers').innerHTML = h;
  }
  document.addEventListener('selectionchange', () => {
    if (!pendingAnswers) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed) renderAnswers();
  });

  function tick() {
    const el = $('tleft'); if (!el || !view) return;
    const end = view.seminars[seminar].timerEndsAt;
    if (!end) el.textContent = 'No timer running.';
    else {
      const left = Math.max(0, end - (Date.now() + timeOffset));
      el.textContent = left > 0 ? `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} left` : 'Time is up.';
    }
    const anyOpen = Object.values(view.seminars[seminar].status).includes('open');
    document.querySelectorAll('#table [data-ago]').forEach(s => {
      const ts = Number(s.dataset.ago);
      s.textContent = ago(ts);
      s.classList.toggle('stale', anyOpen && Date.now() + timeOffset - ts > 5 * 60000);
    });
  }
  setInterval(tick, 1000);

  fetch('/api/content').then(r => r.json()).then(c => {
    meta = c;
    $('title').textContent = 'Instructor: ' + c.title;
    document.title = 'Instructor – ' + c.title;
    try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }
    if (token) connect(); else loginScreen();
  });
})();
