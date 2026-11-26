(() => {
  'use strict';
  const STORE = 'gv309-week9-group';
  const $ = id => document.getElementById(id);
  let content = null, ws = null, connected = false;
  let view = null, groupId = null, code = null;
  let ydocs = {}, docGen = {}, docsReady = false;
  let unbinds = [], layoutKey = null, navHtml = '', timeOffset = 0, errTimer = null, toastTimer = null;
  let prevStatus = null, bannerFor = null, lastPage, wideLayout = false;

  // ------------------------------------------------------------ connection
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => {
      connected = true;
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { /* storage unavailable */ }
      const g = groupId ? { groupId, code } : saved;
      if (g && g.groupId) send({ type: 'resume', groupId: g.groupId, code: g.code });
      else render();
      renderBar();
    };
    ws.onclose = () => { connected = false; renderBar(); setTimeout(connect, 1500); };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      switch (m.type) {
        case 'joined':
          if (groupId !== m.groupId) { ydocs = {}; docsReady = false; prevStatus = null; bannerFor = null; layoutKey = null; view = null; }
          groupId = m.groupId; code = m.code; lastPage = undefined;
          $('error').hidden = true;
          try { localStorage.setItem(STORE, JSON.stringify({ groupId, code })); } catch (er) { /* ignore */ }
          break;
        case 'resumeFailed': forget(); render(); break;
        case 'ydocs':
          for (const [qid, st] of Object.entries(m.states)) onYdoc(qid, st, false);
          docsReady = true; render(); break;
        case 'ydoc': onYdoc(m.doc, m.state, m.reset); break;
        case 'yupdate': if (ydocs[m.doc]) Y.applyUpdate(ydocs[m.doc], b64ToU8(m.update), 'remote'); break;
        case 'view': onView(m.view); break;
        case 'removed':
          forget(); showError('Your group was removed by the instructor. Create or join a group again.'); render(); break;
        case 'error': showError(m.msg); break;
      }
    };
  }
  function forget() {
    groupId = null; code = null; view = null; ydocs = {}; docsReady = false; layoutKey = null; prevStatus = null; bannerFor = null;
    try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
  }

  function newDoc(qid, st) {
    const d = new Y.Doc();
    if (st) Y.applyUpdate(d, st, 'init');
    d.on('update', (u, origin) => {
      if (origin === 'remote' || origin === 'init') return;
      if (connected) send({ type: 'yupdate', doc: qid, update: u8ToB64(u) });
    });
    ydocs[qid] = d;
    docGen[qid] = (docGen[qid] || 0) + 1;
  }
  function onYdoc(qid, stateB64, reset) {
    const st = b64ToU8(stateB64);
    if (!ydocs[qid] || reset) { newDoc(qid, st); if (reset) { layoutKey = null; render(); } return; }
    // Reconnected: merge the server's copy with anything typed while offline.
    const tmp = new Y.Doc(); Y.applyUpdate(tmp, st);
    const sv = Y.encodeStateVector(tmp);
    Y.applyUpdate(ydocs[qid], st, 'remote');
    const diff = Y.encodeStateAsUpdate(ydocs[qid], sv);
    if (diff.length > 2) send({ type: 'yupdate', doc: qid, update: u8ToB64(diff) });
  }

  function showError(msg) {
    const el = $('error'); el.textContent = msg; el.hidden = false;
    clearTimeout(errTimer); errTimer = setTimeout(() => { el.hidden = true; }, 7000);
  }
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  // ------------------------------------------------------------ pages
  const hashPage = () => decodeURIComponent(location.hash.replace(/^#/, '')) || null;
  const qById = id => view && view.questions.find(q => q.id === id);
  const isVisible = q => q && q.status !== 'hidden';
  function setPage(id, replace) {
    if (replace) history.replaceState(null, '', '#' + id);
    else location.hash = id;
  }
  // Land on the latest open question, or else the latest read-only one.
  function defaultPage() {
    const qs = view.questions;
    for (const want of ['open', 'frozen']) for (let i = qs.length - 1; i >= 0; i--) if (qs[i].status === want) return qs[i].id;
    return null;
  }
  function reportPage(p) { if (p !== lastPage) { lastPage = p; send({ type: 'page', page: p }); } }

  function onView(v) {
    const first = !view || view.group.id !== v.group.id;
    view = v; timeOffset = v.serverNow - Date.now();
    const status = Object.fromEntries(v.questions.map(q => [q.id, q.status]));
    const newly = (!first && prevStatus) ? v.questions.filter(q => q.status !== 'hidden' && prevStatus[q.id] === 'hidden').map(q => q.id) : [];
    prevStatus = status;
    const page = hashPage();
    if (!page || !status[page]) { const d = defaultPage(); if (d) setPage(d, true); }
    else if (status[page] === 'hidden' && newly.length) setPage(newly[newly.length - 1], true);
    else if (newly.length && newly[newly.length - 1] !== page) bannerFor = newly[newly.length - 1];
    if (bannerFor && !isVisible(qById(bannerFor))) bannerFor = null;
    render();
  }
  window.addEventListener('hashchange', () => {
    if (bannerFor === hashPage()) bannerFor = null;
    render();
    window.scrollTo(0, 0);
  });

  const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function clearBindings() { unbinds.forEach(f => f()); unbinds = []; }
  const fid = (qid, key) => `f-${qid}-${String(key).replace(/\W/g, '-')}`;

  // ------------------------------------------------------------ group bar
  function renderBar() {
    const bar = $('groupbar');
    if (!view || !groupId) { bar.hidden = true; return; }
    const g = view.group;
    bar.hidden = false;
    bar.innerHTML = `<div class="wrap ${wideLayout ? 'wide' : ''}">
      <strong>${esc(g.name)}</strong>
      <span class="members">${esc(g.members.join(', '))}</span>
      <span class="code">Code to join: <strong>${esc(g.code)}</strong></span>
      ${connected ? '' : '<span class="conn" role="status">Reconnecting. What you type is kept and sent when the connection returns.</span>'}
      <span class="spacer"></span>
      <span id="timer" class="timer" hidden></span>
      <button type="button" id="dl">Download our answers</button>
      <button type="button" id="leave">Leave group</button></div>`;
    $('dl').onclick = download;
    $('leave').onclick = () => {
      if (!confirm('Leave this group on this device? Your group’s work stays saved, and you can rejoin with code ' + g.code + '.')) return;
      forget(); clearBindings(); history.replaceState(null, '', location.pathname); render(); renderBar();
      ws.close();
    };
    tick();
  }
  function tick() {
    const el = $('timer');
    if (!el || !view) return;
    const end = view.timerEndsAt;
    if (!end) { el.hidden = true; return; }
    const left = Math.max(0, end - (Date.now() + timeOffset));
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    el.hidden = false;
    el.textContent = left > 0 ? `${m}:${String(s).padStart(2, '0')} left` : 'Time is up';
    el.classList.toggle('low', left < 60000);
  }
  setInterval(tick, 1000);

  // ------------------------------------------------------------ navigation and banner
  function renderNav(shown) {
    const nav = $('qnav');
    nav.hidden = false;
    const html = `<ol class="qnav" style="--n:${view.questions.length}">${view.questions.map(q => {
      if (q.status === 'hidden') return `<li><span class="qtab locked"><span class="n">Question ${q.n}</span><span class="meta">Not open yet</span></span></li>`;
      const others = (view.here[q.id] || 0) - (q.id === shown ? 1 : 0);
      const meta = [q.status === 'frozen' ? 'Read-only' : '', others > 0 ? `${others} other${others > 1 ? 's' : ''} from your group here` : ''].filter(Boolean).join('. ');
      return `<li><a class="qtab ${q.status}" href="#${esc(q.id)}" ${q.id === shown ? 'aria-current="page"' : ''}>
        <span class="n">Question ${q.n}</span><span class="t">${esc(q.title)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</a></li>`;
    }).join('')}</ol>`;
    if (html !== navHtml) { nav.innerHTML = html; navHtml = html; }
  }
  function renderBanner() {
    const el = $('banner');
    const q = bannerFor && qById(bannerFor);
    const show = !!q && q.id !== hashPage();
    document.body.classList.toggle('has-banner', show);
    if (!show) { el.hidden = true; el.innerHTML = ''; return; }
    if (!el.hidden && el.dataset.q === q.id) return;
    el.hidden = false; el.dataset.q = q.id;
    el.innerHTML = `<div class="banner" role="status"><span>Question ${q.n} is now open: ${esc(q.title)}.</span>
      <a class="btn small" href="#${esc(q.id)}">Go to question ${q.n}</a>
      <button class="linkbtn" type="button" id="bannerx">Dismiss</button></div>`;
    $('bannerx').onclick = () => { bannerFor = null; renderBanner(); };
  }

  // ------------------------------------------------------------ render
  function render() {
    if (!content) return;
    renderBar();
    const main = $('main');
    if (!groupId || !view) {
      $('qnav').hidden = true; navHtml = ''; bannerFor = null; renderBanner(); wideLayout = false; $('wrap').classList.remove('wide');
      if (layoutKey === 'join') return;
      clearBindings(); layoutKey = 'join';
      main.innerHTML = joinHtml(); wireJoin(); return;
    }
    if (!docsReady) return;
    const page = hashPage();
    const q = qById(page);
    const anyVisible = view.questions.some(isVisible);
    const shown = isVisible(q) ? q.id : 'wait';
    reportPage(shown);
    renderNav(shown);
    renderBanner();
    wideLayout = !!(isVisible(q) && q.table);
    $('wrap').classList.toggle('wide', wideLayout);
    const barWrap = document.querySelector('#groupbar .wrap');
    if (barWrap) barWrap.classList.toggle('wide', wideLayout);

    let key;
    if (isVisible(q)) key = `q|${q.id}|${q.status}|${docGen[q.id]}`;
    else if (q && anyVisible) key = 'locked|' + q.id;
    else key = 'wait';
    if (key === layoutKey) return;
    clearBindings(); layoutKey = key;
    if (isVisible(q)) { main.innerHTML = questionHtml(q); wireQuestion(q); }
    else if (q && anyVisible) main.innerHTML = `<section class="panel"><h2>Question ${q.n} is not open</h2><p class="hint" style="margin:0">It appears here as soon as your instructor opens it. Choose an open question above.</p></section>`;
    else main.innerHTML = `<p class="lead">${esc(content.intro || '')}</p><section class="panel"><h2>Waiting for the first question</h2><p class="hint" style="margin:0">This page updates by itself when your instructor opens a question. Share your group code so everyone in your group can join.</p></section>`;
  }

  // --- join
  function joinHtml() {
    return `<p class="lead">Work in your group for this exercise. One person creates the group and shares the six-digit code, and everyone else joins with it.</p>
    <section class="panel">
      <h2>Create a group</h2>
      <p class="hint">Do this once per group.</p>
      <fieldset class="semchoice">
        <legend>Seminar group</legend>
        <div class="semopts">${content.seminars.map(s => `<label class="semopt"><input type="radio" name="sem" value="${esc(s)}"><span>Seminar ${esc(s)}</span></label>`).join('')}</div>
      </fieldset>
      <label class="field"><span>Your names</span><input type="text" id="names" placeholder="e.g. Anna Weber, Ben Okafor" autocomplete="off"></label>
      <button class="btn" id="create" type="button">Create group</button>
    </section>
    <div class="or">or</div>
    <section class="panel">
      <h2>Join your group</h2>
      <label class="field"><span>Group code</span><input type="text" id="code" inputmode="numeric" maxlength="6" placeholder="6 digits" autocomplete="off"></label>
      <label class="field"><span>Your name</span><input type="text" id="jname" autocomplete="off"></label>
      <button class="btn" id="join" type="button">Join group</button>
    </section>`;
  }
  function wireJoin() {
    $('create').onclick = () => {
      const sem = document.querySelector('input[name=sem]:checked');
      if (!sem) return showError('Choose your seminar group.');
      if (!$('names').value.trim()) return showError('Enter the names of everyone in your group.');
      send({ type: 'create', seminar: sem.value, names: $('names').value });
    };
    $('join').onclick = () => {
      if (!/^\d{6}$/.test($('code').value.trim())) return showError('Enter the six-digit code from your group.');
      send({ type: 'join', code: $('code').value.trim(), name: $('jname').value });
    };
  }

  // --- a question page
  function questionHtml(q) {
    let h = `<header class="qhead"><h2>Question ${q.n}: ${esc(q.title)}</h2>${q.minutes ? `<p class="hint">About ${esc(q.minutes)} minutes</p>` : ''}</header>`;
    if (q.status === 'frozen') h += `<p class="notice">This question is read-only now. You can still read your group’s answers.</p>`;
    for (const p of (q.prompt || [])) h += `<p class="prompt">${mdInline(p)}</p>`;
    if (q.legend) h += `<ol class="legend">${q.legend.map((l, i) => `<li><span class="key">[${i + 1}]</span> ${mdInline(l)}</li>`).join('')}</ol>`;
    if (q.quote) h += `<blockquote class="quote lift">${mdInline(q.quote)}</blockquote>`;
    return h + (q.table ? tableHtml(q) : partsHtml(q));
  }
  function tableHtml(q) {
    const t = q.table, ro = q.status !== 'open';
    const colLabel = c => `<span class="short">${esc(c.short || c.label)}</span><span class="full">${mdInline(c.label)}${c.note ? ` <em>${mdInline(c.note)}</em>` : ''}</span>`;
    return `<div class="answergrid"><table class="answers">
      <colgroup><col class="rh">${t.columns.map(() => '<col>').join('')}</colgroup>
      <thead><tr><th scope="col">${esc(t.corner || '')}</th>${t.columns.map(c => `<th scope="col">${mdInline(c.label)}${c.note ? `<span class="colnote">${mdInline(c.note)}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map(r => `<tr><th scope="row">${mdInline(r.label)}</th>${t.columns.map(c => {
        const key = `${r.id}.${c.id}`;
        const fixed = t.fixed && t.fixed[key];
        if (fixed != null) return `<td class="fixed"><span class="celllabel">${colLabel(c)}</span><p>${mdInline(fixed)}</p></td>`;
        return `<td><span class="celllabel" aria-hidden="true">${colLabel(c)}</span><textarea id="${fid(q.id, key)}" class="cellinput" data-k="${esc(key)}" spellcheck="true" aria-label="${esc(r.label + ': ' + c.label)}" ${ro ? 'readonly' : ''}></textarea></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="meter" id="filled-${esc(q.id)}"></div>`;
  }
  function partsHtml(q) {
    const ro = q.status !== 'open';
    return q.parts.map(p => `<section class="panel part">
      <label class="partlabel" for="${fid(q.id, p.id)}">${p.letter ? `<span class="letter">${esc(p.letter)}.</span> ` : ''}${mdInline(p.label)}</label>
      <textarea id="${fid(q.id, p.id)}" class="partinput" data-k="${esc(p.id)}" spellcheck="true" style="min-height:${(p.rows || 9) * 1.65}em" ${ro ? 'readonly' : ''}></textarea>
      <div class="meter" id="wc-${fid(q.id, p.id)}"><span class="txt"></span></div>
    </section>`).join('');
  }
  function updateCounts(q) {
    const d = ydocs[q.id]; if (!d) return;
    if (q.table) {
      const keys = [...document.querySelectorAll('#main textarea[data-k]')].map(ta => ta.dataset.k);
      const filled = keys.filter(k => d.getText(k).toString().trim()).length;
      const el = $('filled-' + q.id);
      if (el) el.textContent = `${filled} of ${keys.length} cells filled`;
    } else {
      for (const p of q.parts) {
        const el = $('wc-' + fid(q.id, p.id)); if (!el) continue;
        const n = countWords(d.getText(p.id).toString()), lim = q.wordLimit;
        el.classList.toggle('over', !!lim && n > lim);
        el.querySelector('.txt').textContent = lim ? `${n} / ${lim} words` : `${n} word${n === 1 ? '' : 's'}`;
      }
    }
  }
  function blockPaste(ta) {
    if (!content.blockPaste) return;
    const msg = () => toast('Pasting is turned off for this exercise. Type your answer here.');
    ta.addEventListener('paste', e => { e.preventDefault(); msg(); });
    ta.addEventListener('drop', e => { e.preventDefault(); msg(); });
    ta.addEventListener('beforeinput', e => { if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') { e.preventDefault(); msg(); } });
  }
  function wireQuestion(q) {
    const d = ydocs[q.id];
    document.querySelectorAll('#main textarea[data-k]').forEach(ta => {
      unbinds.push(bindTextarea(d, d.getText(ta.dataset.k), ta, () => { autosize(ta); updateCounts(q); }));
      autosize(ta);
      blockPaste(ta);
    });
    updateCounts(q);
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => document.querySelectorAll('#main textarea[data-k]').forEach(autosize), 150);
  });

  // ------------------------------------------------------------ download
  function download() {
    if (!view) return;
    const g = view.group;
    const shown = view.questions.filter(isVisible);
    const ans = s => s.trim() ? esc(s) : '<span class="empty">(empty)</span>';
    let body = `<h1>${esc(content.title)}</h1><p>${esc(g.name)}: ${esc(g.members.join(', '))}<br>Downloaded ${esc(new Date().toLocaleString())}</p>`;
    if (!shown.length) body += '<p>No question is open yet.</p>';
    for (const q of shown) {
      const d = ydocs[q.id];
      const txt = k => d ? d.getText(k).toString() : '';
      body += `<h2>Question ${q.n}: ${esc(q.title)}</h2>`;
      for (const p of (q.prompt || [])) body += `<p>${mdInline(p)}</p>`;
      if (q.legend) body += `<p>${q.legend.map((l, i) => `[${i + 1}] ${mdInline(l)}`).join('<br>')}</p>`;
      if (q.quote) body += `<blockquote>${mdInline(q.quote)}</blockquote>`;
      if (q.table) {
        const t = q.table;
        body += `<table><thead><tr><th>${esc(t.corner || '')}</th>${t.columns.map(c => `<th>${mdInline(c.label)}</th>`).join('')}</tr></thead><tbody>` +
          t.rows.map(r => `<tr><th>${mdInline(r.label)}</th>${t.columns.map(c => {
            const key = `${r.id}.${c.id}`;
            return t.fixed && t.fixed[key] != null ? `<td><em>${mdInline(t.fixed[key])}</em></td>` : `<td class="ans">${ans(txt(key))}</td>`;
          }).join('')}</tr>`).join('') + '</tbody></table>';
      } else {
        for (const p of q.parts) body += `<h3>${p.letter ? esc(p.letter) + '. ' : ''}${mdInline(p.label)}</h3><div class="ans box">${ans(txt(p.id))}</div>`;
      }
    }
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(content.title)}: ${esc(g.name)}</title><style>
      body{font:16px/1.55 Georgia,serif;max-width:960px;margin:32px auto;padding:0 18px;color:#16213A}
      h1,h2,h3,th{font-family:Arial,Helvetica,sans-serif} h2{margin-top:36px} h3{font-size:1rem;font-weight:600}
      table{border-collapse:collapse;width:100%;table-layout:fixed} th,td{border:1px solid #C9D1DC;padding:8px 10px;vertical-align:top;text-align:left}
      th{background:#F3F5F8;font-size:.9rem} .ans{white-space:pre-wrap} .box{background:#F7F8FA;padding:10px 14px}
      blockquote{border-left:4px solid #16213A;margin:12px 0;padding-left:16px} .empty{color:#888}</style></head><body>${body}</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `GV309-week9-${g.name.replace(/\W+/g, '-')}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------ start
  fetch('/api/content').then(r => r.json()).then(c => {
    content = c;
    document.title = c.title;
    $('title').textContent = c.title;
    $('subtitle').textContent = c.subtitle || '';
    connect();
  });
})();
