/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useCallback, MouseEvent, WheelEvent, TouchEvent } from 'react';
import { EditorAdjustments, ImageMetadata } from '../types';
import { applyAdjustmentsToImageData, calculateHistogram, clamp, HistogramData } from '../utils/imageProcessing';
import { Maximize2, RotateCcw, ZoomIn, ZoomOut, Grid, Move, PenTool, Type, Eye, Layers } from 'lucide-react';
import ImageWorker from '../utils/imageWorker?worker';

interface Annotation {
  id: string;
  type: 'text' | 'rect' | 'circle' | 'arrow' | 'line';
  // Stored in preview-canvas coordinates, then scaled at export. This keeps
  // annotations locked to the visible composition at every preview size.
  x: number;
  y: number; // Image coords (0 to originalHeight)
  w: number;
  h: number;
  color: string;
  thickness: number;
  text?: string;
}

interface EditorCanvasProps {
  imageSrc: string; // original image URL
  adjustments: EditorAdjustments;
  metadata: ImageMetadata;
  onProcessedImageChange?: (dataUrl: string) => void;
  onHistogramChange?: (histogramData: HistogramData) => void;
  activeTool: 'pan' | 'measure' | 'text' | 'rect' | 'circle' | 'arrow' | 'line' | 'none';
  strokeColor: string;
  strokeWidth: number;
}

export default function EditorCanvas({
  imageSrc,
  adjustments,
  metadata,
  onProcessedImageChange,
  onHistogramChange,
  activeTool,
  strokeColor,
  strokeWidth
}: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Source Image element
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  // Zoom / Pan View State (Viewport)
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Grid / Guides Toggles
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [gridSize, setGridSize] = useState<number>(50); // pixels
  const [showThirds, setShowThirds] = useState<boolean>(false);

  // Active annotations (text/shapes) list
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  
  // Create / Drag shape state
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [tempDraw, setTempDraw] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Measurement Ruler tool state
  const [rulerStart, setRulerStart] = useState<{ x: number; y: number } | null>(null);
  const [rulerEnd, setRulerEnd] = useState<{ x: number; y: number } | null>(null);
  const [rulerMetric, setRulerMetric] = useState<{ distance: number; angle: number } | null>(null);

  // Touch Zoom variables
  const [touchStartDist, setTouchStartDist] = useState<number | null>(null);

  // ===== PERFORMANCE: Persistent offscreen canvases instead of creating new ones =====
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const processedLayerRef = useRef<HTMLCanvasElement | null>(null);
  const highResCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hrSourceRef = useRef<HTMLCanvasElement | null>(null);

  const renderVersionRef = useRef(0);
  const highResTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef<number>(0);

  // ===== PERFORMANCE: Web Worker for off-thread processing =====
  const workerRef = useRef<Worker | null>(null);
  const workerIdRef = useRef(0);

  // Refs for tracking container dimensions to prevent layout loops & thrashing
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const containerRectRef = useRef<DOMRect | null>(null);

  // Initialize worker
  useEffect(() => {
    try {
      workerRef.current = new ImageWorker();
    } catch {
      // Worker may not be supported (e.g., in some SSR environments)
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const isQuarterTurn = image ? Math.abs(adjustments.rotate % 180) === 90 : false;
  const renderWidth = image ? (isQuarterTurn ? image.height : image.width) : 0;
  const renderHeight = image ? (isQuarterTurn ? image.width : image.height) : 0;

  /**
   * Get or create a persistent offscreen canvas, resizing only when needed.
   * This eliminates the massive GC pressure from creating a new canvas every frame.
   */
  const getOrCreateCanvas = (
    ref: React.MutableRefObject<HTMLCanvasElement | null>,
    w: number,
    h: number
  ): HTMLCanvasElement => {
    let canvas = ref.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      ref.current = canvas;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return canvas;
  };

  // Load original image
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
      previewCanvasRef.current = null;
      
      // Create offscreen downscaled preview canvas (capped at max 1000px on desktop, 600px on mobile)
      const pCanvas = document.createElement('canvas');
      const maxDim = window.innerWidth < 768 ? 600 : 1000;
      let pW = img.width;
      let pH = img.height;
      if (pW > maxDim || pH > maxDim) {
        if (pW > pH) {
          pH = Math.round((pH * maxDim) / pW);
          pW = maxDim;
        } else {
          pW = Math.round((pW * maxDim) / pH);
          pH = maxDim;
        }
      }
      pCanvas.width = pW;
      pCanvas.height = pH;
      // willReadFrequently: true tells the browser to keep this canvas in CPU memory
      // for fast getImageData() calls instead of keeping it on the GPU
      const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });
      if (pCtx) {
        pCtx.drawImage(img, 0, 0, pW, pH);
        previewCanvasRef.current = pCanvas;
      }
    };
    img.src = imageSrc;

    // Cleanup: free persistent canvases when image source changes
    return () => {
      if (processedLayerRef.current) {
        processedLayerRef.current.width = 0;
        processedLayerRef.current.height = 0;
      }
      if (highResCanvasRef.current) {
        highResCanvasRef.current.width = 0;
        highResCanvasRef.current.height = 0;
      }
      if (hrSourceRef.current) {
        hrSourceRef.current.width = 0;
        hrSourceRef.current.height = 0;
      }
    };
  }, [imageSrc]);

  // Responsive scale handler using ResizeObserver
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

      const scale = Math.min((width - 40) / image.width, (height - 40) / image.height, 1);
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

      const isQuarterTurn = Math.abs(adjustments.rotate % 180) === 90;
      const renderWidth = isQuarterTurn ? image.height : image.width;
      const renderHeight = isQuarterTurn ? image.width : image.height;
      const scale = Math.min((w - 40) / renderWidth, (h - 40) / renderHeight, 1);
      setZoom(scale);
      setPan({
        x: (w - renderWidth * scale) / 2,
        y: (h - renderHeight * scale) / 2
      });
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [image, adjustments.rotate]);

  /**
   * Render the preview canvas on the main thread using requestAnimationFrame.
   * Only the small preview canvas is processed synchronously. The full-res
   * export is deferred and debounced.
   */
  const renderPreview = useCallback((
    img: HTMLImageElement,
    adj: EditorAdjustments,
    anns: Annotation[]
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Use preview canvas for instant real-time onscreen performance
    const sourceCanvas = previewCanvasRef.current || img;
    const sourceW = sourceCanvas.width;
    const sourceH = sourceCanvas.height;
    const isQuarterTurn = Math.abs(adj.rotate % 180) === 90;
    const w = isQuarterTurn ? sourceH : sourceW;
    const h = isQuarterTurn ? sourceW : sourceH;
    canvas.width = w;
    canvas.height = h;

    // Reuse persistent offscreen canvas instead of creating new one
    const processedLayer = getOrCreateCanvas(processedLayerRef, sourceW, sourceH);
    const processedCtx = processedLayer.getContext('2d', { willReadFrequently: true });
    if (!processedCtx) return;

    try {
      processedCtx.drawImage(sourceCanvas, 0, 0, sourceW, sourceH);
      const imgData = processedCtx.getImageData(0, 0, sourceW, sourceH);
      applyAdjustmentsToImageData(imgData, adj);
      processedCtx.putImageData(imgData, 0, 0);

      if (onHistogramChange) {
        onHistogramChange(calculateHistogram(imgData));
      }

      // Transform to the correctly-sized output canvas
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      if (adj.flipH) ctx.scale(-1, 1);
      if (adj.flipV) ctx.scale(1, -1);
      if (adj.rotate !== 0) ctx.rotate((adj.rotate * Math.PI) / 180);
      ctx.drawImage(processedLayer, -sourceW / 2, -sourceH / 2);
      ctx.restore();

      // Annotations are composition overlays
      drawAnnotations(ctx, w, h, anns);
    } catch (e) {
      console.error('Onscreen canvas processing error:', e);
    }
  }, []);

  /**
   * Generate the high-resolution output for export. This runs in a Web Worker
   * when available, or falls back to main-thread processing with a longer debounce.
   */
  const renderHighRes = useCallback((
    img: HTMLImageElement,
    adj: EditorAdjustments,
    anns: Annotation[],
    version: number,
    callback?: (dataUrl: string) => void
  ) => {
    if (!callback) return;

    const doHighRes = (processedImgData: ImageData) => {
      // Check if this render is still current
      if (version !== renderVersionRef.current) return;

      try {
        const highResQuarterTurn = Math.abs(adj.rotate % 180) === 90;
        const hrW = highResQuarterTurn ? img.height : img.width;
        const hrH = highResQuarterTurn ? img.width : img.height;

        // Reuse persistent canvases
        const hrSource = getOrCreateCanvas(hrSourceRef, img.width, img.height);
        const hrSourceCtx = hrSource.getContext('2d', { willReadFrequently: true });
        if (!hrSourceCtx) return;
        hrSourceCtx.putImageData(processedImgData, 0, 0);

        const highResCanvas = getOrCreateCanvas(highResCanvasRef, hrW, hrH);
        const hrCtx = highResCanvas.getContext('2d');
        if (!hrCtx) return;

        hrCtx.clearRect(0, 0, hrW, hrH);
        hrCtx.save();
        hrCtx.translate(hrW / 2, hrH / 2);
        if (adj.flipH) hrCtx.scale(-1, 1);
        if (adj.flipV) hrCtx.scale(1, -1);
        if (adj.rotate !== 0) hrCtx.rotate((adj.rotate * Math.PI) / 180);
        hrCtx.drawImage(hrSource, -img.width / 2, -img.height / 2);
        hrCtx.restore();

        // Draw committed annotations onto high-res canvas
        drawAnnotations(hrCtx, hrW, hrH, anns);

        // Determine format
        let hasTransparency = false;
        const hrData = processedImgData.data;
        for (let i = 3; i < hrData.length; i += 4) {
          if (hrData[i] !== 255) {
            hasTransparency = true;
            break;
          }
        }
        const mimeType = hasTransparency ? 'image/png' : 'image/jpeg';
        highResCanvas.toBlob((blob) => {
          if (!blob || version !== renderVersionRef.current) return;
          callback(URL.createObjectURL(blob));
        }, mimeType, mimeType === 'image/jpeg' ? 0.94 : undefined);
      } catch (hrErr) {
        console.error('High-resolution processing error:', hrErr);
      }
    };

    // Draw original into a temporary context to get ImageData
    const hrSource = getOrCreateCanvas(hrSourceRef, img.width, img.height);
    const hrSourceCtx = hrSource.getContext('2d', { willReadFrequently: true });
    if (!hrSourceCtx) return;
    hrSourceCtx.drawImage(img, 0, 0);
    const hrImgData = hrSourceCtx.getImageData(0, 0, img.width, img.height);

    // Try to use Web Worker for off-thread processing
    const worker = workerRef.current;
    if (worker) {
      const workerId = ++workerIdRef.current;
      const handler = (e: MessageEvent) => {
        if (e.data.id !== workerId) return;
        worker.removeEventListener('message', handler);
        if (version !== renderVersionRef.current) return;
        doHighRes(e.data.imageData);
      };
      worker.addEventListener('message', handler);
      worker.postMessage(
        { id: workerId, imageData: hrImgData, adjustments: adj },
        [hrImgData.data.buffer]
      );
    } else {
      // Fallback: main-thread processing
      applyAdjustmentsToImageData(hrImgData, adj);
      doHighRes(hrImgData);
    }
  }, []);

  // Main Image Rendering & Adjustment Pipeline
  useEffect(() => {
    if (!image || !canvasRef.current) return;
    const renderVersion = ++renderVersionRef.current;

    // Cancel any pending high-res render
    if (highResTimerRef.current) {
      clearTimeout(highResTimerRef.current);
      highResTimerRef.current = null;
    }
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }

    // Use requestAnimationFrame for the preview render to avoid layout thrashing
    rafIdRef.current = requestAnimationFrame(() => {
      renderPreview(image, adjustments, annotations);

      // Debounced high-resolution output (only after user stops adjusting for 800ms)
      highResTimerRef.current = setTimeout(() => {
        if (renderVersion !== renderVersionRef.current) return;
        renderHighRes(image, adjustments, annotations, renderVersion, onProcessedImageChange);
      }, 800);
    });

    return () => {
      if (highResTimerRef.current) {
        clearTimeout(highResTimerRef.current);
        highResTimerRef.current = null;
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [image, adjustments, annotations, renderPreview, renderHighRes, onProcessedImageChange]);

  // Draws all custom vector annotations onto the canvas context
  const drawAnnotations = (ctx: CanvasRenderingContext2D, targetW: number, targetH: number, anns: Annotation[]) => {
    ctx.save();
    const previewCanvas = canvasRef.current;
    if (previewCanvas && (targetW !== previewCanvas.width || targetH !== previewCanvas.height)) {
      ctx.scale(targetW / previewCanvas.width, targetH / previewCanvas.height);
    }

    anns.forEach((ann) => {
      ctx.strokeStyle = ann.color;
      ctx.fillStyle = ann.color;
      ctx.lineWidth = ann.thickness;
      ctx.font = `${ann.thickness * 4 + 14}px sans-serif`;

      switch (ann.type) {
        case 'rect':
          ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
          break;
        case 'circle':
          ctx.beginPath();
          const r = Math.sqrt(ann.w * ann.w + ann.h * ann.h) / 2;
          ctx.arc(ann.x + ann.w / 2, ann.y + ann.h / 2, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'line':
          ctx.beginPath();
          ctx.moveTo(ann.x, ann.y);
          ctx.lineTo(ann.x + ann.w, ann.y + ann.h);
          ctx.stroke();
          break;
        case 'arrow':
          drawArrow(ctx, ann.x, ann.y, ann.x + ann.w, ann.y + ann.h, ann.thickness);
          break;
        case 'text':
          ctx.fillText(ann.text || 'ImageForge Text', ann.x, ann.y + ann.h);
          break;
      }
    });

    // Draw active drawing annotation temp outline
    if (tempDraw && activeTool !== 'none' && activeTool !== 'pan' && activeTool !== 'measure') {
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.setLineDash([4, 4]);

      if (activeTool === 'rect') {
        ctx.strokeRect(tempDraw.x, tempDraw.y, tempDraw.w, tempDraw.h);
      } else if (activeTool === 'circle') {
        ctx.beginPath();
        const r = Math.sqrt(tempDraw.w * tempDraw.w + tempDraw.h * tempDraw.h) / 2;
        ctx.arc(tempDraw.x + tempDraw.w / 2, tempDraw.y + tempDraw.h / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (activeTool === 'line') {
        ctx.beginPath();
        ctx.moveTo(tempDraw.x, tempDraw.y);
        ctx.lineTo(tempDraw.x + tempDraw.w, tempDraw.y + tempDraw.h);
        ctx.stroke();
      } else if (activeTool === 'arrow') {
        drawArrow(ctx, tempDraw.x, tempDraw.y, tempDraw.x + tempDraw.w, tempDraw.y + tempDraw.h, strokeWidth);
      }

      ctx.setLineDash([]);
    }

    ctx.restore();
  };

  const drawArrow = (ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, thickness: number) => {
    const headLength = thickness * 3 + 10; // length of head in pixels
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = Math.atan2(dy, dx);
    
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  };

  // Convert client viewport coordinates to Canvas coordinates
  const clientToCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    // Map based on the visible DOM canvas boundary, returning exact pixel location on the high-res image
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  // Pan and Zoom viewport events
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'pan' || e.button === 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    } else if (activeTool === 'measure') {
      const imgCoords = clientToCanvasCoords(e.clientX, e.clientY);
      setRulerStart(imgCoords);
      setRulerEnd(imgCoords);
    } else if (activeTool !== 'none') {
      // Drawing/adding annotations
      setIsDrawing(true);
      const imgCoords = clientToCanvasCoords(e.clientX, e.clientY);
      setDrawStart(imgCoords);
      setTempDraw({ x: imgCoords.x, y: imgCoords.y, w: 0, h: 0 });
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (activeTool === 'measure' && rulerStart) {
      const imgCoords = clientToCanvasCoords(e.clientX, e.clientY);
      setRulerEnd(imgCoords);

      // Calc metrics
      const dx = imgCoords.x - rulerStart.x;
      const dy = imgCoords.y - rulerStart.y;
      const distance = Math.round(Math.sqrt(dx * dx + dy * dy));
      let angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      if (angle < 0) angle += 360;

      setRulerMetric({ distance, angle });
    } else if (isDrawing && drawStart) {
      const imgCoords = clientToCanvasCoords(e.clientX, e.clientY);
      setTempDraw({ x: drawStart.x, y: drawStart.y, w: imgCoords.x - drawStart.x, h: imgCoords.y - drawStart.y });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);

    if (activeTool === 'measure') {
      // Ruler stays till we click somewhere else or swap tools
    } else if (isDrawing && tempDraw && drawStart) {
      setIsDrawing(false);
      
      if (activeTool === 'text') {
        const textVal = prompt('Enter annotation text:', 'Text Label');
        if (textVal) {
          const newAnn: Annotation = {
            id: Math.random().toString(36).substring(7),
            type: 'text',
            x: tempDraw.x,
            y: tempDraw.y,
            w: 120,
            h: 20,
            color: strokeColor,
            thickness: strokeWidth,
            text: textVal
          };
          setAnnotations((current) => [...current, newAnn]);
        }
      } else if (Math.abs(tempDraw.w) > 5 || Math.abs(tempDraw.h) > 5) {
        const newAnn: Annotation = {
          id: Math.random().toString(36).substring(7),
          type: activeTool as any,
          x: tempDraw.x,
          y: tempDraw.y,
          w: tempDraw.w,
          h: tempDraw.h,
          color: strokeColor,
          thickness: strokeWidth
        };
        setAnnotations((current) => [...current, newAnn]);
      }
      setTempDraw(null);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 1.1;
      const nextZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
      const clampedZoom = Math.max(0.05, Math.min(25, nextZoom));

      let rect = containerRectRef.current;
      if (!rect) {
        rect = container.getBoundingClientRect();
        containerRectRef.current = rect;
      }

      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      setPan(prevPan => ({
        x: cursorX - (cursorX - prevPan.x) * (clampedZoom / zoom),
        y: cursorY - (cursorY - prevPan.y) * (clampedZoom / zoom)
      }));
      setZoom(clampedZoom);
    };

    // Add non-passive event listener to allow e.preventDefault()
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [zoom]); // Dependency on zoom since we use it in calculation

  // Touch handlers for mobile gesture zooming & panning
  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      // Setup pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      setTouchStartDist(Math.sqrt(dx * dx + dy * dy));
    } else if (e.touches.length === 1 && activeTool === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y });
    }
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && touchStartDist !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nextZoom = zoom * (dist / touchStartDist);
      setZoom(Math.max(0.1, Math.min(20, nextZoom)));
      setTouchStartDist(dist);
    } else if (isPanning && e.touches.length === 1) {
      setPan({
        x: e.touches[0].clientX - panStart.x,
        y: e.touches[0].clientY - panStart.y
      });
    }
  };

  const handleTouchEnd = () => {
    setIsPanning(false);
    setTouchStartDist(null);
  };

  const resetView = () => {
    if (!image || !containerRef.current) return;
    const cWidth = containerRef.current.clientWidth;
    const cHeight = containerRef.current.clientHeight;
    const isQuarterTurn = Math.abs(adjustments.rotate % 180) === 90;
    const renderWidth = isQuarterTurn ? image.height : image.width;
    const renderHeight = isQuarterTurn ? image.width : image.height;
    const scale = Math.min((cWidth - 40) / renderWidth, (cHeight - 40) / renderHeight, 1);
    setZoom(scale);
    setPan({
      x: (cWidth - renderWidth * scale) / 2,
      y: (cHeight - renderHeight * scale) / 2
    });
    setRulerMetric(null);
    setRulerStart(null);
    setRulerEnd(null);
  };

  const clearAnnotations = () => {
    setAnnotations([]);
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-gray-950 select-none overflow-hidden" id="editor_canvas_root">
      {/* Viewport controls top-bar */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-gray-900/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-gray-800 text-xs text-gray-300 shadow-xl">
        <button onClick={() => setZoom(Math.max(0.05, zoom - 0.1))} className="p-1 hover:text-white transition">
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="font-mono w-14 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(Math.min(25, zoom + 0.1))} className="p-1 hover:text-white transition">
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="h-4 w-[1px] bg-gray-800" />
        <button onClick={resetView} className="p-1 hover:text-white transition" title="Fit to screen">
          <Maximize2 className="w-4 h-4" />
        </button>
        <div className="h-4 w-[1px] bg-gray-800" />
        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`p-1 transition ${showGrid ? 'text-indigo-400' : 'hover:text-white'}`}
          title="Toggle Grid"
        >
          <Grid className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowThirds(!showThirds)}
          className={`p-1 transition text-xs font-semibold ${showThirds ? 'text-indigo-400' : 'hover:text-white'}`}
          title="Toggle Rule of Thirds"
        >
          3x3
        </button>
        {annotations.length > 0 && (
          <>
            <div className="h-4 w-[1px] bg-gray-800" />
            <button onClick={clearAnnotations} className="text-red-400 hover:text-red-300 text-[10px] uppercase font-mono tracking-wider font-semibold">
              Clear Notes
            </button>
          </>
        )}
      </div>

      {/* Measurement Metrics Display Overlay */}
      {rulerMetric && rulerStart && rulerEnd && (
        <div className="absolute top-4 right-4 z-10 bg-indigo-950/90 backdrop-blur border border-indigo-800 px-3 py-2 rounded-lg shadow-xl text-left">
          <div className="text-[10px] text-indigo-400 font-mono uppercase tracking-wider font-semibold">Ruler Measurement</div>
          <div className="flex gap-4 mt-1 font-mono text-white text-xs">
            <div>Length: <span className="text-indigo-300 font-bold">{rulerMetric.distance} px</span></div>
            <div>Angle: <span className="text-indigo-300 font-bold">{rulerMetric.angle}°</span></div>
          </div>
        </div>
      )}

      {/* Main Canvas Container */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`relative w-full h-full flex-grow flex items-center justify-center cursor-default overflow-hidden ${
          activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        {/* Render Grid & Grid Guidelines underneath if checked */}
        <div
          className="absolute left-0 top-0 origin-top-left pointer-events-none select-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: renderWidth,
            height: renderHeight,
          }}
        >
          {/* Rule of Thirds overlay lines */}
          {showThirds && image && (
            <div className="absolute inset-0 w-full h-full grid grid-cols-3 grid-rows-3 border border-indigo-500/20">
              <div className="border-r border-b border-indigo-500/30" />
              <div className="border-r border-b border-indigo-500/30" />
              <div className="border-b border-indigo-500/30" />
              <div className="border-r border-b border-indigo-500/30" />
              <div className="border-r border-b border-indigo-500/30" />
              <div className="border-b border-indigo-500/30" />
            </div>
          )}

          {/* Grid lines overlay */}
          {showGrid && image && (
            <div
              className="absolute inset-0 w-full h-full"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)',
                backgroundSize: `${gridSize}px ${gridSize}px`
              }}
            />
          )}

          {/* Measurement ruler drawing path overlay */}
          {activeTool === 'measure' && rulerStart && rulerEnd && (
            <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none z-10">
              <line
                x1={rulerStart.x}
                y1={rulerStart.y}
                x2={rulerEnd.x}
                y2={rulerEnd.y}
                stroke="#6366f1"
                strokeWidth={3 / zoom}
              />
              <circle cx={rulerStart.x} cy={rulerStart.y} r={6 / zoom} fill="#6366f1" stroke="#fff" strokeWidth={1 / zoom} />
              <circle cx={rulerEnd.x} cy={rulerEnd.y} r={6 / zoom} fill="#6366f1" stroke="#fff" strokeWidth={1 / zoom} />
            </svg>
          )}
        </div>

        {/* High Precision Output Canvas — GPU-accelerated via will-change and translateZ */}
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 shadow-2xl max-w-none origin-top-left select-none pointer-events-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        />

        {/* Empty placeholder */}
        {!imageSrc && (
          <div className="flex flex-col items-center gap-2 text-gray-500 font-mono text-xs">
            <Layers className="w-10 h-10 animate-pulse text-indigo-500/40" />
            <span>Load an image to initialize workspace</span>
          </div>
        )}
      </div>
    </div>
  );
}
