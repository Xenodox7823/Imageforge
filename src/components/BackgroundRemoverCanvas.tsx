/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useEffect, useState, MouseEvent } from 'react';
import { BackgroundRemovalSettings } from '../types';
import { applyColorKeyRemoval, applyAISegmentBackground, paintOnMask, applyLocalMagicBrush } from '../utils/backgroundRemoval';
import { applyFastBlur, hexToRgb } from '../utils/imageProcessing';
import { Sparkles, Check, RefreshCw, Eye, EyeOff, Brush, ShieldAlert, X } from 'lucide-react';

interface BackgroundRemoverCanvasProps {
  imageSrc: string;
  settings: BackgroundRemovalSettings;
  onMaskComplete: (dataUrl: string) => void;
  onCancel?: () => void;
}

export default function BackgroundRemoverCanvas({
  imageSrc,
  settings,
  onMaskComplete,
  onCancel
}: BackgroundRemoverCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Main Foreground Alpha Mask (0 = transparent, 255 = fully opaque foreground)
  const [mask, setMask] = useState<Uint8ClampedArray | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [showMaskOnly, setShowMaskOnly] = useState<boolean>(false);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const lastBrushPointRef = useRef<{ x: number; y: number } | null>(null);
  // PERF: Cache source ImageData to avoid creating a new full-size canvas
  // on every tolerance/feather settings change
  const cachedSourceDataRef = useRef<ImageData | null>(null);
  const cachedSourceImageRef = useRef<HTMLImageElement | null>(null);
  const segmentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persistent temp canvas to avoid creating/destroying per render
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load Image
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
      if (containerRef.current) {
        const cWidth = containerRef.current.clientWidth;
        const cHeight = containerRef.current.clientHeight;
        const scale = Math.min((cWidth - 60) / img.width, (cHeight - 60) / img.height, 1);
        setZoom(scale);
        setPan({
          x: (cWidth - img.width * scale) / 2,
          y: (cHeight - img.height * scale) / 2
        });
      }

      // Initialize default mask (all foreground)
      const initialMask = new Uint8ClampedArray(img.width * img.height).fill(255);
      setMask(initialMask);
    };
    img.src = imageSrc;

    return () => {
      // Invalidate cached source data when image source changes
      cachedSourceDataRef.current = null;
      cachedSourceImageRef.current = null;
    };
  }, [imageSrc]);

  useEffect(() => {
    if (!settings.bgImageUrl) {
      setBackgroundImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBackgroundImage(img);
    img.onerror = () => setBackgroundImage(null);
    img.src = settings.bgImageUrl;
  }, [settings.bgImageUrl]);

  const getSourceImageData = (): ImageData | null => {
    if (!image) return null;
    // Return cached version if image hasn't changed
    if (cachedSourceDataRef.current && cachedSourceImageRef.current === image) {
      // Return a copy so callers can mutate it without corrupting the cache
      return new ImageData(
        new Uint8ClampedArray(cachedSourceDataRef.current.data),
        cachedSourceDataRef.current.width,
        cachedSourceDataRef.current.height
      );
    }
    const analysisCanvas = document.createElement('canvas');
    analysisCanvas.width = image.naturalWidth || image.width;
    analysisCanvas.height = image.naturalHeight || image.height;
    // willReadFrequently: true prevents GPU→CPU roundtrip on every getImageData call
    const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
    if (!analysisCtx) return null;
    analysisCtx.drawImage(image, 0, 0, analysisCanvas.width, analysisCanvas.height);
    const imgData = analysisCtx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
    // Cache for future calls
    cachedSourceDataRef.current = imgData;
    cachedSourceImageRef.current = image;
    // Free the temporary canvas GPU memory
    analysisCanvas.width = 0;
    analysisCanvas.height = 0;
    // Return a copy so the cache stays pristine
    return new ImageData(
      new Uint8ClampedArray(imgData.data),
      imgData.width,
      imgData.height
    );
  };

  // Handle Automatic segmentation or key color updates. Analysis intentionally
  // uses an offscreen source-sized canvas; the visible preview may be resized.
  const handleAutoAISegment = () => {
    try {
      const imgData = getSourceImageData();
      if (!imgData) return;
      const aiMask = applyAISegmentBackground(imgData, settings.tolerance);
      setMask(aiMask);
    } catch {
      alert('Unable to analyze this image. Please reload it from a local file.');
    }
  };

  const handleColorKeySegment = () => {
    try {
      const imgData = getSourceImageData();
      if (!imgData) return;
      const keyMask = applyColorKeyRemoval(imgData, settings.colorKey, settings.tolerance, settings.feather, settings.grow);
      setMask(keyMask);
    } catch {
      alert('Unable to analyze this image. Please reload it from a local file.');
    }
  };

  // Run initial key color background removal with debounce to prevent
  // rapid-fire recalculations when sliders are being dragged
  useEffect(() => {
    if (!image) return;
    if (segmentDebounceRef.current) clearTimeout(segmentDebounceRef.current);
    segmentDebounceRef.current = setTimeout(() => {
      handleColorKeySegment();
    }, 150);
    return () => {
      if (segmentDebounceRef.current) clearTimeout(segmentDebounceRef.current);
    };
  }, [settings.colorKey, settings.tolerance, settings.feather, settings.grow, image]);

  // Main Render loop (runs on viewport changes, mask changes, or background replacement config updates)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !mask) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = image.width;
    const h = image.height;
    canvas.width = w;
    canvas.height = h;

    // 1. Draw the desired replacement background first
    if (showMaskOnly) {
      // Just render black-and-white alpha mask
      const maskImgData = ctx.createImageData(w, h);
      const d = maskImgData.data;
      for (let i = 0; i < mask.length; i++) {
        const val = mask[i];
        const idx = i * 4;
        d[idx] = val;
        d[idx+1] = val;
        d[idx+2] = val;
        d[idx+3] = 255;
      }
      ctx.putImageData(maskImgData, 0, 0);
      return;
    }

    ctx.clearRect(0, 0, w, h);

    if (settings.type === 'solid') {
      ctx.fillStyle = settings.solidColor;
      ctx.fillRect(0, 0, w, h);
    } else if (settings.type === 'gradient') {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, settings.gradientStart);
      grad.addColorStop(1, settings.gradientEnd);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    } else if (settings.type === 'blur') {
      // Draw heavily blurred backdrop
      ctx.drawImage(image, 0, 0);
      const blurImgData = ctx.getImageData(0, 0, w, h);
      applyFastBlur(blurImgData, settings.blurRadius * 4); // Boost blur
      ctx.putImageData(blurImgData, 0, 0);
    } else if (settings.type === 'image' && backgroundImage) {
      // Cover the complete frame while preserving the replacement image ratio.
      const scale = Math.max(w / backgroundImage.width, h / backgroundImage.height);
      const drawW = backgroundImage.width * scale;
      const drawH = backgroundImage.height * scale;
      ctx.drawImage(backgroundImage, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
    }

    // 2. Draw Foreground clipped by Mask alpha channel
    // Reuse persistent temp canvas to avoid creating/destroying per render
    if (!tempCanvasRef.current) {
      tempCanvasRef.current = document.createElement('canvas');
    }
    const tempCanvas = tempCanvasRef.current;
    if (tempCanvas.width !== w || tempCanvas.height !== h) {
      tempCanvas.width = w;
      tempCanvas.height = h;
    }
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (tempCtx) {
      tempCtx.drawImage(image, 0, 0);
      const tempImgData = tempCtx.getImageData(0, 0, w, h);
      const data = tempImgData.data;

      // Map mask alpha values directly onto the image's alpha channel
      for (let i = 0; i < mask.length; i++) {
        data[i * 4 + 3] = mask[i];
      }
      tempCtx.putImageData(tempImgData, 0, 0);

      // Compositing: Draw the masked foreground on top of the chosen background
      ctx.drawImage(tempCanvas, 0, 0);
    }
  }, [image, mask, settings, showMaskOnly, backgroundImage]);

  // Coordinate Conversion helper
  const clientToCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  // Interactive Brush Paint on Mask Events
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (settings.brushMode === 'none' || !mask || !image) return;

    setIsDrawing(true);
    const coords = clientToCanvasCoords(e.clientX, e.clientY);
    lastBrushPointRef.current = coords;
    applyBrushAction(coords.x, coords.y);
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || settings.brushMode === 'none' || !mask || !image) return;

    const coords = clientToCanvasCoords(e.clientX, e.clientY);
    applyBrushAction(coords.x, coords.y);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    lastBrushPointRef.current = null;
  };

  const applyBrushAction = (cx: number, cy: number) => {
    if (!image) return;
    const isRestore = settings.brushMode === 'restore';
    const previous = lastBrushPointRef.current;
    const distance = previous ? Math.hypot(cx - previous.x, cy - previous.y) : 0;
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, settings.brushSize / 3)));

    setMask((current) => {
      if (!current) return current;
      const updatedMask = new Uint8ClampedArray(current);
      for (let step = 1; step <= steps; step++) {
        const progress = step / steps;
        const x = previous ? previous.x + (cx - previous.x) * progress : cx;
        const y = previous ? previous.y + (cy - previous.y) * progress : cy;
        paintOnMask(updatedMask, image.width, image.height, x, y, settings.brushSize, settings.brushHardness, isRestore);
      }
      return updatedMask;
    });
    lastBrushPointRef.current = { x: cx, y: cy };
  };

  const handleExportPng = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onMaskComplete(dataUrl);
  };

  const handleResetMask = () => {
    if (!image) return;
    setMask(new Uint8ClampedArray(image.width * image.height).fill(255));
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-gray-950 select-none overflow-hidden" ref={containerRef} id="bg_remover_root">
      {/* Dynamic top toolbars */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <button
          onClick={handleAutoAISegment}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow-xl transition active:scale-95"
        >
          <Sparkles className="w-4 h-4 animate-bounce" /> Smart AI Cut-out
        </button>
        <button
          onClick={() => setShowMaskOnly(!showMaskOnly)}
          className={`p-2 rounded-lg border text-xs flex items-center gap-1.5 font-semibold transition bg-gray-900 ${
            showMaskOnly ? 'border-indigo-500 text-indigo-400' : 'border-gray-800 text-gray-400 hover:text-white'
          }`}
          title="Toggle view black-and-white alpha mask grid"
        >
          {showMaskOnly ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />} Mask Preview
        </button>
        <button
          onClick={handleResetMask}
          className="bg-gray-900 border border-gray-800 text-gray-400 hover:text-white text-xs px-3 py-2 rounded-lg flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Reset Mask
        </button>
      </div>

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
          onClick={handleExportPng}
          className="bg-green-600 hover:bg-green-500 text-white font-semibold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-xl"
        >
          <Check className="w-4 h-4" /> Keep / Export Cut-out
        </button>
      </div>

      {/* Workspace Area */}
      <div
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          className="relative max-w-none origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: image ? image.width : 0,
            height: image ? image.height : 0,
          }}
        >
          {/* Main Rendering Canvas with transparent grid behind it */}
          <div
            className="absolute inset-0 w-full h-full rounded shadow-2xl"
            style={{
              backgroundImage: 'linear-gradient(45deg, #111 25%, transparent 25%), linear-gradient(-45deg, #111 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #111 75%), linear-gradient(-45deg, transparent 75%, #111 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
              backgroundColor: '#1c1c1e'
            }}
          >
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-crosshair rounded" />
          </div>

          {/* Simulated floating circle displaying brush radius */}
          {settings.brushMode !== 'none' && (
            <div className="hidden absolute border border-white/60 bg-white/10 rounded-full pointer-events-none origin-center" />
          )}
        </div>
      </div>
    </div>
  );
}
