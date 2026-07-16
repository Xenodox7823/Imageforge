/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, MouseEvent } from 'react';
import { PassportPreset } from '../types';
import { Check, ShieldCheck, Printer, ArrowRight, X } from 'lucide-react';

interface PassportCanvasProps {
  imageSrc: string;
  preset: PassportPreset;
  onExportPrintSheet: (dataUrl: string) => void;
  onSingleExport: (dataUrl: string) => void;
  onCancel?: () => void;
}

export default function PassportCanvas({
  imageSrc,
  preset,
  onExportPrintSheet,
  onSingleExport,
  onCancel
}: PassportCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Face guides adjustment (the user can drag the face boundaries guide to align it perfectly with their face!)
  // Relative coordinates in the passport crop window
  const [faceX, setFaceX] = useState<number>(0.5); // Center X
  const [faceY, setFaceY] = useState<number>(0.4); // Center Y
  const [faceRadius, setFaceRadius] = useState<number>(0.25); // Radius size

  const [isDraggingGuide, setIsDraggingGuide] = useState<boolean>(false);
  const [isResizingGuide, setIsResizingGuide] = useState<boolean>(false);

  // Background panning / zoom states
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [touchStartDist, setTouchStartDist] = useState<number | null>(null);

  // Background panning and zoom handlers
  const handleBgMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).id === "passport_workspace_arena") {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleBgMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleBgMouseUp = () => {
    setIsPanning(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    const nextZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
    setZoom(Math.max(0.1, Math.min(10, nextZoom)));
  };

  // Touch handlers for mobile pinching & panning
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      setIsPanning(true);
      setPanStart({ x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y });
    } else if (e.touches.length === 2) {
      setIsPanning(false);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setTouchStartDist(dist);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isPanning && e.touches.length === 1) {
      setPan({
        x: e.touches[0].clientX - panStart.x,
        y: e.touches[0].clientY - panStart.y
      });
    } else if (e.touches.length === 2 && touchStartDist) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scaleFactor = dist / touchStartDist;
      setTouchStartDist(dist);
      setZoom(prev => Math.max(0.1, Math.min(10, prev * scaleFactor)));
    }
  };

  const handleTouchEnd = () => {
    setIsPanning(false);
    setTouchStartDist(null);
  };

  // Load Image
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Auto-fit scale on resize using ResizeObserver
  useEffect(() => {
    if (!image || !containerRef.current) return;

    const container = containerRef.current;

    const handleResize = (entries: ResizeObserverEntry[]) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;

      const scale = Math.min((width - 60) / image.width, (height - 60) / image.height, 1);
      setZoom(scale);
      setPan({
        x: (width - image.width * scale) / 2,
        y: (height - image.height * scale) / 2
      });
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Initial scale calculation
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      const scale = Math.min((w - 60) / image.width, (h - 60) / image.height, 1);
      setZoom(scale);
      setPan({
        x: (w - image.width * scale) / 2,
        y: (h - image.height * scale) / 2
      });
    }

    return () => resizeObserver.disconnect();
  }, [image]);

  // Main Render loop drawing the image and standard government guide overlays
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // We force canvas to render EXACTLY at standard high DPI PX dimensions of the chosen preset country
    const targetW = preset.widthPx;
    const targetH = preset.heightPx;
    canvas.width = targetW;
    canvas.height = targetH;

    // Draw original image scaled/fitted to this canvas beautifully
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(image, 0, 0, targetW, targetH);

    // --- Government Regulation Guidelines Overlay ---
    // Outer shadow box masking area
    ctx.strokeStyle = '#ef4444'; // Red borders
    ctx.lineWidth = 2.5;
    ctx.strokeRect(1, 1, targetW - 2, targetH - 2);

    // 1. Center alignment vertical line
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(targetW / 2, 0);
    ctx.lineTo(targetW / 2, targetH);
    ctx.stroke();

    // 2. Eye level guideline line
    const eyeY = faceY * targetH - (faceRadius * targetH * 0.2); // Eye line estimate
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)'; // Blue
    ctx.beginPath();
    ctx.moveTo(0, eyeY);
    ctx.lineTo(targetW, eyeY);
    ctx.stroke();

    // 3. Face Centering guidelines (Outer Head Circle and Inner Face Oval)
    const cx = faceX * targetW;
    const cy = faceY * targetH;
    const r = faceRadius * targetH;

    ctx.strokeStyle = '#22c55e'; // Green face guide
    ctx.setLineDash([]);
    ctx.lineWidth = 2.5;

    // Draw main head circle guide
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Draw Chin guideline bottom mark
    const chinY = cy + r;
    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(cx - 30, chinY);
    ctx.lineTo(cx + 30, chinY);
    ctx.stroke();

    // Draw Crown guideline top mark
    const crownY = cy - r;
    ctx.beginPath();
    ctx.moveTo(cx - 30, crownY);
    ctx.lineTo(cx + 30, crownY);
    ctx.stroke();
  }, [image, preset, faceX, faceY, faceRadius]);

  // Guidelines interactivity: drag or resize the face rings to match the subject's face
  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width);
    const my = ((e.clientY - rect.top) / rect.height);

    // Measure distance from click to face guide center
    const dist = Math.sqrt(Math.pow(mx - faceX, 2) + Math.pow(my - faceY, 2));

    if (Math.abs(dist - faceRadius) < 0.05) {
      // Clicked on boundary circle: resize
      setIsResizingGuide(true);
    } else if (dist < faceRadius) {
      // Clicked inside: drag center
      setIsDraggingGuide(true);
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width);
    const my = ((e.clientY - rect.top) / rect.height);

    if (isDraggingGuide) {
      setFaceX(Math.max(0.1, Math.min(0.9, mx)));
      setFaceY(Math.max(0.1, Math.min(0.9, my)));
    } else if (isResizingGuide) {
      const dist = Math.sqrt(Math.pow(mx - faceX, 2) + Math.pow(my - faceY, 2));
      setFaceRadius(Math.max(0.1, Math.min(0.45, dist)));
    }
  };

  const handleMouseUp = () => {
    setIsDraggingGuide(false);
    setIsResizingGuide(false);
  };

  // Helper to generate high-resolution passport photo without any visible guidelines/regulation markers
  const getCleanPassportDataUrl = (): string => {
    if (!image) return '';
    const tempCanvas = document.createElement('canvas');
    const targetW = preset.widthPx;
    const targetH = preset.heightPx;
    tempCanvas.width = targetW;
    tempCanvas.height = targetH;
    
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return '';
    
    // Draw original image scaled/fitted to this canvas beautifully
    tempCtx.clearRect(0, 0, targetW, targetH);
    tempCtx.drawImage(image, 0, 0, targetW, targetH);
    
    return tempCanvas.toDataURL('image/jpeg', 0.98);
  };

  // Single standard size export
  const handleSingleExport = () => {
    const dataUrl = getCleanPassportDataUrl();
    if (dataUrl) {
      onSingleExport(dataUrl);
    }
  };

  // EXPORT PRINT SHEET: Creates a 4x6 photo card sheet containing a neat grid (e.g., 2x3 grid = 6 passport photos)
  const handlePrintSheetExport = () => {
    const cleanPassportUrl = getCleanPassportDataUrl();
    if (!cleanPassportUrl) return;

    const passportImg = new Image();
    passportImg.onload = () => {
      // Create a 4x6 printable card canvas at high resolution (1200 x 1800 px)
      const sheet = document.createElement('canvas');
      sheet.width = 1800;  // 6 inches * 300 dpi
      sheet.height = 1200; // 4 inches * 300 dpi

      const sCtx = sheet.getContext('2d');
      if (!sCtx) return;

      // Fill elegant white back sheet
      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(0, 0, sheet.width, sheet.height);

      // Draw faint grey trim cut-lines
      sCtx.strokeStyle = '#e5e7eb';
      sCtx.lineWidth = 2;

      // Draw 6 passport photos organized in 2 rows, 3 columns
      const gap = 45; // gap between cards
      const cardW = preset.widthPx; // around 413 - 600 px depending on country
      const cardH = preset.heightPx;

      // Layout coordinates centered on printable page
      const startX = (sheet.width - (cardW * 3 + gap * 2)) / 2;
      const startY = (sheet.height - (cardH * 2 + gap * 1)) / 2;

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const px = startX + col * (cardW + gap);
          const py = startY + row * (cardH + gap);

          // Draw faint alignment box border
          sCtx.strokeRect(px - 1, py - 1, cardW + 2, cardH + 2);

          // Draw the passport photo
          sCtx.drawImage(passportImg, px, py, cardW, cardH);
        }
      }

      const printSheetDataUrl = sheet.toDataURL('image/jpeg', 0.98);
      onExportPrintSheet(printSheetDataUrl);
    };
    passportImg.src = cleanPassportUrl;
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-gray-950 select-none overflow-hidden" ref={containerRef} id="passport_root">
      {/* Action panel right */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            className="bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 font-semibold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow-xl transition active:scale-95"
          >
            <X className="w-4 h-4" /> Cancel
          </button>
        )}
        <button
          onClick={handleSingleExport}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow-xl active:scale-95 transition"
        >
          <Check className="w-4 h-4" /> Save Passport Photo
        </button>
        <button
          onClick={handlePrintSheetExport}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow-xl active:scale-95 transition"
          title="Creates a high resolution 4x6 inch (6 passport photos) layout template sheet"
        >
          <Printer className="w-4 h-4" /> Export 4x6 Printable Sheet (Grid of 6)
        </button>
      </div>

      {/* Guide Help Info */}
      <div className="absolute top-4 left-4 z-10 bg-gray-900/90 backdrop-blur border border-gray-800 px-3.5 py-2 rounded-lg max-w-sm">
        <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest font-mono flex items-center gap-1.5 mb-1">
          <ShieldCheck className="w-4 h-4 text-emerald-400" /> Regulation Check
        </div>
        <ul className="text-[10px] text-gray-300 space-y-1 text-left list-disc list-inside leading-snug">
          {preset.regulations.map((reg, idx) => (
            <li key={idx} className="line-clamp-2">{reg}</li>
          ))}
          <li className="text-amber-400 font-medium">Drag the green head rings and blue eye lines to align your face.</li>
        </ul>
      </div>

      {/* Workspace arena */}
      <div
        id="passport_workspace_arena"
        className="relative w-full h-full overflow-hidden bg-gray-950 cursor-grab active:cursor-grabbing"
        onMouseDown={handleBgMouseDown}
        onMouseMove={handleBgMouseMove}
        onMouseUp={handleBgMouseUp}
        onMouseLeave={handleBgMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="absolute left-0 top-0 origin-top-left max-w-none pointer-events-auto"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: image ? image.width : 0,
            height: image ? image.height : 0,
          }}
        >
          {image && (
            <div className="relative border-4 border-indigo-500 shadow-2xl rounded overflow-hidden bg-white pointer-events-auto">
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className="w-full h-full cursor-pointer touch-none"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
