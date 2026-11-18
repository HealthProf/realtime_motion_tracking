// Interactive drawing on a canvas: tools, selection, dragging, text entry, undo and redo.
// Works with a mouse, a finger or a stylus (Pointer Events).
import { drawSelection, drawShape, measurer } from './render';
import {
  AXIS_LABELS, dist, handles, hitTest, History, isDegenerate, moveHandle, newId, PLANE_LABELS, planeCorners, translate,
  type AxisKind, type PlaneKind, type Pt, type Shape, type ShapeType,
} from './shapes';

export type Tool = 'select' | ShapeType;

export interface Style {
  color: string;
  width: number;
  /** Text size as a fraction of the surface height. */
  textScale: number;
  dashed: boolean;
  forceLabel: string;
  plane: PlaneKind;
  axis: AxisKind;
}

export interface EditorHost {
  /** Draws whatever sits under the shapes (the frame, or both videos). */
  drawBackground(ctx: CanvasRenderingContext2D): void;
  /** Called after every finished change with the full list. `created` is set for a new shape. */
  onChange(shapes: Shape[], created?: Shape): void;
  onSelect?(shape: Shape | null): void;
  /** The editor changed tool by itself (after placing a plane, to adjust its corners). */
  onTool?(tool: Tool): void;
  /** Shapes that are on screen now; others cannot be seen or picked. Default: all. */
  isVisible?(s: Shape): boolean;
}

const MIN_LEN = 6;

export class Editor {
  shapes: Shape[] = [];
  tool: Tool = 'select';
  style: Style = { color: '#facc15', width: 4, textScale: 0.035, dashed: false, forceLabel: 'Friction', plane: 'sagittal', axis: 'mediolateral' };
  selectedId: string | null = null;
  readonly history = new History<Shape[]>();
  private ctx: CanvasRenderingContext2D;
  private draft: Shape | null = null;
  private drag: { kind: 'move' | 'handle'; index: number; start: Pt; before: Shape[]; moved: boolean } | null = null;
  private anglePhase: 0 | 1 | 2 = 0;
  private editing: { id: string; isNew: boolean; before: Shape[] } | null = null;
  private textArea: HTMLTextAreaElement;
  private lastTap = { t: 0, id: '' };

  constructor(readonly canvas: HTMLCanvasElement, private host: EditorHost) {
    this.ctx = canvas.getContext('2d')!;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => this.cancelGesture());
    this.textArea = document.createElement('textarea');
    this.textArea.className = 'ann-text-input';
    this.textArea.hidden = true;
    this.textArea.setAttribute('aria-label', 'Text. Enter to finish, Shift+Enter for a new line, Escape to cancel.');
    this.textArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.finishText(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.finishText(true); }
      e.stopPropagation();
    });
    this.textArea.addEventListener('input', () => this.syncText());
    this.textArea.addEventListener('blur', () => this.finishText());
    canvas.parentElement!.appendChild(this.textArea);
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }
  get selected(): Shape | null { return this.shapes.find((s) => s.id === this.selectedId) ?? null; }
  get isTyping(): boolean { return !!this.editing; }

  /** Sets the surface size (surface pixels) and the shapes, clearing undo history. */
  load(width: number, height: number, shapes: Shape[]): void {
    this.finishText();
    this.canvas.width = width;
    this.canvas.height = height;
    this.shapes = shapes.map((s) => ({ ...s, pts: s.pts.map((p) => ({ ...p })) }));
    this.history.clear();
    this.select(null);
    this.draft = null;
    this.anglePhase = 0;
    this.redraw();
  }

  setTool(tool: Tool): void {
    this.finishText();
    if (this.anglePhase) this.cancelGesture();
    this.tool = tool;
    this.canvas.style.cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
  }

  /** Changes the style for new shapes and, where it applies, the selected shape. */
  setStyle(patch: Partial<Style>): void {
    Object.assign(this.style, patch);
    const s = this.selected;
    if (!s) return;
    const next: Shape = { ...s };
    if (patch.color !== undefined && s.type !== 'plane') next.color = patch.color;
    if (patch.width !== undefined) next.width = patch.width;
    if (patch.dashed !== undefined) next.dashed = patch.dashed;
    if (patch.textScale !== undefined) next.size = Math.round(patch.textScale * this.height);
    if (patch.forceLabel !== undefined && s.type === 'force') next.text = patch.forceLabel;
    if (patch.plane !== undefined && s.type === 'plane') { next.plane = patch.plane; next.text = PLANE_LABELS[patch.plane]; }
    if (patch.axis !== undefined && s.type === 'axis') { next.axis = patch.axis; next.text = AXIS_LABELS[patch.axis]; }
    this.replace(next);
  }

  /** Replaces a shape with an edited copy (one undo step). */
  replace(next: Shape): void {
    this.history.push(this.shapes);
    this.shapes = this.shapes.map((s) => (s.id === next.id ? next : s));
    this.commit();
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.history.push(this.shapes);
    this.shapes = this.shapes.filter((s) => s.id !== this.selectedId);
    this.select(null);
    this.commit();
  }

  undo(): void {
    this.finishText();
    const prev = this.history.undo(this.shapes);
    if (prev) { this.shapes = prev; this.select(this.selected ? this.selectedId : null); this.commit(); }
  }

  redo(): void {
    const next = this.history.redo(this.shapes);
    if (next) { this.shapes = next; this.select(this.selected ? this.selectedId : null); this.commit(); }
  }

  /** Starts editing the words of the selected text shape. */
  editSelectedText(): void {
    const s = this.selected;
    if (s && (s.type === 'text' || s.type === 'force' || s.type === 'plane' || s.type === 'axis')) this.openText(s, false);
  }

  select(id: string | null): void {
    this.selectedId = id;
    const s = this.selected;
    if (s) {
      this.style.color = s.type === 'plane' ? this.style.color : s.color;
      this.style.width = s.width;
      this.style.dashed = !!s.dashed;
    }
    this.host.onSelect?.(s);
    this.redraw();
  }

  redraw(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.host.drawBackground(ctx);
    for (const s of this.shapes) if (this.visible(s) && s.id !== this.editing?.id) drawShape(ctx, s, this.height);
    if (this.draft) drawShape(ctx, this.draft, this.height);
    const sel = this.selected;
    if (sel && this.visible(sel) && !this.editing) drawSelection(ctx, sel, this.height, this.k());
    ctx.restore();
  }

  /** Draws the shapes that are visible now onto another context (for export). */
  paint(ctx: CanvasRenderingContext2D, filter: (s: Shape) => boolean = (s) => this.visible(s)): void {
    for (const s of this.shapes) if (filter(s)) drawShape(ctx, s, this.height);
  }

  // ---- Pointer handling -------------------------------------------------------------------------

  private visible(s: Shape): boolean { return this.host.isVisible ? this.host.isVisible(s) : true; }

  /** Surface pixels per CSS pixel. */
  private k(): number {
    const r = this.canvas.getBoundingClientRect();
    return r.width ? this.width / r.width : 1;
  }

  private toSurface(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.width, y: ((e.clientY - r.top) / r.height) * this.height };
  }

  private topHit(p: Pt): Shape | null {
    const tol = (this.isTouch ? 14 : 7) * this.k(), m = measurer(this.ctx);
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      if (this.visible(s) && hitTest(s, p, tol, this.height, m)) return s;
    }
    return null;
  }

  private isTouch = false;

  private down(e: PointerEvent): void {
    if (e.button > 0) return;
    this.isTouch = e.pointerType === 'touch';
    if (this.editing) { this.finishText(); return; }
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toSurface(e);
    const style = this.style, size = Math.round(style.textScale * this.height);
    const base = { id: newId(), color: style.color, width: style.width, dashed: style.dashed };

    if (this.tool === 'select') {
      const sel = this.selected, tol = (this.isTouch ? 16 : 9) * this.k();
      if (sel && this.visible(sel) && sel.type !== 'text') {
        const hi = handles(sel).findIndex((h) => dist(h, p) <= tol);
        if (hi >= 0) { this.drag = { kind: 'handle', index: hi, start: p, before: this.shapes, moved: false }; return; }
      }
      const hit = this.topHit(p);
      if (hit) {
        const now = performance.now();
        if (hit.type === 'text' && this.lastTap.id === hit.id && now - this.lastTap.t < 400) { this.openText(hit, false); return; }
        this.lastTap = { t: now, id: hit.id };
        if (hit.id !== this.selectedId) this.select(hit.id);
        this.drag = { kind: 'move', index: -1, start: p, before: this.shapes, moved: false };
      } else this.select(null);
      return;
    }

    if (this.tool === 'angle' && this.anglePhase === 2 && this.draft) {
      this.draft = { ...this.draft, pts: [this.draft.pts[0], this.draft.pts[1], p] };
      this.redraw();
      return;
    }

    switch (this.tool) {
      case 'text': {
        const s: Shape = { ...base, type: 'text', pts: [p], text: '', size };
        this.history.push(this.shapes);
        this.shapes = [...this.shapes, s];
        this.openText(s, true);
        return;
      }
      case 'plane': {
        const s: Shape = { ...base, type: 'plane', pts: planeCorners(style.plane, p, this.height * 0.35), plane: style.plane, text: PLANE_LABELS[style.plane], size };
        this.add(s);
        this.setTool('select');
        this.host.onTool?.('select');
        return;
      }
      case 'angle':
        this.draft = { ...base, type: 'angle', pts: [p, p, p], size };
        this.anglePhase = 1;
        break;
      case 'freehand':
        this.draft = { ...base, type: 'freehand', pts: [p] };
        break;
      case 'force':
        this.draft = { ...base, type: 'force', pts: [p, p], text: style.forceLabel, size };
        break;
      case 'axis':
        this.draft = { ...base, type: 'axis', pts: [p, p], axis: style.axis, text: AXIS_LABELS[style.axis], size };
        break;
      default:
        this.draft = { ...base, type: this.tool, pts: [p, p] };
    }
    this.redraw();
  }

  private move(e: PointerEvent): void {
    const p = this.toSurface(e);
    if (this.drag) {
      const sel = this.selected;
      if (!sel) return;
      if (!this.drag.moved && dist(p, this.drag.start) < 2 * this.k()) return;
      this.drag.moved = true;
      if (this.drag.kind === 'handle') this.shapes = this.shapes.map((s) => (s.id === sel.id ? moveHandle(s, this.drag!.index, p) : s));
      else {
        const orig = this.drag.before.find((s) => s.id === sel.id)!;
        const moved = translate(orig, p.x - this.drag.start.x, p.y - this.drag.start.y);
        this.shapes = this.shapes.map((s) => (s.id === sel.id ? moved : s));
      }
      this.redraw();
      return;
    }
    const d = this.draft;
    if (!d) return;
    if (d.type === 'angle') {
      if (this.anglePhase === 1 && e.buttons) this.draft = { ...d, pts: [d.pts[0], p, p] };
      else if (this.anglePhase === 2) this.draft = { ...d, pts: [d.pts[0], d.pts[1], p] };
    } else if (d.type === 'freehand') {
      if (!e.buttons && e.pointerType === 'mouse') return;
      const last = d.pts[d.pts.length - 1];
      if (dist(last, p) >= 1.5 * this.k()) this.draft = { ...d, pts: [...d.pts, p] };
    } else if (e.buttons || e.pointerType !== 'mouse') this.draft = { ...d, pts: [d.pts[0], p] };
    this.redraw();
  }

  private up(e: PointerEvent): void {
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.drag) {
      if (this.drag.moved) { this.history.push(this.drag.before); this.commit(); }
      this.drag = null;
      return;
    }
    const d = this.draft;
    if (!d) return;
    if (d.type === 'angle') {
      if (this.anglePhase === 1) {
        // First arm drawn: now place the other end (move, then click or tap).
        if (dist(d.pts[0], d.pts[1]) < MIN_LEN * this.k()) { this.cancelGesture(); return; }
        this.anglePhase = 2;
        return;
      }
      if (this.anglePhase === 2) {
        this.anglePhase = 0;
        this.draft = null;
        if (!isDegenerate(d, MIN_LEN * this.k())) this.add(d); else this.redraw();
        return;
      }
    }
    this.draft = null;
    if (!isDegenerate(d, MIN_LEN * this.k())) this.add(d); else this.redraw();
  }

  private cancelGesture(): void {
    if (this.drag?.moved) this.shapes = this.drag.before;
    this.drag = null;
    this.draft = null;
    this.anglePhase = 0;
    this.redraw();
  }

  private add(s: Shape): void {
    this.history.push(this.shapes);
    this.shapes = [...this.shapes, s];
    this.selectedId = s.id;
    this.host.onSelect?.(s);
    this.commit(s);
  }

  private commit(created?: Shape): void {
    this.redraw();
    this.host.onChange(this.shapes, created);
  }

  // ---- Text entry -------------------------------------------------------------------------------

  private openText(s: Shape, isNew: boolean): void {
    this.editing = { id: s.id, isNew, before: isNew ? this.shapes.filter((x) => x.id !== s.id) : this.shapes };
    this.selectedId = s.id;
    const ta = this.textArea, k = this.k(), size = (s.size ?? this.style.textScale * this.height) / k;
    const r = this.canvas.getBoundingClientRect(), pr = this.canvas.parentElement!.getBoundingClientRect();
    const anchor = s.type === 'text' ? s.pts[0] : s.pts[s.pts.length - 1];
    ta.value = s.text ?? '';
    ta.style.left = `${r.left - pr.left + anchor.x / k}px`;
    ta.style.top = `${r.top - pr.top + anchor.y / k}px`;
    ta.style.fontSize = `${Math.max(14, size)}px`;
    ta.style.color = s.color;
    ta.rows = Math.max(1, ta.value.split('\n').length);
    ta.hidden = false;
    this.redraw();
    ta.focus();
    ta.select();
  }

  private syncText(): void {
    this.textArea.rows = Math.max(1, this.textArea.value.split('\n').length);
  }

  private finishText(cancel = false): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    this.textArea.hidden = true;
    const text = this.textArea.value.replace(/\s+$/, '');
    const s = this.shapes.find((x) => x.id === ed.id);
    if (!s) { this.redraw(); return; }
    if (cancel || (s.type === 'text' && !text.trim())) {
      // A new, empty text is dropped without an undo step; an edit that is cancelled is put back.
      this.shapes = ed.before;
      if (ed.isNew) this.history.discardLast();
      this.select(null);
      this.commit();
      return;
    }
    if (!ed.isNew) this.history.push(ed.before);
    this.shapes = this.shapes.map((x) => (x.id === s.id ? { ...x, text } : x));
    this.select(s.id);
    this.commit(ed.isNew ? this.shapes.find((x) => x.id === s.id) : undefined);
  }

  /** Keyboard shortcuts; returns true if the key was used. */
  key(e: KeyboardEvent): boolean {
    if (this.editing) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { if (e.shiftKey) this.redo(); else this.undo(); return true; }
    if (mod && e.key.toLowerCase() === 'y') { this.redo(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) { this.deleteSelected(); return true; }
    if (e.key === 'Escape') { if (this.anglePhase) this.cancelGesture(); else this.select(null); return true; }
    if (e.key === 'Enter' && this.selected?.type === 'text') { this.editSelectedText(); return true; }
    return false;
  }
}
