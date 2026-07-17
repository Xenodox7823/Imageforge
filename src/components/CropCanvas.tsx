/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, MouseEvent, TouchEvent } from 'react';
import { CropSettings } from '../types';
import { Move, Grid, Check, X } from 'lucide-react';

interface CropCanvasProps {
  imageSrc: string;
  settings: CropSettings;
  onCropComplete: (croppedDataUrl: string) => void;
  onCancel?: () => void;
}

export default function CropCanvas({ imageSrc, settings, onCropComplete, onCancel }: CropCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Refs for tracking container dimensions to prevent layout loops & thrashing
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const containerRectRef = useRef<DOMRect | null>(null);
  
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Cropping Window boundaries relative to image dimensions (0 to 1 range coordinates)
  // e.g. x: 0.1, y: 0.1, w: 0.8, h: 0.8 represents a large centered square
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0.1,
    y: 0.1,
    w: 0.8,
    h: 0.8
  });

  // Mouse/Touch interaction states
  const [dragAction, setDragAction] = useState<'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w' | null>(null);
  const [dragStartMouse, setDragStartMouse] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragStartBox, setDragStartBox] = useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });

  // Background panning / zoom states
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [touchStartDist, setTouchStartDist] = useState<number | null>(null);
  const [isMoveMode, setIsMoveMode] = useState<boolean>(false);

  // Background panning and zoom handlers
  const handleBgMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (isMoveMode) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    // If clicking the workspace background itself or the inner arena
    if (e.target === e.currentTarget || (e.target as HTMLElement).id === "workspace_arena") {
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
    } else {
      handleMouseMove(e);
    }
  };

  const handleBgMouseUp = () => {
    setIsPanning(false);
    handleMouseUp();
  };

  useEffect(() => {
    const container = document.getElementById('workspace_arena');
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 1.1;
      const nextZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
      const clampedZoom = Math.max(0.05, Math.min(25, nextZoom));

      // Scale keeping center
      let rect = containerRectRef.current;
      if (!rect && containerRef.current) {
        rect = containerRef.current.getBoundingClientRect();
        containerRectRef.current = rect;
      }

      if (rect) {
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        setPan(prevPan => ({
          x: cursorX - (cursorX - prevPan.x) * (clampedZoom / zoom),
          y: cursorY - (cursorY - prevPan.y) * (clampedZoom / zoom)
        }));
      }
      setZoom(clampedZoom);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [zoom]); // Dependency on zoom since we use it in calculation

  // Touch handlers for mobile pinching & panning
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isMoveMode) {
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
      return;
    }

    if (e.touches.length === 1) {
      // Panning if touched background
      if (e.target === e.currentTarget || (e.target as HTMLElement).id === "workspace_arena") {
        setIsPanning(true);
        setPanStart({ x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y });
      }
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
    if (isMoveMode) {
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
      return;
    }

    if (dragAction) {
      const touch = e.touches[0];
      const dx = (touch.clientX - dragStartMouse.x) / (image!.width * zoom);
      const dy = (touch.clientY - dragStartMouse.y) / (image!.height * zoom);
      updateCropBoxWithDelta(dx, dy);
    } else if (isPanning && e.touches.length === 1) {
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
    setDragAction(null);
  };

  const handleTouchStartHandle = (e: React.TouchEvent<HTMLDivElement>, action: typeof dragAction) => {
    if (isMoveMode || !image) return;
    e.stopPropagation();
    const touch = e.touches[0];
    setDragAction(action);
    setDragStartMouse({ x: touch.clientX, y: touch.clientY });
    setDragStartBox({ ...cropBox });
  };

  // Load image & handle responsive viewport scaling
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    if (!imageSrc.startsWith('blob:') && !imageSrc.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      setImage(img);
      // Initialize a standard proportional crop window
      resetCropBox(img.width, img.height);
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

      // Prevent sub-pixel or transform-induced layout loops
      const deltaW = Math.abs(lastSizeRef.current.width - width);
      const deltaH = Math.abs(lastSizeRef.current.height - height);
      if (deltaW < 1.5 && deltaH < 1.5 && lastSizeRef.current.width !== 0) {
        return;
      }

      lastSizeRef.current = { width, height };
      containerRectRef.current = container.getBoundingClientRect();

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
      lastSizeRef.current = { width: w, height: h };
      containerRectRef.current = container.getBoundingClientRect();

      const scale = Math.min((w - 60) / image.width, (h - 60) / image.height, 1);
      setZoom(scale);
      setPan({
        x: (w - image.width * scale) / 2,
        y: (h - image.height * scale) / 2
      });
    }

    return () => resizeObserver.disconnect();
  }, [image]);

  // Adjust crop box when aspect ratio settings change
  useEffect(() => {
    if (!image) return;
    applyAspectRatio(settings.aspectRatio);
  }, [settings.aspectRatio, image]);

  const resetCropBox = (imgW: number, imgH: number) => {
    let boxW = 0.8;
    let boxH = 0.8;
    const imgAspect = imgW / imgH;

    // Center crop box
    setCropBox({
      x: (1 - boxW) / 2,
      y: (1 - boxH) / 2,
      w: boxW,
      h: boxH
    });
  };

  const applyAspectRatio = (ratio: number | null) => {
    if (!image) return;
    const imgW = image.width;
    const imgH = image.height;
    const imgAspect = imgW / imgH;

    if (ratio === null) {
      // Free form
      setCropBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
      return;
    }

    // Locked aspect ratio calculation
    let boxW = 0.8;
    let boxH = boxW / ratio * imgAspect;

    if (boxH > 0.8) {
      boxH = 0.8;
      boxW = boxH * ratio / imgAspect;
    }

    setCropBox({
      x: (1 - boxW) / 2,
      y: (1 - boxH) / 2,
      w: boxW,
      h: boxH
    });
  };

  // Canvas display loop (drawing darkened backdrop & bright crop region overlay)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Use a downscaled display size for canvas on screen to ensure 60fps performance
    const maxDim = 1200;
    let dW = image.width;
    let dH = image.height;
    if (dW > maxDim || dH > maxDim) {
      if (dW > dH) {
        dH = Math.round((dH * maxDim) / dW);
        dW = maxDim;
      } else {
        dW = Math.round((dW * maxDim) / dH);
        dH = maxDim;
      }
    }

    canvas.width = dW;
    canvas.height = dH;

    // Draw original image rescaled to canvas size
    ctx.clearRect(0, 0, dW, dH);
    ctx.drawImage(image, 0, 0, dW, dH);

    // Draw Dark Overlay backdrop
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, dW, dH);

    // Calculate crop boundary in exact pixels
    const bx = cropBox.x * dW;
    const by = cropBox.y * dH;
    const bw = cropBox.w * dW;
    const bh = cropBox.h * dH;

    // Clear bright cutout area for the crop window
    ctx.save();
    if (settings.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(bx + bw / 2, by + bh / 2, Math.min(bw, bh) / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(image, 0, 0, dW, dH);
    } else if (settings.shape === 'oval') {
      ctx.beginPath();
      ctx.ellipse(bx + bw / 2, by + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(image, 0, 0, dW, dH);
    } else {
      // Standard Rect
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh);
      ctx.clip();
      ctx.drawImage(image, 0, 0, dW, dH);
    }
    ctx.restore();

    // Draw Borders and Rule of Thirds lines inside Crop box
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = Math.max(1.5, 2 / zoom);
    
    if (settings.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(bx + bw / 2, by + bh / 2, Math.min(bw, bh) / 2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (settings.shape === 'oval') {
      ctx.beginPath();
      ctx.ellipse(bx + bw / 2, by + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(bx, by, bw, bh);

      // Rule of thirds lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = Math.max(0.75, 1 / zoom);
      
      // Thirds columns
      ctx.beginPath();
      ctx.moveTo(bx + bw / 3, by);
      ctx.lineTo(bx + bw / 3, by + bh);
      ctx.moveTo(bx + (bw * 2) / 3, by);
      ctx.lineTo(bx + (bw * 2) / 3, by + bh);
      // Thirds rows
      ctx.moveTo(bx, by + bh / 3);
      ctx.lineTo(bx + bw, by + bh / 3);
      ctx.moveTo(bx, by + (bh * 2) / 3);
      ctx.lineTo(bx + bw, by + (bh * 2) / 3);
      ctx.stroke();
    }
  }, [image, cropBox, zoom, settings.shape]);

  // Handle Drag / Resize mechanics
  const updateCropBoxWithDelta = (dx: number, dy: number) => {
    if (!dragAction || !image) return;

    let nextBox = { ...dragStartBox };
    const ratio = settings.aspectRatio;
    const imgAspect = image.width / image.height;

    switch (dragAction) {
      case 'move':
        nextBox.x = clampNorm(dragStartBox.x + dx);
        nextBox.y = clampNorm(dragStartBox.y + dy);
        // Ensure bounds
        if (nextBox.x + nextBox.w > 1) nextBox.x = 1 - nextBox.w;
        if (nextBox.y + nextBox.h > 1) nextBox.y = 1 - nextBox.h;
        break;

      case 'se':
        if (ratio) {
          const maxW = Math.min(1 - dragStartBox.x, ((1 - dragStartBox.y) * ratio) / imgAspect);
          const delta = Math.max(dx, (dy * ratio) / imgAspect);
          nextBox.w = Math.max(0.05, Math.min(maxW, dragStartBox.w + delta));
          nextBox.h = (nextBox.w * imgAspect) / ratio;
        } else {
          nextBox.w = clampNorm(dragStartBox.w + dx);
          nextBox.h = clampNorm(dragStartBox.h + dy);
        }
        break;

      case 'sw':
        if (ratio) {
          const right = dragStartBox.x + dragStartBox.w;
          const maxW = Math.min(right, ((1 - dragStartBox.y) * ratio) / imgAspect);
          const delta = Math.max(-dx, (dy * ratio) / imgAspect);
          nextBox.w = Math.max(0.05, Math.min(maxW, dragStartBox.w + delta));
          nextBox.h = (nextBox.w * imgAspect) / ratio;
          nextBox.x = right - nextBox.w;
        } else {
          const right = dragStartBox.x + dragStartBox.w;
          nextBox.w = clampNorm(dragStartBox.w - dx);
          if (nextBox.w < 0.05) nextBox.w = 0.05;
          nextBox.x = clampNorm(right - nextBox.w);
          nextBox.h = clampNorm(dragStartBox.h + dy);
        }
        break;

      case 'ne':
        if (ratio) {
          const bottom = dragStartBox.y + dragStartBox.h;
          const maxW = Math.min(1 - dragStartBox.x, (bottom * ratio) / imgAspect);
          const delta = Math.max(dx, (-dy * ratio) / imgAspect);
          nextBox.w = Math.max(0.05, Math.min(maxW, dragStartBox.w + delta));
          nextBox.h = (nextBox.w * imgAspect) / ratio;
          nextBox.y = bottom - nextBox.h;
        } else {
          const bottom = dragStartBox.y + dragStartBox.h;
          nextBox.w = clampNorm(dragStartBox.w + dx);
          nextBox.h = clampNorm(dragStartBox.h - dy);
          if (nextBox.h < 0.05) nextBox.h = 0.05;
          nextBox.y = clampNorm(bottom - nextBox.h);
        }
        break;

      case 'nw':
        if (ratio) {
          const right = dragStartBox.x + dragStartBox.w;
          const bottom = dragStartBox.y + dragStartBox.h;
          const maxW = Math.min(right, (bottom * ratio) / imgAspect);
          const delta = Math.max(-dx, (-dy * ratio) / imgAspect);
          nextBox.w = Math.max(0.05, Math.min(maxW, dragStartBox.w + delta));
          nextBox.h = (nextBox.w * imgAspect) / ratio;
          nextBox.x = right - nextBox.w;
          nextBox.y = bottom - nextBox.h;
        } else {
          const right = dragStartBox.x + dragStartBox.w;
          const bottom = dragStartBox.y + dragStartBox.h;
          nextBox.w = clampNorm(dragStartBox.w - dx);
          if (nextBox.w < 0.05) nextBox.w = 0.05;
          nextBox.x = clampNorm(right - nextBox.w);
          nextBox.h = clampNorm(dragStartBox.h - dy);
          if (nextBox.h < 0.05) nextBox.h = 0.05;
          nextBox.y = clampNorm(bottom - nextBox.h);
        }
        break;

      // Side handles
      case 'e':
        if (ratio) {
          const maxW = Math.min(1 - dragStartBox.x, ((1 - dragStartBox.y) * ratio) / imgAspect);
          nextBox.w = Math.max(0.05, Math.min(maxW, dragStartBox.w + dx));
          nextBox.h = (nextBox.w * imgAspect) / ratio;
        } else {
          nextBox.w = clampNorm(dragStartBox.w + dx);
        }
        break;
      case 'w':
        if (ratio) {
          const right = dragStartBox.x + dragStartBox.w;
          const maxW = Math.min(right, ((1 - dragStartBox.y) * ratio) / imgAspect);
          nextBox.w = Math.max(0.05, Math.min(maxW, dragStartBox.w - dx));
          nextBox.x = right - nextBox.w;
          nextBox.h = (nextBox.w * imgAspect) / ratio;
        } else {
          const right = dragStartBox.x + dragStartBox.w;
          nextBox.w = clampNorm(dragStartBox.w - dx);
          if (nextBox.w < 0.05) nextBox.w = 0.05;
          nextBox.x = clampNorm(right - nextBox.w);
        }
        break;
      case 's':
        if (ratio) {
          const maxH = Math.min(1 - dragStartBox.y, ((1 - dragStartBox.x) * imgAspect) / ratio);
          nextBox.h = Math.max(0.05, Math.min(maxH, dragStartBox.h + dy));
          nextBox.w = (nextBox.h * ratio) / imgAspect;
        } else {
          nextBox.h = clampNorm(dragStartBox.h + dy);
        }
        break;
      case 'n':
        if (ratio) {
          const bottom = dragStartBox.y + dragStartBox.h;
          const maxH = Math.min(bottom, ((1 - dragStartBox.x) * imgAspect) / ratio);
          nextBox.h = Math.max(0.05, Math.min(maxH, dragStartBox.h - dy));
          nextBox.y = bottom - nextBox.h;
          nextBox.w = (nextBox.h * ratio) / imgAspect;
        } else {
          const bottom = dragStartBox.y + dragStartBox.h;
          nextBox.h = clampNorm(dragStartBox.h - dy);
          if (nextBox.h < 0.05) nextBox.h = 0.05;
          nextBox.y = clampNorm(bottom - nextBox.h);
        }
        break;
    }

    // Bounds safety
    if (nextBox.w < 0.05) nextBox.w = 0.05;
    if (nextBox.h < 0.05) nextBox.h = 0.05;
    if (nextBox.x + nextBox.w > 1) nextBox.w = 1 - nextBox.x;
    if (nextBox.y + nextBox.h > 1) nextBox.h = 1 - nextBox.y;

    setCropBox(nextBox);
  };

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>, action: typeof dragAction) => {
    if (isMoveMode) return;
    e.stopPropagation();
    if (!image) return;

    setDragAction(action);
    setDragStartMouse({ x: e.clientX, y: e.clientY });
    setDragStartBox({ ...cropBox });
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!dragAction || !image) return;

    const dx = (e.clientX - dragStartMouse.x) / (image.width * zoom);
    const dy = (e.clientY - dragStartMouse.y) / (image.height * zoom);
    updateCropBoxWithDelta(dx, dy);
  };

  const handleMouseUp = () => {
    setDragAction(null);
  };

  const clampNorm = (val: number) => {
    return Math.max(0, Math.min(1, val));
  };

  // Perform final high-precision crop on image and return data URI
  const executeCrop = () => {
    if (!image || !canvasRef.current) return;

    const originalCanvas = document.createElement('canvas');
    const rx = Math.round(cropBox.x * image.width);
    const ry = Math.round(cropBox.y * image.height);
    const rw = Math.round(cropBox.w * image.width);
    const rh = Math.round(cropBox.h * image.height);

    originalCanvas.width = rw;
    originalCanvas.height = rh;

    const oCtx = originalCanvas.getContext('2d');
    if (!oCtx) return;

    // High quality anti-aliased crop clipping
    oCtx.imageSmoothingEnabled = true;
    oCtx.imageSmoothingQuality = 'high';

    if (settings.shape === 'circle') {
      const r = Math.min(rw, rh) / 2;
      oCtx.beginPath();
      oCtx.arc(rw / 2, rh / 2, r, 0, Math.PI * 2);
      oCtx.clip();
      oCtx.drawImage(image, rx, ry, rw, rh, 0, 0, rw, rh);
    } else if (settings.shape === 'oval') {
      oCtx.beginPath();
      oCtx.ellipse(rw / 2, rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
      oCtx.clip();
      oCtx.drawImage(image, rx, ry, rw, rh, 0, 0, rw, rh);
    } else {
      // Standard rectangle
      oCtx.drawImage(image, rx, ry, rw, rh, 0, 0, rw, rh);
    }

    const outputDataUrl = originalCanvas.toDataURL('image/png');
    onCropComplete(outputDataUrl);
  };

  // Drag handles styled precisely like premium Canva/Adobe design packages (larger on mobile with touch-target support)
  const handleStyle = "absolute w-7 h-7 md:w-4.5 md:h-4.5 bg-white border border-gray-400 rounded-full z-20 cursor-pointer shadow-lg hover:scale-125 transition-transform touch-target";

  return (
    <div className="relative w-full h-full flex flex-col bg-gray-950 select-none overflow-hidden" ref={containerRef} id="crop_canvas_root">
      {/* Top action header bar */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <button
          onClick={() => setIsMoveMode(!isMoveMode)}
          className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xl ${
            isMoveMode ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white'
          }`}
          title="Toggle Pan/Zoom Image Mode"
        >
          <Move className="w-4 h-4" /> <span>{isMoveMode ? 'Moving Mode' : 'Cropping Mode'}</span>
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 font-semibold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow-xl transition active:scale-95 cursor-pointer"
          >
            <X className="w-4 h-4" /> Cancel
          </button>
        )}
        <button
          onClick={executeCrop}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-xl transition active:scale-95 cursor-pointer"
        >
          <Check className="w-4 h-4" /> Apply Crop
        </button>
      </div>

      {/* Workspace Arena */}
      <div
        id="workspace_arena"
        className={`relative w-full h-full overflow-hidden bg-gray-950 cursor-grab active:cursor-grabbing ${isMoveMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onMouseDown={handleBgMouseDown}
        onMouseMove={handleBgMouseMove}
        onMouseUp={handleBgMouseUp}
        onMouseLeave={handleBgMouseUp}
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
          {/* Main Rendering Canvas */}
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full shadow-2xl" />

          {/* Interactive Draggable Box Handle Overlay */}
          {image && (
            <div
              className={`absolute border border-dashed border-white/95 group pointer-events-auto ${isMoveMode ? 'opacity-50' : ''}`}
              style={{
                left: `${cropBox.x * 100}%`,
                top: `${cropBox.y * 100}%`,
                width: `${cropBox.w * 100}%`,
                height: `${cropBox.h * 100}%`,
              }}
            >
              {/* Inner body draggable mover */}
              <div
                onMouseDown={(e) => handleMouseDown(e, 'move')}
                onTouchStart={(e) => handleTouchStartHandle(e, 'move')}
                className={`absolute inset-0 w-full h-full ${isMoveMode ? 'pointer-events-none' : 'cursor-move bg-transparent active:bg-white/5 transition-colors'}`}
                title={isMoveMode ? "" : "Drag to reposition crop selection"}
              />

              {/* Resize handles */}
              {/* Corners */}
              <div
                onMouseDown={(e) => handleMouseDown(e, 'nw')}
                onTouchStart={(e) => handleTouchStartHandle(e, 'nw')}
                style={{ top: 0, left: 0, transform: 'translate(-50%, -50%)' }}
                className={`${handleStyle} cursor-nwse-resize ${isMoveMode ? 'pointer-events-none opacity-0' : ''}`}
              />
              <div
                onMouseDown={(e) => handleMouseDown(e, 'ne')}
                onTouchStart={(e) => handleTouchStartHandle(e, 'ne')}
                style={{ top: 0, right: 0, transform: 'translate(50%, -50%)' }}
                className={`${handleStyle} cursor-nesw-resize ${isMoveMode ? 'pointer-events-none opacity-0' : ''}`}
              />
              <div
                onMouseDown={(e) => handleMouseDown(e, 'se')}
                onTouchStart={(e) => handleTouchStartHandle(e, 'se')}
                style={{ bottom: 0, right: 0, transform: 'translate(50%, 50%)' }}
                className={`${handleStyle} cursor-nwse-resize ${isMoveMode ? 'pointer-events-none opacity-0' : ''}`}
              />
              <div
                onMouseDown={(e) => handleMouseDown(e, 'sw')}
                onTouchStart={(e) => handleTouchStartHandle(e, 'sw')}
                style={{ bottom: 0, left: 0, transform: 'translate(-50%, 50%)' }}
                className={`${handleStyle} cursor-nesw-resize ${isMoveMode ? 'pointer-events-none opacity-0' : ''}`}
              />

              {/* Edges */}
              <div
                onMouseDown={(e) => handleMouseDown(e, 'n')}
                onTouchStart={(e) => handleTouchStartHandle(e, 'n')}
                style={{ top: 0, left: '50%', transform: 'translate(-50%, -50%)' }}
                className={`${handleStyle} cursor-ns-resize ${isMoveMode ? 'pointer-events-none opacity-0' : ''}`}
              />
              <div
                onMouseDown={(e) => handleMouseDown(e, 's')}
                onTouchStart={(e) => handleTouchStartHandle(e, 's')}
                style={{ bottom: 0, left: '50%', transform: 'translate(-50%, 50%)' }}
                className={`${handleStyle} cursor-ns-resize ${isMoveMode ? 'pointer-events-none opacity-0' : ''}`}
              />
              <div
                onMouseDown={(e) => handleMouseDown(e, 'e')}
                onTouchStart={(e) => handleTouchStartHandle(e, 'e')}
                style={{ top: '50%', right: 0, transform: 'translate(50%, -50%)' }}
                className={`${handleStyle} cursor-ew-resize ${isMoveMode ? 'pointer-events-none opacity-0' : ''}`}
              />
              <div
                onMouseDown={(e) => handleMouseDown(e, 'w')}
                onTouchStart={(e) => handleTouchStartHandle(e, 'w')}
                style={{ top: '50%', left: 0, transform: 'translate(-50%, -50%)' }}
                className={`${handleStyle} cursor-ew-resize ${isMoveMode ? 'pointer-events-none opacity-0' : ''}`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
