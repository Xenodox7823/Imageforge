/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { HistogramData } from '../utils/imageProcessing';

interface HistogramProps {
  histogramData: HistogramData | null;
}

export default function Histogram({ histogramData }: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeChannel, setActiveChannel] = useState<'all' | 'r' | 'g' | 'b' | 'luma'>('all');

  useEffect(() => {
    if (!histogramData || !canvasRef.current) return;

    const hist = histogramData;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = '#111827'; // Dark gray
    ctx.fillRect(0, 0, width, height);

    // Draw reference lines
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = (width / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Find global maximum to normalize height
    let maxVal = 1;
    const channelsToFindMax: (keyof HistogramData)[] = ['r', 'g', 'b', 'luma'];
    channelsToFindMax.forEach((channel) => {
      const max = Math.max(...hist[channel]);
      if (max > maxVal) maxVal = max;
    });

    // Ensure we don't scale purely to extreme peaks (like white backgrounds)
    // Scale slightly more adaptively
    const sortedLuma = [...hist.luma].sort((a, b) => b - a);
    // Ignore top 2 values for peak scaling
    const adaptiveMax = sortedLuma[2] || maxVal;
    const finalMax = Math.max(adaptiveMax, maxVal * 0.15);

    // Draw function
    const drawChannelPath = (
      data: number[],
      color: string,
      fillColor: string,
      lineWidth: number = 1.5,
      fill: boolean = true
    ) => {
      ctx.beginPath();
      ctx.moveTo(0, height);

      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * width;
        const val = Math.min(finalMax, data[i]);
        const y = height - (val / finalMax) * (height - 4);
        ctx.lineTo(x, y);
      }

      ctx.lineTo(width, height);
      ctx.closePath();

      if (fill) {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };

    // Render channels
    ctx.globalCompositeOperation = 'screen';

    if (activeChannel === 'all' || activeChannel === 'r') {
      drawChannelPath(hist.r, '#ef4444', 'rgba(239, 68, 68, 0.12)', 1.5, activeChannel === 'r');
    }
    if (activeChannel === 'all' || activeChannel === 'g') {
      drawChannelPath(hist.g, '#10b981', 'rgba(16, 185, 129, 0.12)', 1.5, activeChannel === 'g');
    }
    if (activeChannel === 'all' || activeChannel === 'b') {
      drawChannelPath(hist.b, '#3b82f6', 'rgba(59, 130, 246, 0.12)', 1.5, activeChannel === 'b');
    }
    if (activeChannel === 'all' || activeChannel === 'luma') {
      drawChannelPath(hist.luma, '#f3f4f6', 'rgba(243, 244, 246, 0.15)', 2, activeChannel === 'luma');
    }

    ctx.globalCompositeOperation = 'source-over';
  }, [histogramData, activeChannel]);

  if (!histogramData) {
    return (
      <div className="h-32 bg-gray-900 rounded-lg flex items-center justify-center border border-gray-800 text-xs text-gray-500 font-mono">
        No active histogram data
      </div>
    );
  }

  return (
    <div className="bg-gray-950 p-3 rounded-lg border border-gray-800" id="editor_histogram_container">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest font-mono">Histogram</span>
        <div className="flex bg-gray-900 border border-gray-800 rounded p-0.5 text-[10px] font-mono">
          {(['all', 'r', 'g', 'b', 'luma'] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setActiveChannel(ch)}
              className={`px-1.5 py-0.5 rounded transition ${
                activeChannel === ch
                  ? 'bg-gray-800 text-white font-medium'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {ch.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={256}
        height={100}
        className="w-full h-24 rounded border border-gray-800 cursor-crosshair bg-gray-950"
      />
      <div className="flex justify-between mt-1 text-[9px] text-gray-500 font-mono">
        <span>SHADOWS</span>
        <span>MIDTONES</span>
        <span>HIGHLIGHTS</span>
      </div>
    </div>
  );
}
