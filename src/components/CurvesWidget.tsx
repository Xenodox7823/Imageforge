/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';

interface CurvesWidgetProps {
  points: { x: number; y: number }[];
  onChange: (points: { x: number; y: number }[]) => void;
}

export default function CurvesWidget({ points, onChange }: CurvesWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  // Render Tone Curve Grid and Path
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear Canvas
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, width, height);

    // Draw Grid lines
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;

    // Horiz/Vert lines
    for (let i = 1; i < 4; i++) {
      const pos = (width / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(width, pos);
      ctx.stroke();
    }

    // Diagonal reference line
    ctx.strokeStyle = '#4b5563';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Sort points by x
    const sorted = [...points].sort((a, b) => a.x - b.x);

    // Draw Spline Curve path
    ctx.strokeStyle = '#6366f1'; // Indigo-500
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, height);

    // Let's compute Curve Mapping lookup
    const raw = new Float32Array(256);
    let pIdx = 0;
    for (let i = 0; i < 256; i++) {
      while (pIdx < sorted.length - 1 && sorted[pIdx + 1].x < i) {
        pIdx++;
      }
      const p1 = sorted[pIdx];
      const p2 = sorted[pIdx + 1];
      if (p1.x === p2.x) {
        raw[i] = p1.y;
      } else {
        const t = (i - p1.x) / (p2.x - p1.x);
        raw[i] = p1.y + t * (p2.y - p1.y);
      }
    }

    // Render LUT
    for (let i = 0; i <= 255; i++) {
      const cx = (i / 255) * width;
      // Flip Y axis since canvas 0,0 is top-left but Cartesian 0,0 is bottom-left
      const cy = height - (raw[i] / 255) * height;
      if (i === 0) {
        ctx.moveTo(cx, cy);
      } else {
        ctx.lineTo(cx, cy);
      }
    }
    ctx.stroke();

    // Draw Control Points
    points.forEach((p, idx) => {
      const px = (p.x / 255) * width;
      const py = height - (p.y / 255) * height;

      ctx.fillStyle = draggedIdx === idx ? '#818cf8' : '#4f46e5';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }, [points, draggedIdx]);

  // Coordinate Conversion: Screen/Canvas Mouse coords to 0-255 Cartesian coords
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 255;
    const y = (1 - (e.clientY - rect.top) / rect.height) * 255;

    // Check if we clicked an existing point
    let clickedIdx: number | null = null;
    points.forEach((p, idx) => {
      // Threshold 15 distance in 0-255 scale
      const dist = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
      if (dist < 15) {
        clickedIdx = idx;
      }
    });

    if (clickedIdx !== null) {
      setDraggedIdx(clickedIdx);
    } else {
      // Add a new point (max 10 points to prevent overload)
      if (points.length < 10) {
        const newPoints = [...points, { x: Math.round(x), y: Math.round(y) }].sort((a, b) => a.x - b.x);
        onChange(newPoints);
        // Find index of newly added point to drag it immediately
        const idx = newPoints.findIndex((p) => p.x === Math.round(x));
        if (idx !== -1) setDraggedIdx(idx);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggedIdx === null || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    let x = Math.round(((e.clientX - rect.left) / rect.width) * 255);
    let y = Math.round((1 - (e.clientY - rect.top) / rect.height) * 255);

    x = Math.max(0, Math.min(255, x));
    y = Math.max(0, Math.min(255, y));

    // Corner points (x=0 and x=255) must stay bound to their vertical boundaries
    const isFirst = draggedIdx === 0;
    const isLast = draggedIdx === points.length - 1;

    let updated = [...points];
    if (isFirst) {
      updated[draggedIdx] = { x: 0, y };
    } else if (isLast) {
      updated[draggedIdx] = { x: 255, y };
    } else {
      // Prevent crossing neighboring points
      const leftBound = points[draggedIdx - 1]?.x || 0;
      const rightBound = points[draggedIdx + 1]?.x || 255;
      x = Math.max(leftBound + 1, Math.min(rightBound - 1, x));

      updated[draggedIdx] = { x, y };
    }

    onChange(updated);
  };

  const handleMouseUp = () => {
    setDraggedIdx(null);
  };

  // Remove a control point on double-click (except ends: 0,0 and 255,255)
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 255;
    const y = (1 - (e.clientY - rect.top) / rect.height) * 255;

    let targetIdx: number | null = null;
    points.forEach((p, idx) => {
      const dist = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
      if (dist < 15 && idx !== 0 && idx !== points.length - 1) {
        targetIdx = idx;
      }
    });

    if (targetIdx !== null) {
      const updated = points.filter((_, idx) => idx !== targetIdx);
      onChange(updated);
      setDraggedIdx(null);
    }
  };

  const resetCurve = () => {
    onChange([
      { x: 0, y: 0 },
      { x: 128, y: 128 },
      { x: 255, y: 255 }
    ]);
  };

  return (
    <div className="bg-gray-950 p-3 rounded-lg border border-gray-800" ref={containerRef} id="curves_container">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest font-mono">Tone Curves</span>
        <button
          onClick={resetCurve}
          className="text-[10px] text-gray-500 hover:text-white transition uppercase font-mono px-1 py-0.5 rounded border border-gray-800 hover:border-gray-700 bg-gray-900"
        >
          Reset Curve
        </button>
      </div>
      <div className="relative aspect-square w-full rounded border border-gray-800 overflow-hidden bg-gray-950 select-none">
        <canvas
          ref={canvasRef}
          width={200}
          height={200}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          className="w-full h-full cursor-pointer touch-none"
        />
      </div>
      <div className="flex justify-between mt-2 text-[9px] text-gray-500 font-mono">
        <span>0 (BLACK)</span>
        <span>INPUT / OUTPUT</span>
        <span>255 (WHITE)</span>
      </div>
    </div>
  );
}
