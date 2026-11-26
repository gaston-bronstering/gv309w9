// Binds a <textarea> to a Y.Text so several people can type in it at once.
// Local edits are turned into minimal insert/delete operations; remote edits
// are applied to the textarea while keeping the local cursor in place.
window.bindTextarea = function bindTextarea(doc, ytext, ta, onChange) {
  ta.value = ytext.toString();
  let composing = false;

  function pushLocal() {
    const oldV = ytext.toString();
    const newV = ta.value;
    if (oldV === newV) return;
    let s = 0;
    const max = Math.min(oldV.length, newV.length);
    while (s < max && oldV.charCodeAt(s) === newV.charCodeAt(s)) s++;
    let eo = oldV.length, en = newV.length;
    while (eo > s && en > s && oldV.charCodeAt(eo - 1) === newV.charCodeAt(en - 1)) { eo--; en--; }
    doc.transact(() => {
      if (eo > s) ytext.delete(s, eo - s);
      if (en > s) ytext.insert(s, newV.slice(s, en));
    }, 'local');
    onChange && onChange();
  }
  const onInput = () => { if (!composing) pushLocal(); };
  const onCompStart = () => { composing = true; };
  const onCompEnd = () => { composing = false; pushLocal(); };
  ta.addEventListener('input', onInput);
  ta.addEventListener('compositionstart', onCompStart);
  ta.addEventListener('compositionend', onCompEnd);

  function observer(ev, tr) {
    if (tr.origin === 'local') return;
    // If the user is mid-composition (IME), flush what they have first.
    let selS = ta.selectionStart, selE = ta.selectionEnd;
    const focused = document.activeElement === ta;
    let pos = 0;
    for (const op of ev.delta) {
      if (op.retain) pos += op.retain;
      else if (op.insert) {
        const l = op.insert.length;
        if (pos < selS) selS += l;
        if (pos < selE) selE += l;
        pos += l;
      } else if (op.delete) {
        const d = op.delete;
        if (pos < selS) selS -= Math.min(d, selS - pos);
        if (pos < selE) selE -= Math.min(d, selE - pos);
      }
    }
    const top = ta.scrollTop;
    ta.value = ytext.toString();
    if (focused) ta.setSelectionRange(selS, selE);
    ta.scrollTop = top;
    onChange && onChange();
  }
  ytext.observe(observer);

  return function unbind() {
    ytext.unobserve(observer);
    ta.removeEventListener('input', onInput);
    ta.removeEventListener('compositionstart', onCompStart);
    ta.removeEventListener('compositionend', onCompEnd);
  };
};

window.countWords = s => (s || '').trim().split(/\s+/).filter(Boolean).length;
window.b64ToU8 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
window.u8ToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
window.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Inline formatting for question texts: **bold** and *italic*, everything else escaped.
window.mdInline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');

// Grow a textarea to fit its text without making the page jump.
window.autosize = ta => {
  const y = window.scrollY;
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';
  if (window.scrollY !== y) window.scrollTo(window.scrollX, y);
};
