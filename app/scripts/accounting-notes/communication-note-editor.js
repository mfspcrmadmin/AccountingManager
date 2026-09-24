// Rich note editor shared in behavior and storage format with 24hManager.
function element(tag, className = '') { const node = document.createElement(tag); node.className = className; return node; }
function button(text, click) { const node = element('button'); node.type = 'button'; node.textContent = text; node.onclick = click; return node; }
export function renderNote(target, note) {
  target.replaceChildren();
  let cursor = 0;
  for (const span of note.formatting ?? []) {
    target.append(document.createTextNode(note.body.slice(cursor, span.start)));
    let node = document.createTextNode(note.body.slice(span.start, span.end));
    if (span.bold) { const strong = element('strong'); strong.append(node); node = strong; }
    if (span.underline) { const underline = element('u'); underline.append(node); node = underline; }
    target.append(node); cursor = span.end;
  }
  target.append(document.createTextNode(note.body.slice(cursor)));
}
export function noteEditor(label, note = { body: '' }) {
  const node = element('div', 'note-editor'), toolbar = element('div', 'note-format-toolbar');
  toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Note formatting');
  const input = element('div', 'note-rich-input'); input.contentEditable = 'true'; input.setAttribute('role', 'textbox'); input.setAttribute('aria-multiline', 'true'); input.setAttribute('aria-label', label); input.dataset.placeholder = 'Add an internal note...';
  renderNote(input, note);
  for (const [command, title, text] of [['bold', 'Bold', 'B'], ['underline', 'Underline', 'U']]) {
    const control = button(text, () => { input.focus(); document.execCommand(command); });
    control.className = `note-format-${command}`; control.title = `${title} (Ctrl+${text})`; control.setAttribute('aria-label', title);
    control.addEventListener('mousedown', event => event.preventDefault()); toolbar.append(control);
  }
  input.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? ''); });
  input.addEventListener('drop', event => event.preventDefault());
  node.append(toolbar, input);
  return { node, input, read() {
    let body = ''; const formatting = [];
    const append = (text, bold, underline) => {
      const start = body.length; body += text;
      if (text && (bold || underline)) formatting.push({ start, end: body.length, ...(bold ? { bold: true } : {}), ...(underline ? { underline: true } : {}) });
    };
    const walk = (node, bold = false, underline = false) => {
      if (node.nodeType === Node.TEXT_NODE) { append(node.textContent ?? '', bold, underline); return; }
      if (!(node instanceof HTMLElement)) return;
      const block = node !== input && ['DIV', 'P'].includes(node.tagName);
      if (block && body && !body.endsWith('\n')) append('\n', false, false);
      if (node.tagName === 'BR') { append('\n', false, false); return; }
      const weight = node.style.fontWeight;
      bold ||= ['B', 'STRONG'].includes(node.tagName) || weight === 'bold' || Number(weight) >= 600;
      underline ||= node.tagName === 'U' || node.style.textDecoration.includes('underline');
      node.childNodes.forEach(child => walk(child, bold, underline));
      if (block && !body.endsWith('\n')) append('\n', false, false);
    };
    walk(input);
    const trimStart = body.length - body.trimStart().length; body = body.trim();
    if (body.length > 10000) throw new Error('Notes can contain up to 10,000 characters.');
    return { body, formatting: formatting.map(span => ({ ...span, start: Math.max(0, span.start - trimStart), end: Math.min(body.length, span.end - trimStart) })).filter(span => span.end > span.start) };
  } };
}
