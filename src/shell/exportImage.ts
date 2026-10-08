import { toCanvas, toSvg } from 'html-to-image';
import { getNodesBounds, type ReactFlowInstance } from '@xyflow/react';

import { themeColor } from '../theme/theme';

/** The canvas colour in the theme on screen, for the picture that asks for a solid background. */
const canvasColor = () => themeColor('canvas', '#f7f7f4');
const PADDING = 56;
const MAX_SIDE = 8000; // pixels: browsers refuse bigger canvases

export type ImageFormat = 'png' | 'svg';

/** Pictures are transparent by default (no canvas colour, no dots): just the diagram. `solid` fills the canvas colour behind a PNG. */
export interface ImageOptions {
  solid?: boolean;
}

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
 * current pan and zoom: the live canvas is rendered at the size of the picture, shifted so the diagram fills it, on a transparent background. Nothing on the real canvas moves; only the selection is cleared for a moment so no selection outline is exported.
 */
export async function renderCanvasImage(flow: Pick<ReactFlowInstance, 'getNodes' | 'setNodes'>, format: ImageFormat, imageOptions: ImageOptions = {}): Promise<Blob> {
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
      return new Blob([svg], { type: 'image/svg+xml' });
    }
    const layer = await toCanvas(live, options);
    const out = document.createElement('canvas');
    out.width = layer.width;
    out.height = layer.height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Images are not available in this browser.');
    if (imageOptions.solid) {
      ctx.fillStyle = canvasColor();
      ctx.fillRect(0, 0, out.width, out.height);
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
