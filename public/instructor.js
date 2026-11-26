(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TOKEN_KEY = 'gv309-week9-admin';
  let meta = null, content = null, ws = null, token = null, view = null, answers = {};
  let seminar = null, aq = null, mode = 'group', timeOffset = 0, errTimer = null;
  let tableHtmlCache = '', answersHtmlCache = '', pendingAnswers = false;
  const askDrafts = {}, askEditing = new Set(), askSig = {};

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
          <button class="btn quiet small" id="csv" type="button">Export answers (CSV)</button>
          <button class="btn quiet small" id="csvq" type="button">Export student questions (CSV)</button>
          <button class="btn danger small" id="reset" type="button">Delete all data</button>
        </div>
      </div>
      <section class="panel controls" id="controls"></section>
      <section class="panel" id="askpanel">
        <div class="row" style="justify-content:space-between;align-items:baseline"><h2>Questions from students</h2><span class="hint" id="asksummary" style="margin:0"></span></div>
        <div id="asklist"></div>
      </section>
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
    $('csvq').onclick = () => { location.href = '/export-questions.csv?token=' + encodeURIComponent(token); };
    for (const k of Object.keys(askSig)) delete askSig[k];
    $('reset').onclick = () => {
      if (!confirm('Delete every group, every answer and every student question in all seminars, and hide all questions again? This cannot be undone. Export the CSV files first if you need them.')) return;
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

    // Unanswered student questions: badges on the seminar tabs and a count in the browser tab
    const waiting = s => view.asks.filter(a => a.seminar === s && !a.answer).length;
    document.querySelectorAll('.tabs button[data-s]').forEach(b => {
      const n = waiting(b.dataset.s);
      b.innerHTML = `Seminar ${esc(b.dataset.s)}${n ? ` <span class="badge" title="${n} unanswered question${n === 1 ? '' : 's'}">${n}</span>` : ''}`;
    });
    const totalWaiting = view.asks.filter(a => !a.answer).length;
    document.title = (totalWaiting ? `(${totalWaiting}) ` : '') + 'Instructor – ' + content.title;
    renderAsks();

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

  // ------------------------------------------------------------ student questions
  // Each question is its own element, replaced only when that question changes,
  // so a reply you are typing is not disturbed when another question arrives.
  const hhmm = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function askItemHtml(a) {
    const qi = qIndex(a.about);
    const from = a.anonymous ? '<strong>Anonymous</strong>' : `<strong>${esc(a.from.name)}</strong> (${esc((a.from.members || []).join(', '))})`;
    const target = a.anonymous ? 'the group that asked' : esc(a.from.name);
    let h = `<p class="askmeta">${from} <span class="hint">about ${qi >= 0 ? `question ${qi + 1}` : 'something else'}, ${hhmm(a.createdAt)}</span></p>
      <p class="asktext">${esc(a.text)}</p>`;
    if (!a.answer || askEditing.has(a.id)) {
      const draft = askDrafts[a.id] != null ? askDrafts[a.id] : (a.answer && !a.answer.inClass ? a.answer.text : '');
      h += `<textarea data-draft aria-label="Your answer" placeholder="Your answer">${esc(draft)}</textarea>
        ${a.askerGone ? `<p class="hint" style="margin:6px 0 0">The group that asked has been deleted, so only an answer to the whole seminar will be read.</p>` : ''}
        <div class="row">
          <button class="btn small" type="button" data-act="private">Send to ${target} only</button>
          <button class="btn quiet small" type="button" data-act="shared">Send to all of seminar ${esc(a.seminar)}</button>
          ${a.answer ? '<button class="btn quiet small" type="button" data-act="cancel">Cancel</button>' : '<button class="btn quiet small" type="button" data-act="inclass">Mark as answered in class</button>'}
          <button class="btn danger small" type="button" data-act="delete">Delete</button>
        </div>`;
    } else if (a.answer.inClass) {
      h += `<p class="answered">Marked as answered in class at ${hhmm(a.answer.at)}.</p>
        <div class="row"><button class="btn quiet small" type="button" data-act="edit">Write an answer</button><button class="btn danger small" type="button" data-act="delete">Delete</button></div>`;
    } else {
      h += `<div class="note"><p class="who">Your answer, ${a.shared ? `sent to all of seminar ${esc(a.seminar)}` : `sent to ${target} only`}, ${hhmm(a.answer.at)}</p><div class="body">${esc(a.answer.text)}</div></div>
        <div class="row">
          <button class="btn quiet small" type="button" data-act="edit">Edit answer</button>
          <button class="btn quiet small" type="button" data-act="${a.shared ? 'unshare' : 'share'}">${a.shared ? `Show only to ${target}` : `Share with all of seminar ${esc(a.seminar)}`}</button>
          <button class="btn danger small" type="button" data-act="delete">Delete</button>
        </div>`;
    }
    return h;
  }
  function wireAsk(el, a) {
    const ta = el.querySelector('textarea');
    if (ta) ta.oninput = () => { askDrafts[a.id] = ta.value; };
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'private' || act === 'shared') {
        if (!ta.value.trim()) { showError('Write an answer first.'); ta.focus(); return; }
        send({ type: 'answerAsk', id: a.id, text: ta.value, shared: act === 'shared' });
        delete askDrafts[a.id]; askEditing.delete(a.id);
      } else if (act === 'inclass') { send({ type: 'inClassAsk', id: a.id }); delete askDrafts[a.id]; }
      else if (act === 'edit') { askEditing.add(a.id); renderAsks(); const t = $('asklist').querySelector(`[data-id="${a.id}"] textarea`); if (t) t.focus(); }
      else if (act === 'cancel') { askEditing.delete(a.id); delete askDrafts[a.id]; renderAsks(); }
      else if (act === 'share' || act === 'unshare') send({ type: 'shareAsk', id: a.id, shared: act === 'share' });
      else if (act === 'delete') {
        if (confirm('Delete this question? The students who asked it will no longer see it or your answer.')) { send({ type: 'deleteAsk', id: a.id }); delete askDrafts[a.id]; askEditing.delete(a.id); }
      }
    });
  }
  function renderAsks() {
    const box = $('asklist'); if (!box) return;
    const list = view.asks.filter(a => a.seminar === seminar);
    const open = list.filter(a => !a.answer);
    const done = list.filter(a => a.answer).sort((x, y) => y.answer.at - x.answer.at);
    $('asksummary').textContent = open.length ? `${open.length} waiting for an answer` : (list.length ? 'All answered' : '');
    if (!list.length) {
      box.innerHTML = '<p class="hint" style="margin:0">No questions yet. Students can ask from any page, with their group’s name or anonymously. Anonymous questions show no group here or in the CSV.</p>';
      for (const k of Object.keys(askSig)) delete askSig[k];
      return;
    }
    const ordered = [...open, ...done];
    const want = new Set(ordered.map(a => a.id));
    [...box.children].forEach(el => { if (!el.dataset.id || !want.has(el.dataset.id)) { delete askSig[el.dataset.id]; el.remove(); } });
    let prev = null;
    for (const a of ordered) {
      const sig = JSON.stringify([a, askEditing.has(a.id)]);
      let el = box.querySelector(`[data-id="${a.id}"]`);
      if (!el || askSig[a.id] !== sig) {
        const fresh = document.createElement('article');
        fresh.className = 'askI ' + (a.answer && !askEditing.has(a.id) ? 'done' : 'open');
        fresh.dataset.id = a.id;
        fresh.innerHTML = askItemHtml(a);
        wireAsk(fresh, a);
        if (el) el.replaceWith(fresh);
        el = fresh; askSig[a.id] = sig;
      }
      if (prev ? prev.nextElementSibling !== el : box.firstElementChild !== el) { if (prev) prev.after(el); else box.prepend(el); }
      prev = el;
    }
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
