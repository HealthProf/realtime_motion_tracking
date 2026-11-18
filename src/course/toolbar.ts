// The drawing toolbar: tools, colour, line width, text size, labels, undo and redo, and a one-line
// explanation of how to use the current tool. The help says how to use a tool, never what to draw.
import type { Editor, Tool } from './annotate/editor';
import { AXIS_LABELS, COLORS, FORCE_LABELS, PLANE_LABELS, type AxisKind, type PlaneKind, type Shape } from './annotate/shapes';

const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const TOOLS: { id: Tool; name: string; key: string; icon: string; help: string }[] = [
  { id: 'select', name: 'Select and move', key: 'V', icon: svg('<path d="M5 3l14 8-6 2-2 6z"/>'),
    help: 'Click or tap a drawing to select it. Drag it to move it; drag its yellow dots to reshape it. Double-click text (or press Edit text) to change the words. Delete removes it.' },
  { id: 'text', name: 'Text', key: 'T', icon: svg('<path d="M5 5h14M12 5v14"/>'),
    help: 'Click or tap where the text should start, then type. Enter finishes, Shift+Enter starts a new line, Escape cancels.' },
  { id: 'arrow', name: 'Arrow', key: 'A', icon: svg('<path d="M5 19L19 5M10 5h9v9"/>'),
    help: 'Drag from the tail to the point of the arrow.' },
  { id: 'line', name: 'Line', key: 'L', icon: svg('<path d="M5 19L19 5"/>'),
    help: 'Drag from one end of the line to the other.' },
  { id: 'force', name: 'Force arrow with label', key: 'F', icon: svg('<path d="M4 20L16 8M10 8h6v6"/><path d="M17 17h4M19 15v4" stroke-width="1.6"/>'),
    help: 'Drag from the point where the force acts, in the direction it acts. Pick the label from the list first, or select the arrow afterwards and press Edit text to type your own.' },
  { id: 'freehand', name: 'Pen (freehand)', key: 'P', icon: svg('<path d="M4 18c3-6 5 2 8-4s5-2 8-8"/>'),
    help: 'Drag to draw freely.' },
  { id: 'ellipse', name: 'Circle', key: 'O', icon: svg('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
    help: 'Drag across the area you want to circle.' },
  { id: 'angle', name: 'Angle', key: 'G', icon: svg('<path d="M4 20h16M4 20L15 6"/><path d="M10 20a6 6 0 0 0-2-4.5"/>'),
    help: 'Drag along the first line to the corner (vertex) and let go. Then move to the end of the second line and click or tap. The angle is measured in the picture, so it is only true when the movement is square to the camera.' },
  { id: 'plane', name: 'Plane', key: 'N', icon: svg('<path d="M3 15l6-8h12l-6 8z"/>'),
    help: 'Pick a plane from the list, then click or tap to place a panel. Drag its four corners to line it up. While it is selected you can change which plane it is from the list.' },
  { id: 'axis', name: 'Axis of rotation', key: 'X', icon: svg('<path d="M12 3v18" stroke-dasharray="3 3"/><ellipse cx="12" cy="12" rx="6" ry="2.5"/>'),
    help: 'Pick an axis from the list, then drag along the line the axis lies on. A curved arrow shows rotation about it.' },
];

const WIDTHS = [{ label: 'Thin', f: 0.0035 }, { label: 'Medium', f: 0.006 }, { label: 'Thick', f: 0.01 }];
const TEXT_SIZES = [{ label: 'Small text', f: 0.028 }, { label: 'Medium text', f: 0.038 }, { label: 'Large text', f: 0.052 }];

export interface ToolbarHandle {
  /** Refreshes buttons and lists after the selection or the surface changed. */
  sync(): void;
  setTool(t: Tool): void;
}

export function buildToolbar(root: HTMLElement, editor: Editor, opts: { disabled?: () => string | null } = {}): ToolbarHandle {
  root.innerHTML = '';
  const help = document.createElement('p');
  help.className = 'tool-help';
  help.setAttribute('aria-live', 'polite');
  root.after(help);

  const btn = (html: string, title: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = html;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    root.appendChild(b);
    return b;
  };
  const sep = () => root.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }));
  const select = (title: string, options: { value: string; label: string }[], onChange: (v: string) => void) => {
    const s = document.createElement('select');
    s.title = title;
    s.setAttribute('aria-label', title);
    s.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    s.addEventListener('change', () => onChange(s.value));
    root.appendChild(s);
    return s;
  };

  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOLS) {
    const b = btn(t.icon, `${t.name} (${t.key})`, () => setTool(t.id));
    b.setAttribute('aria-pressed', 'false');
    toolButtons.set(t.id, b);
  }
  sep();
  const swatches = COLORS.map((c) => {
    const b = btn('', `Colour ${c}`, () => { editor.setStyle({ color: c }); sync(); });
    b.className = 'swatch';
    b.style.background = c;
    b.dataset.color = c;
    return b;
  });
  let widthIdx = 1, textIdx = 1;
  const widthSel = select('Line width', WIDTHS.map((w, i) => ({ value: String(i), label: w.label })), (v) => { widthIdx = Number(v); editor.setStyle({ width: lineWidth() }); });
  const textSel = select('Text size', TEXT_SIZES.map((w, i) => ({ value: String(i), label: w.label })), (v) => { textIdx = Number(v); editor.setStyle({ textScale: TEXT_SIZES[textIdx].f }); });
  const dashBtn = btn('<span aria-hidden="true">- - -</span>', 'Dashed line', () => { editor.setStyle({ dashed: !editor.style.dashed }); sync(); });
  const forceSel = select('Force label', FORCE_LABELS.map((l) => ({ value: l, label: l })), (v) => editor.setStyle({ forceLabel: v }));
  const planeSel = select('Which plane', (Object.keys(PLANE_LABELS) as PlaneKind[]).map((k) => ({ value: k, label: PLANE_LABELS[k] })), (v) => editor.setStyle({ plane: v as PlaneKind }));
  const axisSel = select('Which axis', (Object.keys(AXIS_LABELS) as AxisKind[]).map((k) => ({ value: k, label: AXIS_LABELS[k] })), (v) => editor.setStyle({ axis: v as AxisKind }));
  sep();
  const undoBtn = btn(svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'), 'Undo (Ctrl+Z)', () => { editor.undo(); sync(); });
  const redoBtn = btn(svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'), 'Redo (Ctrl+Shift+Z)', () => { editor.redo(); sync(); });
  const editBtn = btn('Edit text', 'Edit the words of the selected item (Enter)', () => editor.editSelectedText());
  const delBtn = btn(svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'), 'Delete the selected item (Delete)', () => { editor.deleteSelected(); sync(); });
  delBtn.classList.add('danger');

  function lineWidth(): number { return Math.max(2, Math.round(WIDTHS[widthIdx].f * editor.height)); }

  function setTool(t: Tool): void {
    editor.setTool(t);
    if (t !== 'select') editor.select(null);
    sync();
  }

  function sync(): void {
    const blocked = opts.disabled?.() ?? null;
    const sel: Shape | null = editor.selected;
    for (const [id, b] of toolButtons) { b.setAttribute('aria-pressed', String(editor.tool === id)); b.disabled = !!blocked; }
    for (const s of swatches) s.setAttribute('aria-pressed', String(s.dataset.color === editor.style.color));
    dashBtn.setAttribute('aria-pressed', String(editor.style.dashed));
    const kind = sel?.type ?? editor.tool;
    forceSel.hidden = kind !== 'force';
    planeSel.hidden = kind !== 'plane';
    axisSel.hidden = kind !== 'axis';
    if (sel?.type === 'force' && sel.text && FORCE_LABELS.includes(sel.text)) forceSel.value = sel.text;
    if (sel?.plane) planeSel.value = sel.plane;
    if (sel?.axis) axisSel.value = sel.axis;
    textSel.hidden = !['text', 'force', 'angle', 'plane', 'axis'].includes(kind);
    undoBtn.disabled = !editor.history.canUndo;
    redoBtn.disabled = !editor.history.canRedo;
    editBtn.hidden = !sel || !['text', 'force', 'plane', 'axis'].includes(sel.type);
    delBtn.disabled = !sel;
    const t = TOOLS.find((x) => x.id === editor.tool)!;
    help.textContent = blocked ?? `${t.name}: ${t.help}`;
  }

  // Width follows the surface size, so set it once a surface is loaded.
  widthSel.value = String(widthIdx);
  textSel.value = String(textIdx);
  const origLoad = editor.load.bind(editor);
  editor.load = (w, h, shapes) => { origLoad(w, h, shapes); editor.style.width = lineWidth(); editor.style.textScale = TEXT_SIZES[textIdx].f; sync(); };

  sync();
  return { sync, setTool };
}

/** Single-key tool shortcuts (no modifier), for laptops. */
export function toolForKey(key: string): Tool | null {
  return TOOLS.find((t) => t.key.toLowerCase() === key.toLowerCase())?.id ?? null;
}
