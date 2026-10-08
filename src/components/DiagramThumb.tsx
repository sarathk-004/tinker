import React from 'react';
import type { DiagramCard } from '../contracts';

const W = 220;
const H = 90;

/** A tiny drawing of a diagram's layout (boxes and the lines between them), from the positions the server sends with each card. */
export const DiagramThumb: React.FC<{ preview: DiagramCard['preview']; className?: string }> = ({ preview, className = '' }) => {
  const { nodes, edges } = preview;
  if (nodes.length === 0) {
    return <div className={`flex items-center justify-center text-[12px] text-muted ${className}`}>Empty diagram</div>;
  }
  const xs = nodes.map((n) => n[0]);
  const ys = nodes.map((n) => n[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX + W;
  const height = Math.max(...ys) - minY + H;
  const pad = 30;
  const centre = (i: number) => ({ x: nodes[i]![0] - minX + W / 2, y: nodes[i]![1] - minY + H / 2 });
  return (
    <svg viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`} preserveAspectRatio="xMidYMid meet" className={className} aria-hidden>
      {edges.map(([a, b], i) => {
        const p = centre(a);
        const q = centre(b);
        return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="rgb(var(--muted))" strokeWidth={6} strokeLinecap="round" opacity={0.8} />;
      })}
      {nodes.map(([x, y], i) => (
        <rect key={i} x={x - minX} y={y - minY} width={W} height={H} rx={14} fill="rgb(var(--surface))" stroke="rgb(var(--line-strong))" strokeWidth={5} />
      ))}
    </svg>
  );
};
