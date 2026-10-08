import { toCanvas, toSvg } from 'html-to-image';
import { getNodesBounds, type ReactFlowInstance } from '@xyflow/react';

import { themeColor } from '../theme/theme';

/** The canvas colours in the theme that is on screen right now, so an exported picture is the picture you are looking at. */
const canvasColor = () => themeColor('canvas', '#f7f7f4');
const dotColor = () => themeColor('line-strong', '#cfcdc4');
const GRID = 24;
const PADDING = 56;
const MAX_SIDE = 8000; // pixels: browsers refuse bigger canvases

export type ImageFormat = 'png' | 'svg';

/** A data URL as a Blob, without fetch (the page's security policy does not allow fetching data: addresses). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  const type = meta.split(';')[0] ?? 'application/octet-stream';
  if (meta.includes(';base64')) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(body)], { type });
}

/** The canvas background (colour and dots) as SVG, placed behind the diagram in an SVG export. */
export const svgBackdrop = (): string =>
  `<defs><pattern id="tinker-dots" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse"><circle cx="${GRID / 2}" cy="${GRID / 2}" r="1.5" fill="${dotColor()}"/></pattern></defs>` +
  `<rect width="100%" height="100%" fill="${canvasColor()}"/><rect width="100%" height="100%" fill="url(#tinker-dots)"/>`;

/** Put the backdrop right after the opening <svg ...> tag. */
export function withBackdrop(svg: string): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  return open ? svg.slice(0, open.index + open[0].length) + svgBackdrop() + svg.slice(open.index + open[0].length) : svg;
}

const nextFrame = () =>
  new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 80); // a hidden tab never draws frames: do not wait for one forever
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      requestAnimationFrame(() => resolve());
    });
  });

/**
 * Draw the diagram exactly as it looks on screen (the same cards, icons, fonts, group boundaries, notes and labels), whole, whatever the
 * current pan and zoom: the live canvas is rendered at the size of the picture, shifted so the diagram fills it, over the canvas colour
 * and dots. Nothing on the real canvas moves; only the selection is cleared for a moment so no selection outline is exported.
 */
export async function renderCanvasImage(flow: Pick<ReactFlowInstance, 'getNodes' | 'setNodes'>, format: ImageFormat): Promise<Blob> {
  const live = document.querySelector<HTMLElement>('.react-flow__viewport');
  const nodes = flow.getNodes();
  if (!live || nodes.length === 0) throw new Error('There is nothing on the canvas to export yet.');

  const selected = nodes.filter((n) => n.selected).map((n) => n.id);
  if (selected.length > 0) {
    flow.setNodes((all) => all.map((n) => (n.selected ? { ...n, selected: false } : n)));
    await nextFrame();
  }

  const bounds = getNodesBounds(flow.getNodes());
  const width = Math.ceil(bounds.width + PADDING * 2);
  const height = Math.ceil(bounds.height + PADDING * 2);
  const pixelRatio = Math.min(2, MAX_SIDE / Math.max(width, height));
  // The way React Flow's own "download image" example does it: the viewport element is rendered at the size of the picture, moved so
  // the diagram starts PADDING from the top left corner, at 100%.
  const options = { width, height, pixelRatio, cacheBust: false, style: { width: `${width}px`, height: `${height}px`, transform: `translate(${PADDING - bounds.x}px, ${PADDING - bounds.y}px) scale(1)` } };

  try {
    if (format === 'svg') {
      const dataUrl = await toSvg(live, options);
      const svg = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1));
      return new Blob([withBackdrop(svg)], { type: 'image/svg+xml' });
    }
    const layer = await toCanvas(live, options);
    const out = document.createElement('canvas');
    out.width = layer.width;
    out.height = layer.height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Images are not available in this browser.');
    ctx.fillStyle = canvasColor();
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = dotColor();
    const step = GRID * pixelRatio;
    for (let y = step / 2; y < out.height; y += step) {
      for (let x = step / 2; x < out.width; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5 * pixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.drawImage(layer, 0, 0);
    return await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be created.'))), 'image/png'));
  } finally {
    if (selected.length > 0) {
      const keep = new Set(selected);
      flow.setNodes((all) => all.map((n) => (keep.has(n.id) ? { ...n, selected: true } : n)));
    }
  }
}
