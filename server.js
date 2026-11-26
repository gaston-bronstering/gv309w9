'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Y = require('yjs');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.INSTRUCTOR_PASSWORD || 'changeme';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data-week9.json');
const content = JSON.parse(fs.readFileSync(path.join(__dirname, 'content.json'), 'utf8'));
const QUESTIONS = content.questions;
const QIDS = QUESTIONS.map(q => q.id);
const STATUSES = ['hidden', 'open', 'frozen'];

if (PASSWORD === 'changeme') console.warn('WARNING: INSTRUCTOR_PASSWORD is not set; using "changeme".');

// The answer fields of a question. A table gives one field per inner cell
// (minus any cell with fixed text); a question with parts gives one per part.
function fieldsOf(q) {
  if (q.table) {
    const out = [];
    for (const r of q.table.rows) for (const c of q.table.columns) {
      const key = `${r.id}.${c.id}`;
      if (!(q.table.fixed && key in q.table.fixed)) out.push({ key, label: `${r.label}: ${c.short || c.label}` });
    }
    return out;
  }
  return (q.parts || []).map(p => ({ key: p.id, label: p.short || p.label }));
}
const FIELDS = Object.fromEntries(QUESTIONS.map(q => [q.id, fieldsOf(q)]));
{
  const seen = new Set();
  for (const q of QUESTIONS) {
    if (!q.id || seen.has(q.id)) throw new Error(`content.json: every question needs its own id (problem with "${q.id}").`);
    seen.add(q.id);
    if (!FIELDS[q.id].length) throw new Error(`content.json: question "${q.id}" has neither a table nor parts.`);
  }
}

// ---------------------------------------------------------------- state
let state = { seminars: {}, groups: {}, seq: {} };
const docs = {}; // groupId -> { [questionId]: Y.Doc }

function freshSeminar() { return { status: Object.fromEntries(QIDS.map(q => [q, 'hidden'])), timerEndsAt: null }; }
for (const s of content.seminars) state.seminars[s] = freshSeminar();

const b64 = u8 => Buffer.from(u8).toString('base64');
const unb64 = s => new Uint8Array(Buffer.from(s, 'base64'));

function makeDocs(groupId, saved) {
  const d = {};
  for (const qid of QIDS) {
    d[qid] = new Y.Doc();
    if (saved && saved[qid]) Y.applyUpdate(d[qid], unb64(saved[qid]));
    d[qid].on('update', () => { scheduleSave(); markDirty(groupId); });
  }
  docs[groupId] = d;
  return d;
}

function load() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    state.groups = raw.groups || {};
    state.seq = raw.seq || {};
    for (const s of content.seminars) {
      const old = (raw.seminars || {})[s] || {};
      const sem = freshSeminar();
      for (const qid of QIDS) if (old.status && STATUSES.includes(old.status[qid])) sem.status[qid] = old.status[qid];
      sem.timerEndsAt = old.timerEndsAt || null;
      state.seminars[s] = sem;
    }
    for (const id of Object.keys(state.groups)) makeDocs(id, (raw.docs || {})[id]);
    console.log(`Loaded ${Object.keys(state.groups).length} groups from ${DATA_FILE}`);
  } catch (e) { console.error('Could not read data file, starting empty:', e.message); }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 1000);
}
function saveNow() {
  const out = { seminars: state.seminars, groups: state.groups, seq: state.seq, docs: {} };
  for (const [id, d] of Object.entries(docs)) out.docs[id] = Object.fromEntries(QIDS.map(q => [q, b64(Y.encodeStateAsUpdate(d[q]))]));
  const tmp = DATA_FILE + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, DATA_FILE); }
  catch (e) { console.error('Save failed:', e.message); }
}

// ---------------------------------------------------------------- helpers
const words = s => (s || '').trim().split(/\s+/).filter(Boolean).length;
const fieldText = (gid, qid, key) => docs[gid] ? docs[gid][qid].getText(key).toString() : '';
const answersOf = gid => Object.fromEntries(QIDS.map(qid => [qid, Object.fromEntries(FIELDS[qid].map(f => [f.key, fieldText(gid, qid, f.key)]))]));

function groupName(g) { return `Group ${g.seminar}.${g.number}`; }
function newCode() {
  const used = new Set(Object.values(state.groups).map(g => g.code));
  let c; do { c = String(crypto.randomInt(100000, 1000000)); } while (used.has(c));
  return c;
}
function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60); }
function splitNames(s) { return String(s || '').split(/[,;\n]| and /).map(cleanName).filter(Boolean).slice(0, 8); }
const sortedGroups = () => Object.values(state.groups).sort((a, b) => a.seminar.localeCompare(b.seminar) || a.number - b.number);

// Students only receive the text of questions that are open or read-only.
function questionsFor(seminar) {
  const st = state.seminars[seminar].status;
  return QUESTIONS.map((q, i) => st[q.id] === 'hidden'
    ? { id: q.id, n: i + 1, status: 'hidden' }
    : Object.assign({}, q, { n: i + 1, status: st[q.id] }));
}

function groupView(g) {
  const sem = state.seminars[g.seminar];
  return {
    group: { id: g.id, name: groupName(g), seminar: g.seminar, number: g.number, members: g.members, code: g.code },
    timerEndsAt: sem.timerEndsAt,
    serverNow: Date.now(),
    questions: questionsFor(g.seminar),
    here: pagesOf(g.id)
  };
}

// ---------------------------------------------------------------- app
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/instructor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'instructor.html')));
app.get('/api/content', (req, res) => res.json({
  title: content.title, subtitle: content.subtitle, seminars: content.seminars,
  intro: content.intro, blockPaste: !!content.blockPaste, questionCount: QUESTIONS.length
}));

const adminTokens = new Set();
app.post('/api/login', (req, res) => {
  if ((req.body || {}).password !== PASSWORD) return res.status(401).json({ error: 'Wrong password.' });
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  res.json({ token });
});

function csvCell(v) { const s = String(v == null ? '' : v); return '"' + s.replace(/"/g, '""') + '"'; }
app.get('/export.csv', (req, res) => {
  if (!adminTokens.has(req.query.token)) return res.status(401).send('Log in on the instructor page first.');
  const head = ['seminar', 'group', 'code', 'members', 'created'];
  QUESTIONS.forEach((q, i) => {
    for (const f of FIELDS[q.id]) head.push(`Q${i + 1} ${f.label}`);
    head.push(`Q${i + 1} words`);
  });
  const rows = [head];
  for (const g of sortedGroups()) {
    const r = [g.seminar, groupName(g), g.code, g.members.join('; '), new Date(g.createdAt).toISOString()];
    for (const q of QUESTIONS) {
      let total = 0;
      for (const f of FIELDS[q.id]) { const t = fieldText(g.id, q.id, f.key); total += words(t); r.push(t); }
      r.push(total);
    }
    rows.push(r);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="gv309-week9-answers.csv"');
  res.send('\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4 * 1024 * 1024 });

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function onlineCount(gid) { let n = 0; for (const c of wss.clients) if (c.groupId === gid) n++; return n; }
function pagesOf(gid) {
  const out = {};
  for (const c of wss.clients) if (c.groupId === gid && c.page) out[c.page] = (out[c.page] || 0) + 1;
  return out;
}

// ---------------------------------------------------------------- pushing views
let pushPending = false;
function pushAll() {
  if (pushPending) return;
  pushPending = true;
  setImmediate(() => {
    pushPending = false;
    for (const c of wss.clients) {
      if (c.groupId && state.groups[c.groupId]) send(c, { type: 'view', view: groupView(state.groups[c.groupId]) });
      else if (c.groupId) { c.groupId = null; send(c, { type: 'removed' }); }
    }
    scheduleAdmin();
  });
}

// The instructor page gets the group list every time, but answer texts only
// for groups whose answers changed since the last push.
const dirty = new Set();
function markDirty(gid) { dirty.add(gid); scheduleAdmin(); }
function adminGroups() {
  return sortedGroups().map(g => ({
    id: g.id, name: groupName(g), seminar: g.seminar, number: g.number, code: g.code, members: g.members,
    online: onlineCount(g.id), pages: pagesOf(g.id), lastEdit: g.lastEdit || {}, createdAt: g.createdAt
  }));
}
function adminMessage(full) {
  const ids = full ? Object.keys(state.groups) : [...dirty].filter(id => state.groups[id]);
  return { type: 'admin', full, view: { seminars: state.seminars, groups: adminGroups(), serverNow: Date.now() }, answers: Object.fromEntries(ids.map(id => [id, answersOf(id)])) };
}
let adminTimer = null;
function scheduleAdmin() {
  if (adminTimer) return;
  adminTimer = setTimeout(() => {
    adminTimer = null;
    const msg = adminMessage(false);
    dirty.clear();
    for (const c of wss.clients) if (c.isAdmin) send(c, msg);
  }, 600);
}

function attach(ws, g) {
  ws.groupId = g.id;
  ws.page = null;
  const d = docs[g.id];
  send(ws, { type: 'joined', groupId: g.id, code: g.code });
  send(ws, { type: 'ydocs', states: Object.fromEntries(QIDS.map(q => [q, b64(Y.encodeStateAsUpdate(d[q]))])) });
  pushAll();
}

function handleStudent(ws, m) {
  const g = ws.groupId && state.groups[ws.groupId];
  switch (m.type) {
    case 'create': {
      const seminar = String(m.seminar);
      if (!state.seminars[seminar]) return send(ws, { type: 'error', msg: 'Choose your seminar group.' });
      const members = splitNames(m.names);
      if (!members.length) return send(ws, { type: 'error', msg: 'Enter at least one name.' });
      state.seq[seminar] = (state.seq[seminar] || 0) + 1;
      const id = crypto.randomUUID();
      const ng = { id, code: newCode(), seminar, number: state.seq[seminar], members, createdAt: Date.now(), lastEdit: {} };
      state.groups[id] = ng;
      makeDocs(id);
      scheduleSave();
      return attach(ws, ng);
    }
    case 'join': {
      const ng = Object.values(state.groups).find(x => x.code === String(m.code || '').trim());
      if (!ng) return send(ws, { type: 'error', msg: 'No group has that code. Check the six digits with your group.' });
      const name = cleanName(m.name);
      if (name && !ng.members.some(x => x.toLowerCase() === name.toLowerCase()) && ng.members.length < 8) { ng.members.push(name); scheduleSave(); }
      return attach(ws, ng);
    }
    case 'resume': {
      const ng = state.groups[m.groupId];
      if (!ng || ng.code !== m.code) return send(ws, { type: 'resumeFailed' });
      return attach(ws, ng);
    }
  }
  if (!g) return send(ws, { type: 'error', msg: 'Join a group first.' });
  switch (m.type) {
    case 'page': {
      const p = QIDS.includes(m.page) ? m.page : (m.page === 'wait' ? 'wait' : null);
      if (ws.page !== p) { ws.page = p; pushAll(); }
      return;
    }
    case 'yupdate': {
      const qid = m.doc;
      if (!QIDS.includes(qid)) return;
      const d = docs[g.id][qid];
      if (state.seminars[g.seminar].status[qid] !== 'open') {
        return send(ws, { type: 'ydoc', doc: qid, reset: true, state: b64(Y.encodeStateAsUpdate(d)) });
      }
      try { Y.applyUpdate(d, unb64(m.update), 'remote'); } catch (e) { return; }
      for (const c of wss.clients) if (c !== ws && c.groupId === g.id) send(c, { type: 'yupdate', doc: qid, update: m.update });
      g.lastEdit = g.lastEdit || {};
      g.lastEdit[qid] = Date.now();
      return;
    }
  }
}

function handleAdmin(ws, m) {
  const sem = m.seminar != null && state.seminars[String(m.seminar)];
  switch (m.type) {
    case 'setStatus': {
      if (!sem || !QIDS.includes(m.question) || !STATUSES.includes(m.status)) return;
      sem.status[m.question] = m.status; break;
    }
    case 'timer': {
      if (!sem) return;
      const min = Number(m.minutes);
      sem.timerEndsAt = (min > 0 && min <= 240) ? Date.now() + Math.round(min * 60000) : null; break;
    }
    case 'deleteGroup': {
      const g = state.groups[m.groupId];
      if (!g) return;
      delete state.groups[g.id]; delete docs[g.id];
      break;
    }
    case 'resetAll': {
      for (const id of Object.keys(state.groups)) delete docs[id];
      state.groups = {}; state.seq = {};
      for (const s of content.seminars) state.seminars[s] = freshSeminar();
      break;
    }
    default: return;
  }
  scheduleSave(); pushAll();
  if (m.type === 'deleteGroup' || m.type === 'resetAll') for (const c of wss.clients) if (c.isAdmin) send(c, adminMessage(true));
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'admin') {
      if (!adminTokens.has(m.token)) return send(ws, { type: 'adminDenied' });
      ws.isAdmin = true;
      send(ws, { type: 'adminHello', content });
      return send(ws, adminMessage(true));
    }
    if (m.type === 'ping') return send(ws, { type: 'pong' });
    if (ws.isAdmin && m.type in { setStatus: 1, timer: 1, deleteGroup: 1, resetAll: 1 }) return handleAdmin(ws, m);
    handleStudent(ws, m);
  });
  ws.on('close', () => { if (ws.groupId) pushAll(); });
});
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 30000);

load();
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
process.on('SIGINT', () => { saveNow(); process.exit(0); });
server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}  (instructor page: /instructor)`));
