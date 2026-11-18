// Exports for submission: a PDF of an analysis's snapshots, and file names.
import { drawShape } from './annotate/render';
import { clock } from '../capture/videoFile';
import type { AnalysisDef, ProjectDef, Snapshot } from './types';

/** Safe piece of a file name: letters, digits and hyphens. */
export function slug(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'student';
}

/** e.g. "Rivera-P1-A1". Uses the last word of the name, which is the family name for most students. */
export function exportBase(student: string, project: ProjectDef, analysisIndex: number): string {
  const words = student.trim().split(/\s+/).filter(Boolean);
  const name = words.length ? slug(words[words.length - 1]) : 'student';
  return `${name}-${slug(project.short ?? project.id.toUpperCase())}-A${analysisIndex + 1}`;
}

/** The snapshot picture with its drawings, as a canvas at full resolution. */
export async function flatten(s: Snapshot): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(s.image);
  const c = document.createElement('canvas');
  c.width = s.width;
  c.height = s.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, s.width, s.height);
  bmp.close();
  for (const sh of s.shapes) drawShape(ctx, sh, s.height);
  return c;
}

export interface PdfInfo {
  course: string;
  student: string;
  project: ProjectDef;
  analysis: AnalysisDef;
  clipTitle: string;
  snapshotLabel: string;
}

/** Builds the PDF: a cover page, then one page per snapshot. */
export async function analysisPdf(snaps: Snapshot[], info: PdfInfo): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36;
  const prompts = new Map(info.analysis.prompts.map((p) => [p.id, p]));
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const footer = (page: number, total: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`${info.student} · ${info.project.title} · ${info.analysis.title}`, M, H - 18);
    doc.text(`Page ${page} of ${total}`, W - M, H - 18, { align: 'right' });
  };
  const total = snaps.length + 1;

  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(`${info.analysis.title}`, M, M + 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  const lines = [info.course, info.project.title, `Student: ${info.student}`, `Clip: ${info.clipTitle}`, `Exported: ${date}`];
  lines.forEach((l, i) => doc.text(l, M, M + 56 + i * 20));
  let y = M + 56 + lines.length * 20 + 20;
  doc.setFont('helvetica', 'bold');
  doc.text(`${info.snapshotLabel}s`, M, y);
  doc.setFont('helvetica', 'normal');
  y += 20;
  snaps.forEach((s, i) => {
    const p = s.promptId ? prompts.get(s.promptId) : undefined;
    doc.text(`${i + 2}.  ${s.name}${p ? `  ·  ${p.title}` : ''}  ·  clip time ${clock(s.time)}`, M + 8, y);
    y += 18;
  });
  footer(1, total);

  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    doc.addPage();
    const p = s.promptId ? prompts.get(s.promptId) : undefined;
    doc.setTextColor(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(s.name, M, M + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(`${p ? `${p.title}${p.points ? ` (${p.points} points)` : ''}  ·  ` : ''}Clip time ${clock(s.time)}`, M, M + 24);
    const top = M + 38, maxW = W - 2 * M, maxH = H - top - 34;
    const k = Math.min(maxW / s.width, maxH / s.height), w = s.width * k, h = s.height * k;
    const c = await flatten(s);
    doc.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', M + (maxW - w) / 2, top, w, h);
    footer(i + 2, total);
  }
  return doc.output('blob');
}
