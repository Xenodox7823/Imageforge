/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  AppMode,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_BG_REMOVAL_SETTINGS,
  DEFAULT_COMPRESSION_SETTINGS,
  EditorAdjustments,
  BackgroundRemovalSettings,
  CompressionSettings,
  PassportPreset,
  PASSPORT_PRESETS,
  ImageMetadata
} from './types';
import EditorCanvas from './components/EditorCanvas';
import CurvesWidget from './components/CurvesWidget';
import Histogram from './components/Histogram';
import { compressImage, CompressionResult } from './utils/compression';
import { HistogramData } from './utils/imageProcessing';
import {
  SlidersHorizontal,
  Crop as CropIcon,
  Eraser,
  Contact,
  Layers,
  FolderOpen,
  Camera,
  Clipboard,
  ArrowRight,
  Download,
  Share2,
  Trash2,
  ChevronRight,
  RotateCcw,
  Sparkles,
  RefreshCw,
  Sliders,
  Type,
  Square,
  Compass,
  Palette,
  FileDown,
  Settings,
  CheckCircle,
  HelpCircle,
  ChevronLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const createDefaultAdjustments = (): EditorAdjustments => ({
  ...DEFAULT_ADJUSTMENTS,
  curvesPoints: DEFAULT_ADJUSTMENTS.curvesPoints.map((point) => ({ ...point }))
});

const createDefaultBackgroundSettings = (): BackgroundRemovalSettings => ({ ...DEFAULT_BG_REMOVAL_SETTINGS });
const createDefaultCompressionSettings = (): CompressionSettings => ({ ...DEFAULT_COMPRESSION_SETTINGS });
const CropCanvas = lazy(() => import('./components/CropCanvas'));
const BackgroundRemoverCanvas = lazy(() => import('./components/BackgroundRemoverCanvas'));
const PassportCanvas = lazy(() => import('./components/PassportCanvas'));
const BatchProcessor = lazy(() => import('./components/BatchProcessor'));

const WorkspaceLoader = () => (
  <div className="w-full h-full flex items-center justify-center bg-gray-950 text-xs font-mono text-indigo-400">
    Preparing workspace…
  </div>
);

export default function App() {
  const [mode, setMode] = useState<AppMode>('home');

  // Core Image State
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('untitled');
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);

  // Active adjustments/settings state
  const [adjustments, setAdjustments] = useState<EditorAdjustments>(createDefaultAdjustments);
  const [cropSettings, setCropSettings] = useState({
    aspectRatio: null as number | null,
    aspectName: 'Free',
    shape: 'rect' as 'rect' | 'circle' | 'oval',
    customWidth: 1000,
    customHeight: 1000
  });
  const [bgRemovalSettings, setBgRemovalSettings] = useState<BackgroundRemovalSettings>(createDefaultBackgroundSettings);
  const [passportPreset, setPassportPreset] = useState<PassportPreset>(PASSPORT_PRESETS[0]);
  const [compressionSettings, setCompressionSettings] = useState<CompressionSettings>(createDefaultCompressionSettings);

  // Processed Output state
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  // Lightweight precomputed histogram from preview canvas (4 KB instead of 192 MB raw ImageData)
  const [histogramData, setHistogramData] = useState<HistogramData | null>(null);

  // Undo/Redo Stacks
  const [undoStack, setUndoStack] = useState<EditorAdjustments[]>([]);
  const [redoStack, setRedoStack] = useState<EditorAdjustments[]>([]);

  // Active annotation tool selected in the Editor
  const [editorTool, setEditorTool] = useState<'pan' | 'measure' | 'text' | 'rect' | 'circle' | 'arrow' | 'line' | 'none'>('pan');
  const [strokeColor, setStrokeColor] = useState<string>('#6366f1');
  const [strokeWidth, setStrokeWidth] = useState<number>(4);

  // UI state overlays
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportResult, setExportResult] = useState<CompressionResult | null>(null);
  const [recentExports, setRecentExports] = useState<{ name: string; originalSize: number; finalSize: number; format: string; date: string }[]>([]);

  // Standalone Real-time Compression States & Effects
  const [realTimeCompressResult, setRealTimeCompressResult] = useState<CompressionResult | null>(null);
  const [isCompilingRealTime, setIsCompilingRealTime] = useState<boolean>(false);
  const [compressedPreviewUrl, setCompressedPreviewUrl] = useState<string | null>(null);
  const compressionRunRef = useRef(0);

  useEffect(() => {
    const src = processedUrl || imageSrc;
    if (!src || mode !== 'compress') return;

    const runRealTimeCompress = async () => {
      const runId = ++compressionRunRef.current;
      setIsCompilingRealTime(true);
      try {
        const img = new Image();
        const loadPromise = new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Could not load image for compression.'));
        });
        img.src = src;
        await loadPromise;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        // willReadFrequently: canvas is used for getImageData in compressImage
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (tempCtx) {
          tempCtx.drawImage(img, 0, 0);
        }

        const res = await compressImage(
          tempCanvas,
          compressionSettings.format,
          compressionSettings.targetSizeKb,
          compressionSettings.quality,
          compressionSettings.preserveMetadata
        );
        // Free temp canvas GPU memory after compression
        tempCanvas.width = 0;
        tempCanvas.height = 0;
        if (runId === compressionRunRef.current) setRealTimeCompressResult(res);
      } catch (err) {
        if (runId === compressionRunRef.current) console.error('Real-time compression error:', err);
      } finally {
        if (runId === compressionRunRef.current) setIsCompilingRealTime(false);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      runRealTimeCompress();
    }, 250);

    return () => clearTimeout(delayDebounceFn);
  }, [compressionSettings, processedUrl, imageSrc, mode]);

  useEffect(() => {
    if (!realTimeCompressResult) {
      setCompressedPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(realTimeCompressResult.blob);
    setCompressedPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [realTimeCompressResult]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const processedObjectUrlRef = useRef<string | null>(null);

  // Camera capture states
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Watch for keyboard undo/redo shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (mode !== 'editor') return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, undoStack, redoStack, adjustments]);

  const revokeWorkingObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const clearProcessedOutput = () => {
    if (processedObjectUrlRef.current) {
      URL.revokeObjectURL(processedObjectUrlRef.current);
      processedObjectUrlRef.current = null;
    }
    setProcessedUrl(null);
    setHistogramData(null);
  };

  const setProcessedOutput = useCallback((url: string) => {
    // Revoke PREVIOUS URL before storing the new one to prevent leaks
    const previous = processedObjectUrlRef.current;
    if (previous) URL.revokeObjectURL(previous);
    processedObjectUrlRef.current = url;
    setProcessedUrl(url);
  }, []);

  useEffect(() => () => {
    revokeWorkingObjectUrl();
    if (processedObjectUrlRef.current) URL.revokeObjectURL(processedObjectUrlRef.current);
  }, []);

  const resetEditState = () => {
    setAdjustments(createDefaultAdjustments());
    setBgRemovalSettings(createDefaultBackgroundSettings());
    clearProcessedOutput();
    setUndoStack([]);
    setRedoStack([]);
  };

  const commitDerivedImage = (dataUrl: string) => {
    revokeWorkingObjectUrl();
    resetEditState();
    setImageSrc(dataUrl);
    const img = new Image();
    img.onload = () => {
      setMetadata((current) => current && {
        ...current,
        size: Math.round((dataUrl.length * 3) / 4),
        type: 'image/png',
        width: img.naturalWidth,
        height: img.naturalHeight,
        lastModified: Date.now()
      });
    };
    img.src = dataUrl;
    setMode('editor');
  };

  // Handle image loading
  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please choose a supported image file.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      alert('Images larger than 100 MB are not supported in this browser workspace.');
      return;
    }
    revokeWorkingObjectUrl();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setImageSrc(url);
    setImageName(file.name);
    
    // Parse metadata
    const img = new Image();
    img.onload = () => {
      const meta: ImageMetadata = {
        name: file.name,
        size: file.size,
        type: file.type,
        width: img.width,
        height: img.height,
        lastModified: file.lastModified
      };
      setMetadata(meta);
    };
    img.onerror = () => alert('This image could not be decoded. Try exporting it as PNG, JPEG, or WebP first.');
    img.src = url;

    // Reset editor parameters to default
    resetEditState();

    setMode('editor'); // Auto-navigate to editor
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleImageFile(e.target.files[0]);
    }
    e.target.value = '';
  };

  // Clipboard Paste Support
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) {
              handleImageFile(file);
              break;
            }
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Web camera triggers
  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      cameraStreamRef.current = stream;
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      alert('Could not open camera. Please make sure camera permissions are enabled.');
      setShowCamera(false);
    }
  };

  const captureCameraPhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera_capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
          handleImageFile(file);
          stopCamera();
        }
      }, 'image/jpeg');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    cameraStreamRef.current = null;
    setCameraStream(null);
    setShowCamera(false);
  };

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  // Record a history checkpoint point before making changes
  const recordHistory = () => {
    setUndoStack((prev) => {
      const last = prev[prev.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(adjustments)) return prev;
      return [...prev.slice(-49), adjustments];
    });
    setRedoStack([]); // Clear redo
  };

  // State adjustment with zero-lag smooth feedback for continuous sliders
  const updateAdjustments = (newAdj: EditorAdjustments) => {
    setAdjustments(newAdj);
  };

  // Apply discrete adjustments that immediately create a history state
  const applyDiscreteAdjustment = (newAdj: EditorAdjustments) => {
    recordHistory();
    setAdjustments(newAdj);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((prevStack) => prevStack.slice(0, -1));
    setRedoStack((prevStack) => [...prevStack, adjustments]);
    setAdjustments(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prevStack) => prevStack.slice(0, -1));
    setUndoStack((prevStack) => [...prevStack, adjustments]);
    setAdjustments(next);
  };

  // Perform binary search or high precision file compression
  const executeFinalExport = async () => {
    const source = processedUrl || imageSrc;
    if (!source || !metadata) return;

    setIsExporting(true);
    try {
      const sourceImg = new Image();
      const loadPromise = new Promise<void>((resolve, reject) => {
        sourceImg.onload = () => resolve();
        sourceImg.onerror = () => reject(new Error('Could not prepare image for export.'));
      });
      sourceImg.src = source;
      await loadPromise;

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = sourceImg.width;
      exportCanvas.height = sourceImg.height;
      const ctx = exportCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(sourceImg, 0, 0);
      }

      // Execute Compression Engine
      const res = await compressImage(
        exportCanvas,
        compressionSettings.format,
        compressionSettings.targetSizeKb,
        compressionSettings.quality,
        compressionSettings.preserveMetadata
      );

      setExportResult(res);

      // Save in export list history
      const savedItem = {
        name: imageName.substring(0, imageName.lastIndexOf('.')) || imageName,
        originalSize: metadata.size,
        finalSize: res.blob.size,
        format: res.format.toUpperCase(),
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setRecentExports((prev) => [savedItem, ...prev.slice(0, 4)]);
    } catch (e) {
      alert('Export compression failed.');
    } finally {
      setIsExporting(false);
    }
  };

  // Download Blob trigger helper
  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Direct export deliberately performs no re-encoding or compression. The
  // compression workspace owns optimized output as a separate workflow.
  const exportCurrentImage = async () => {
    const source = processedUrl || imageSrc;
    if (!source) return;
    try {
      setIsExporting(true);
      const blob = await fetch(source).then((response) => {
        if (!response.ok) throw new Error('Export source is unavailable.');
        return response.blob();
      });
      const cleanName = imageName.substring(0, imageName.lastIndexOf('.')) || imageName;
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : blob.type === 'image/avif' ? 'avif' : 'jpg';
      downloadBlob(blob, `imageforge_${cleanName}.${ext}`);
    } catch {
      alert('Could not export the current image. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const triggerExportDownload = () => {
    if (!exportResult) return;
    const cleanName = imageName.substring(0, imageName.lastIndexOf('.')) || imageName;
    const ext = exportResult.format === 'png' ? 'png' : exportResult.format === 'jpeg' ? 'jpg' : exportResult.format;
    downloadBlob(exportResult.blob, `imageforge_${cleanName}.${ext}`);
    setShowExportModal(false);
    setExportResult(null);
  };

  const handleShare = async () => {
    if (!exportResult) return;
    try {
      const file = new File([exportResult.blob], `imageforge_export.${compressionSettings.format}`, { type: exportResult.blob.type });
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'ImageForge Pro Export',
          text: 'Shared from ImageForge Pro.'
        });
      } else {
        alert('Sharing is not supported on this device/browser.');
      }
    } catch {
      // Ignored
    }
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 font-sans select-none overflow-hidden" id="app_frame">
      {/* 0. Far Left Vertical Navigation Aside (Sleek Interface Theme) */}
      <aside className="hidden sm:flex w-[72px] bg-gray-900 border-r border-gray-800 flex-col items-center py-5 shrink-0 z-20 justify-between" id="sleek_sidebar">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 rounded-xl overflow-hidden cursor-pointer hover:scale-105 active:scale-95 transition" onClick={() => setMode('home')}>
            <img src="/assets/logo/logo.jpg" alt="Logo" className="w-full h-full object-cover" />
          </div>
          
          <div className="flex flex-col gap-6 mt-10">
            <button
              onClick={() => setMode('home')}
              className={`p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center ${
                mode === 'home' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 shadow-md' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="Home Dashboard"
            >
              <Sparkles className="w-5 h-5" />
            </button>
            
            <button
              onClick={() => {
                if (imageSrc) setMode('editor');
                else fileInputRef.current?.click();
              }}
              className={`p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center ${
                mode === 'editor' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 shadow-md' : 'text-gray-500 hover:text-gray-300'
              } ${!imageSrc ? 'opacity-30' : ''}`}
              title="Tone & Color Tweak"
            >
              <SlidersHorizontal className="w-5 h-5" />
            </button>

            <button
              onClick={() => {
                if (imageSrc) setMode('crop');
                else fileInputRef.current?.click();
              }}
              className={`p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center ${
                mode === 'crop' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 shadow-md' : 'text-gray-500 hover:text-gray-300'
              } ${!imageSrc ? 'opacity-30' : ''}`}
              title="Precision Cropping"
            >
              <CropIcon className="w-5 h-5" />
            </button>

            <button
              onClick={() => {
                if (imageSrc) setMode('bg-remover');
                else fileInputRef.current?.click();
              }}
              className={`p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center ${
                mode === 'bg-remover' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 shadow-md' : 'text-gray-500 hover:text-gray-300'
              } ${!imageSrc ? 'opacity-30' : ''}`}
              title="Remove Backdrop"
            >
              <Eraser className="w-5 h-5" />
            </button>

            <button
              onClick={() => {
                if (imageSrc) setMode('compress');
                else fileInputRef.current?.click();
              }}
              className={`p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center ${
                mode === 'compress' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 shadow-md' : 'text-gray-500 hover:text-gray-300'
              } ${!imageSrc ? 'opacity-30' : ''}`}
              title="Smart Compression"
            >
              <FileDown className="w-5 h-5" />
            </button>

            <button
              onClick={() => {
                if (imageSrc) setMode('passport');
                else fileInputRef.current?.click();
              }}
              className={`p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center ${
                mode === 'passport' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 shadow-md' : 'text-gray-500 hover:text-gray-300'
              } ${!imageSrc ? 'opacity-30' : ''}`}
              title="Passport / Gov Pic Maker"
            >
              <Contact className="w-5 h-5" />
            </button>

            <button
              onClick={() => setMode('batch')}
              className={`p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center ${
                mode === 'batch' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 shadow-md' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="Bulk Batch Processor"
            >
              <Layers className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area (Header + main content view wrapper) */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0" id="main_container">
        {/* 1. Global Navigation Header */}
        <header className="flex items-center justify-between px-3 md:px-6 h-14 md:h-16 bg-gray-900 border-b border-gray-800 shrink-0 z-10 select-none">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setMode('home')}>
            <img src="/assets/logo/logo.jpg" alt="Logo" className="w-6 h-6 md:w-8 md:h-8 rounded object-cover" />
            <span className="text-xs md:text-sm font-semibold tracking-tight text-white">
              ImageForge Pro
            </span>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden md:flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span> WASM Multi-thread Active
            </div>
            
            {/* View specific header buttons */}
            {mode !== 'home' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    revokeWorkingObjectUrl();
                    setImageSrc(null);
                    clearProcessedOutput();
                    setMetadata(null);
                    setMode('home');
                  }}
                  className="text-[10px] md:text-xs text-gray-400 hover:text-white flex items-center gap-1 bg-gray-900 border border-gray-800 px-2 md:px-3 py-1 md:py-1.5 rounded-lg font-mono uppercase"
                >
                  <ChevronLeft className="w-3.5 h-3.5 md:w-4 md:h-4" /> <span className="hidden sm:inline">Exit to Home</span>
                </button>
                <button
                  onClick={exportCurrentImage}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] md:text-xs px-2.5 md:px-4 py-1.5 md:py-2 rounded-lg flex items-center gap-1.5 shadow-lg active:scale-95 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 md:w-4 md:h-4" /> <span>{isExporting ? 'Exporting…' : 'Export'}</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* 2. Main Arena Section */}
        <main className="flex-grow flex overflow-hidden">
          <Suspense fallback={<WorkspaceLoader />}>
          <AnimatePresence mode="wait">
            {/* --- A. HOME VIEW --- */}
            {mode === 'home' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full flex flex-col xl:flex-row p-6 lg:p-8 overflow-y-auto gap-8 bg-gray-950"
                id="home_view"
              >
                {/* Left Side: Main Content (Header, Drag & Drop, Capabilities, History) */}
                <div className="flex-1 flex flex-col gap-8 min-w-0">
                  {/* Branding Hero */}
                  <div className="text-left space-y-3">
                    <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-none font-sans">
                      ImageForge Pro
                    </h1>
                  </div>

                  {/* Upload Zone / Drop area */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          handleImageFile(e.dataTransfer.files[0]);
                        }
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-gray-900/30 border-2 border-dashed border-gray-800 hover:border-indigo-500/50 rounded-2xl p-10 flex flex-col items-center justify-center gap-4 cursor-pointer group transition duration-300 shadow-2xl relative overflow-hidden min-h-[220px]"
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        accept="image/*"
                        className="hidden"
                      />
                      <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl text-gray-400 group-hover:text-indigo-400 transition-colors shadow-lg">
                        <FolderOpen className="w-8 h-8" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-200">Drag & drop photo here</div>
                        <div className="text-[10px] text-gray-500 font-mono mt-1 uppercase">OR CLICK TO BROWSE FILE SYSTEM</div>
                      </div>
                    </div>

                    {/* Alternative quick triggers */}
                    <div className="flex flex-col gap-4">
                      {/* Quick trigger camera */}
                      <button
                        onClick={startCamera}
                        className="flex-grow bg-gray-900/40 hover:bg-gray-900/70 border border-gray-800/80 rounded-2xl p-6 flex items-center gap-4 text-left transition active:scale-[0.98] cursor-pointer shadow-xl group"
                      >
                        <div className="bg-indigo-950/60 p-3.5 rounded-xl text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition">
                          <Camera className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-gray-200">Take Photo from WebCam</div>
                          <p className="text-[10px] text-gray-500 font-mono mt-0.5 uppercase">Capture gov-photo or portrait instantly</p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-600 ml-auto group-hover:text-indigo-400 transition" />
                      </button>

                      {/* Quick trigger batch */}
                      <button
                        onClick={() => setMode('batch')}
                        className="flex-grow bg-gray-900/40 hover:bg-gray-900/70 border border-gray-800/80 rounded-2xl p-6 flex items-center gap-4 text-left transition active:scale-[0.98] cursor-pointer shadow-xl group"
                      >
                        <div className="bg-emerald-950/60 p-3.5 rounded-xl text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white transition">
                          <Layers className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-gray-200">Bulk Batch Processing</div>
                          <p className="text-[10px] text-gray-500 font-mono mt-0.5 uppercase">Compress & resize hundreds of files</p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-600 ml-auto group-hover:text-emerald-400 transition" />
                      </button>
                    </div>
                  </div>



                  {/* Recent Exports list */}
                  {recentExports.length > 0 && (
                    <div className="w-full text-left bg-gray-900/10 border border-gray-800 rounded-xl p-5">
                      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-3">Recent Exports this Session</div>
                      <div className="space-y-2">
                        {recentExports.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs border-b border-gray-800/40 pb-2">
                            <div className="font-medium text-gray-300 truncate max-w-sm">{item.name}</div>
                            <div className="flex gap-4 font-mono text-[11px] text-gray-500">
                              <span>{item.format}</span>
                              <span className="text-emerald-400">{(item.finalSize / 1024).toFixed(0)} KB</span>
                              <span>{item.date}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Column: Quick Actions */}
                <aside className="w-full xl:w-80 flex flex-col gap-6 shrink-0" id="home_sidebar">
                  {/* Quick Actions */}
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl text-left flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-gray-400 mb-4 uppercase tracking-wider font-mono">Quick Actions</h3>
                      <div className="flex flex-col gap-2.5">
                        <button
                          onClick={() => {
                            if (imageSrc) setMode('compress');
                            else fileInputRef.current?.click();
                          }}
                          className="w-full text-left bg-gray-850 hover:bg-gray-800 border border-gray-800 text-gray-200 p-3 rounded-xl text-xs font-semibold flex items-center gap-3 transition cursor-pointer"
                        >
                          <div className="w-6 h-6 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-lg flex items-center justify-center">
                            <Sliders className="w-3.5 h-3.5" />
                          </div>
                          Smart Compression
                        </button>
                        <button
                          onClick={() => {
                            if (imageSrc) setMode('bg-remover');
                            else fileInputRef.current?.click();
                          }}
                          className="w-full text-left bg-gray-850 hover:bg-gray-800 border border-gray-800 text-gray-200 p-3 rounded-xl text-xs font-semibold flex items-center gap-3 transition cursor-pointer"
                        >
                          <div className="w-6 h-6 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-lg flex items-center justify-center">
                            <Eraser className="w-3.5 h-3.5" />
                          </div>
                           Remove Background
                         </button>
                         <button
                           onClick={() => {
                             if (imageSrc) setMode('passport');
                             else fileInputRef.current?.click();
                           }}
                           className="w-full text-left bg-gray-850 hover:bg-gray-800 border border-gray-800 text-gray-200 p-3 rounded-xl text-xs font-semibold flex items-center gap-3 transition cursor-pointer"
                         >
                           <div className="w-6 h-6 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-lg flex items-center justify-center">
                             <Contact className="w-3.5 h-3.5" />
                           </div>
                           Passport Maker
                         </button>
                         <button
                           onClick={() => setMode('batch')}
                           className="w-full text-left bg-gray-850 hover:bg-gray-800 border border-gray-800 text-gray-200 p-3 rounded-xl text-xs font-semibold flex items-center gap-3 transition cursor-pointer"
                         >
                           <div className="w-6 h-6 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-lg flex items-center justify-center">
                             <Layers className="w-3.5 h-3.5" />
                           </div>
                           Batch Converter
                         </button>
                       </div>
                     </div>
                   </div>
                 </aside>

                {/* WebCam Capture dialog */}
                {showCamera && (
                  <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-md">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden max-w-md w-full shadow-2xl flex flex-col p-4 text-center">
                      <div className="text-xs font-bold uppercase text-gray-400 tracking-wider mb-3">WebCam Capture Studio</div>
                      <div className="aspect-video bg-black rounded-lg overflow-hidden relative border border-gray-800">
                        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover scale-x-[-1]" />
                      </div>
                      <div className="flex justify-center gap-3 mt-4">
                        <button
                          onClick={stopCamera}
                          className="bg-transparent border border-gray-800 text-gray-400 hover:text-white px-4 py-2 rounded-lg text-xs font-semibold"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={captureCameraPhoto}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 active:scale-95 transition"
                        >
                          <Camera className="w-4 h-4" /> Capture Photo
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

          {/* --- B. EDITOR VIEW --- */}
          {mode === 'editor' && imageSrc && metadata && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full flex flex-col-reverse lg:flex-row overflow-hidden"
              id="editor_view"
            >
              {/* Sidebar Left: Toolbox tabs and configuration widgets */}
              <aside className="w-full lg:w-80 bg-gray-900 border-r border-gray-900 flex flex-col overflow-y-auto select-none max-h-[35vh] lg:max-h-none shrink-0" id="editor_sidebar">
                {/* 1. Feature Switcher Header */}
                <div className="grid grid-cols-4 border-b border-gray-900/80 p-1">
                  <button
                    onClick={() => setMode('editor')}
                    className="p-3 hover:bg-gray-950/40 rounded flex flex-col items-center justify-center gap-1 text-[10px] font-bold font-mono uppercase tracking-wider text-indigo-400"
                    title="Tone and color editing"
                  >
                    <SlidersHorizontal className="w-4 h-4" /> Tone
                  </button>
                  <button
                    onClick={() => {
                      setCropSettings(prev => ({ ...prev, aspectRatio: null, aspectName: 'Free' }));
                      setMode('crop');
                    }}
                    className="p-3 hover:bg-gray-950/40 rounded flex flex-col items-center justify-center gap-1 text-[10px] font-bold font-mono uppercase tracking-wider text-gray-400 hover:text-white"
                    title="Precision Cropping tools"
                  >
                    <CropIcon className="w-4 h-4" /> Crop
                  </button>
                  <button
                    onClick={() => setMode('bg-remover')}
                    className="p-3 hover:bg-gray-950/40 rounded flex flex-col items-center justify-center gap-1 text-[10px] font-bold font-mono uppercase tracking-wider text-gray-400 hover:text-white"
                    title="AI Background remover"
                  >
                    <Eraser className="w-4 h-4" /> Backdrop
                  </button>
                  <button
                    onClick={() => setMode('passport')}
                    className="p-3 hover:bg-gray-950/40 rounded flex flex-col items-center justify-center gap-1 text-[10px] font-bold font-mono uppercase tracking-wider text-gray-400 hover:text-white"
                    title="Government passport layouts creator"
                  >
                    <Contact className="w-4 h-4" /> Gov-Pic
                  </button>
                </div>

                {/* 2. Undo / Redo controls */}
                <div className="flex items-center justify-between p-3 border-b border-gray-900 bg-gray-950/20 font-mono text-[10px]">
                  <span className="text-gray-500 font-semibold uppercase">History</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleUndo}
                      disabled={undoStack.length === 0}
                      className="p-1 hover:text-white transition disabled:opacity-20 disabled:pointer-events-none"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <span className="text-gray-500">|</span>
                    <button
                      onClick={handleRedo}
                      disabled={redoStack.length === 0}
                      className="p-1 hover:text-white transition rotate-180 disabled:opacity-20 disabled:pointer-events-none"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 3. Sliders & Advanced Controls */}
                <div className="p-4 space-y-5 text-left flex-grow">
                  {/* Basic Sliders Section */}
                  <div className="space-y-4">
                    <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono">Toning / Lighting</div>
                    
                    {/* Exposure */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>EXPOSURE</span>
                        <span className="text-indigo-400">{adjustments.exposure}</span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={adjustments.exposure}
                        onMouseDown={recordHistory}
                        onTouchStart={recordHistory}
                        onChange={(e) => updateAdjustments({ ...adjustments, exposure: Number(e.target.value) })}
                        className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>

                    {/* Brightness */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>BRIGHTNESS</span>
                        <span className="text-indigo-400">{adjustments.brightness}</span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={adjustments.brightness}
                        onMouseDown={recordHistory}
                        onTouchStart={recordHistory}
                        onChange={(e) => updateAdjustments({ ...adjustments, brightness: Number(e.target.value) })}
                        className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>

                    {/* Contrast */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>CONTRAST</span>
                        <span className="text-indigo-400">{adjustments.contrast}</span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={adjustments.contrast}
                        onMouseDown={recordHistory}
                        onTouchStart={recordHistory}
                        onChange={(e) => updateAdjustments({ ...adjustments, contrast: Number(e.target.value) })}
                        className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>

                    {/* Highlights */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>HIGHLIGHTS</span>
                        <span className="text-indigo-400">{adjustments.highlights}</span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={adjustments.highlights}
                        onMouseDown={recordHistory}
                        onTouchStart={recordHistory}
                        onChange={(e) => updateAdjustments({ ...adjustments, highlights: Number(e.target.value) })}
                        className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>

                    {/* Shadows */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>SHADOWS</span>
                        <span className="text-indigo-400">{adjustments.shadows}</span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={adjustments.shadows}
                        onMouseDown={recordHistory}
                        onTouchStart={recordHistory}
                        onChange={(e) => updateAdjustments({ ...adjustments, shadows: Number(e.target.value) })}
                        className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-4 border-t border-gray-850 pt-4">
                    <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono">Color Space</div>

                    {/* Temperature */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>TEMP (WARMTH)</span>
                        <span className="text-indigo-400">{adjustments.temperature}</span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={adjustments.temperature}
                        onMouseDown={recordHistory}
                        onTouchStart={recordHistory}
                        onChange={(e) => updateAdjustments({ ...adjustments, temperature: Number(e.target.value) })}
                        className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>

                    {/* Saturation */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>SATURATION</span>
                        <span className="text-indigo-400">{adjustments.saturation}</span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={adjustments.saturation}
                        onMouseDown={recordHistory}
                        onTouchStart={recordHistory}
                        onChange={(e) => updateAdjustments({ ...adjustments, saturation: Number(e.target.value) })}
                        className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>

                    {/* Vibrance */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>VIBRANCE</span>
                        <span className="text-indigo-400">{adjustments.vibrance}</span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={adjustments.vibrance}
                        onMouseDown={recordHistory}
                        onTouchStart={recordHistory}
                        onChange={(e) => updateAdjustments({ ...adjustments, vibrance: Number(e.target.value) })}
                        className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>TINT</span>
                        <span className="text-indigo-400">{adjustments.tint}</span>
                      </div>
                      <input type="range" min="-100" max="100" value={adjustments.tint} onMouseDown={recordHistory} onTouchStart={recordHistory} onChange={(e) => updateAdjustments({ ...adjustments, tint: Number(e.target.value) })} className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono text-gray-400">
                        <span>HUE</span>
                        <span className="text-indigo-400">{adjustments.hue}°</span>
                      </div>
                      <input type="range" min="-180" max="180" value={adjustments.hue} onMouseDown={recordHistory} onTouchStart={recordHistory} onChange={(e) => updateAdjustments({ ...adjustments, hue: Number(e.target.value) })} className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                    </div>
                  </div>

                  <div className="space-y-4 border-t border-gray-850 pt-4">
                    <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono">Detail</div>
                    {([
                      ['CLARITY', 'clarity', -100, 100],
                      ['SHARPNESS', 'sharpness', 0, 100],
                      ['DENOISE', 'denoise', 0, 100],
                      ['BLUR', 'blur', 0, 100],
                      ['VIGNETTE', 'vignette', 0, 100]
                    ] as const).map(([label, key, min, max]) => (
                      <div className="space-y-1" key={key}>
                        <div className="flex justify-between text-[11px] font-mono text-gray-400"><span>{label}</span><span className="text-indigo-400">{adjustments[key]}</span></div>
                        <input type="range" min={min} max={max} value={adjustments[key]} onMouseDown={recordHistory} onTouchStart={recordHistory} onChange={(e) => updateAdjustments({ ...adjustments, [key]: Number(e.target.value) })} className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                      </div>
                    ))}
                  </div>

                  {/* Creative Filters and Toggles */}
                  <div className="space-y-4 border-t border-gray-850 pt-4">
                    <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono">Creative Filters</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => applyDiscreteAdjustment({ ...adjustments, grayscale: !adjustments.grayscale })}
                        className={`py-1.5 rounded text-xs font-semibold font-mono tracking-wide transition border ${
                          adjustments.grayscale ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-950 border-gray-800 text-gray-400'
                        }`}
                      >
                        GrayScale
                      </button>
                      <button
                        onClick={() => applyDiscreteAdjustment({ ...adjustments, sepia: !adjustments.sepia })}
                        className={`py-1.5 rounded text-xs font-semibold font-mono tracking-wide transition border ${
                          adjustments.sepia ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-950 border-gray-800 text-gray-400'
                        }`}
                      >
                        Sepia
                      </button>
                      <button
                        onClick={() => applyDiscreteAdjustment({ ...adjustments, invert: !adjustments.invert })}
                        className={`py-1.5 rounded text-xs font-semibold font-mono tracking-wide transition border ${
                          adjustments.invert ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-950 border-gray-800 text-gray-400'
                        }`}
                      >
                        Invert
                      </button>
                      <button
                        onClick={() => applyDiscreteAdjustment({ ...adjustments, threshold: !adjustments.threshold })}
                        className={`py-1.5 rounded text-xs font-semibold font-mono tracking-wide transition border ${
                          adjustments.threshold ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-950 border-gray-800 text-gray-400'
                        }`}
                      >
                        Threshold
                      </button>
                    </div>
                  </div>

                  {/* Curves panel */}
                  <div className="border-t border-gray-850 pt-4">
                    <CurvesWidget
                      points={adjustments.curvesPoints}
                      onChange={(pts) => updateAdjustments({ ...adjustments, curvesPoints: pts })}
                    />
                  </div>

                  {/* Histogram panel */}
                  <div className="border-t border-gray-850 pt-4 pb-6">
                    <Histogram histogramData={histogramData} />
                  </div>
                </div>
              </aside>

              {/* Editor Workspace Panel Center */}
              <section className="flex-grow flex flex-col relative overflow-hidden bg-gray-950">
                {/* Horizontal Tool selection menu (Ruler, Text annotation, Arrow) */}
                <div className="h-14 bg-gray-900 border-b border-gray-950/80 px-6 flex items-center justify-between z-10">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setEditorTool('pan')}
                      className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        editorTool === 'pan' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                      }`}
                      title="Pan/Move viewport mode"
                    >
                      <Sliders className="w-4 h-4" /> Pan & Zoom
                    </button>
                    <button
                      onClick={() => setEditorTool('measure')}
                      className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        editorTool === 'measure' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                      }`}
                      title="Ruler measurement tool"
                    >
                      <Compass className="w-4 h-4" /> Ruler
                    </button>
                    <button
                      onClick={() => setEditorTool('text')}
                      className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        editorTool === 'text' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Type className="w-4 h-4" /> Text
                    </button>
                    <button
                      onClick={() => setEditorTool('rect')}
                      className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                        editorTool === 'rect' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Square className="w-4 h-4" /> Rectangle
                    </button>
                  </div>

                  {/* Fast Rotate & Transform triggers */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => applyDiscreteAdjustment({ ...adjustments, rotate: (adjustments.rotate + 90) % 360 })}
                      className="p-2 rounded-lg text-xs text-gray-400 hover:text-white transition"
                      title="Rotate 90 degrees"
                    >
                      <RefreshCw className="w-4 h-4" /> Rotate 90
                    </button>
                    <button
                      onClick={() => applyDiscreteAdjustment({ ...adjustments, flipH: !adjustments.flipH })}
                      className="p-2 rounded-lg text-xs text-gray-400 hover:text-white transition"
                    >
                      Flip Horiz
                    </button>
                  </div>
                </div>

                {/* Core Editor Canvas */}
                <div className="flex-grow relative">
                  <EditorCanvas
                    imageSrc={imageSrc}
                    adjustments={adjustments}
                    metadata={metadata}
                    activeTool={editorTool}
                    strokeColor={strokeColor}
                    strokeWidth={strokeWidth}
                    onProcessedImageChange={setProcessedOutput}
                    onHistogramChange={setHistogramData}
                  />
                </div>
              </section>
            </motion.div>
          )}

          {/* --- C. CROPPING VIEW --- */}
          {mode === 'crop' && imageSrc && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full flex flex-col-reverse lg:flex-row overflow-hidden"
              id="crop_view"
            >
              {/* Crop sidebar parameters */}
              <aside className="w-full lg:w-80 bg-gray-900 border-r border-gray-900 flex flex-col p-4 text-left gap-5 select-none overflow-y-auto max-h-[35vh] lg:max-h-none shrink-0">
                <div>
                  <h2 className="text-sm font-bold text-indigo-400 uppercase tracking-widest font-mono">Aspect Ratio Presets</h2>
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5 uppercase">Lock crop dimensions perfectly</p>
                </div>

                {/* Aspect presets cards */}
                <div className="space-y-2">
                  {[
                    { name: 'Free Aspect', ratio: null },
                    { name: 'Square (1:1)', ratio: 1.0 },
                    { name: 'Classic Portrait (3:2)', ratio: 1.5 },
                    { name: 'Golden Standard (4:3)', ratio: 1.333 },
                    { name: 'HD Cinematic (16:9)', ratio: 1.777 },
                    { name: 'TikTok vertical (9:16)', ratio: 0.562 }
                  ].map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCropSettings({ ...cropSettings, aspectRatio: preset.ratio, aspectName: preset.name })}
                      className={`w-full py-2 px-3 text-xs font-semibold rounded border transition text-left flex justify-between items-center ${
                        cropSettings.aspectRatio === preset.ratio
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      <span>{preset.name}</span>
                      <span className="font-mono text-[10px] opacity-60">
                        {preset.ratio ? preset.ratio.toFixed(2) : 'Free'}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Shape selection masks */}
                <div className="space-y-2 border-t border-gray-800/80 pt-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono">Crop Mask Shape</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['rect', 'circle', 'oval'] as const).map((sh) => (
                      <button
                        key={sh}
                        onClick={() => setCropSettings({ ...cropSettings, shape: sh })}
                        className={`py-2 px-2 text-[10px] uppercase font-bold font-mono rounded border transition ${
                          cropSettings.shape === sh
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-white'
                        }`}
                      >
                        {sh}
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              {/* Crop Workspace Arena */}
              <section className="flex-grow relative bg-gray-950">
                <CropCanvas
                  imageSrc={processedUrl || imageSrc}
                  settings={cropSettings}
                  onCropComplete={(croppedUrl) => {
                    commitDerivedImage(croppedUrl);
                  }}
                  onCancel={() => setMode('editor')}
                />
              </section>
            </motion.div>
          )}

          {/* --- D. BACKGROUND REMOVAL VIEW --- */}
          {mode === 'bg-remover' && imageSrc && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full flex flex-col-reverse lg:flex-row overflow-hidden"
              id="bg_removal_view"
            >
              {/* Sidebar Left panel */}
              <aside className="w-full lg:w-80 bg-gray-900 border-r border-gray-900 flex flex-col p-4 text-left gap-5 select-none overflow-y-auto max-h-[35vh] lg:max-h-none shrink-0">
                <div>
                  <h2 className="text-sm font-bold text-indigo-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                    <Eraser className="w-4 h-4" /> Mask refinement
                  </h2>
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5 uppercase">Fine-tune edge outlines</p>
                </div>

                {/* Manual brush controls */}
                <div className="space-y-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono">Manual Masking Brush</div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setBgRemovalSettings({ ...bgRemovalSettings, brushMode: 'erase' })}
                      className={`py-1.5 rounded text-[11px] font-bold font-mono uppercase tracking-wide transition border ${
                        bgRemovalSettings.brushMode === 'erase' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-950 border-gray-800 text-gray-400'
                      }`}
                    >
                      Erase Brush
                    </button>
                    <button
                      onClick={() => setBgRemovalSettings({ ...bgRemovalSettings, brushMode: 'restore' })}
                      className={`py-1.5 rounded text-[11px] font-bold font-mono uppercase tracking-wide transition border ${
                        bgRemovalSettings.brushMode === 'restore' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-gray-950 border-gray-800 text-gray-400'
                      }`}
                    >
                      Restore Brush
                    </button>
                  </div>

                  {bgRemovalSettings.brushMode !== 'none' && (
                    <>
                      {/* Brush size slider */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-mono text-gray-400">
                          <span>BRUSH DIAMETER</span>
                          <span className="text-indigo-400 font-bold">{bgRemovalSettings.brushSize}px</span>
                        </div>
                        <input
                          type="range"
                          min="5"
                          max="100"
                          value={bgRemovalSettings.brushSize}
                          onChange={(e) => setBgRemovalSettings({ ...bgRemovalSettings, brushSize: Number(e.target.value) })}
                          className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                      </div>

                      {/* Brush hardness slider */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-mono text-gray-400">
                          <span>HARDNESS</span>
                          <span className="text-indigo-400 font-bold">{bgRemovalSettings.brushHardness}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={bgRemovalSettings.brushHardness}
                          onChange={(e) => setBgRemovalSettings({ ...bgRemovalSettings, brushHardness: Number(e.target.value) })}
                          className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Auto Segment Tolerance & Feather settings */}
                <div className="space-y-4 border-t border-gray-800/80 pt-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono">Edge Processing</div>
                  
                  {/* Tolerance slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono text-gray-400">
                      <span>CHROMA TOLERANCE</span>
                      <span className="text-indigo-400 font-bold">{bgRemovalSettings.tolerance}%</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={bgRemovalSettings.tolerance}
                      onChange={(e) => setBgRemovalSettings({ ...bgRemovalSettings, tolerance: Number(e.target.value) })}
                      className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  {/* Mask Feather slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono text-gray-400">
                      <span>MASK FEATHER</span>
                      <span className="text-indigo-400 font-bold">{bgRemovalSettings.feather}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      value={bgRemovalSettings.feather}
                      onChange={(e) => setBgRemovalSettings({ ...bgRemovalSettings, feather: Number(e.target.value) })}
                      className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                </div>

                {/* Replacement Background layout options */}
                <div className="space-y-3 border-t border-gray-800/80 pt-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono">Replacement Backdrop</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { name: 'Transparent', id: 'transparent' },
                      { name: 'Solid White', id: 'solid_white', color: '#ffffff' },
                      { name: 'Solid Black', id: 'solid_black', color: '#000000' },
                      { name: 'Gaussian Blur', id: 'blur' }
                    ].map((bg, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          if (bg.id === 'transparent') {
                            setBgRemovalSettings({ ...bgRemovalSettings, type: 'transparent' });
                          } else if (bg.id === 'blur') {
                            setBgRemovalSettings({ ...bgRemovalSettings, type: 'blur' });
                          } else {
                            setBgRemovalSettings({ ...bgRemovalSettings, type: 'solid', solidColor: bg.color || '#fff' });
                          }
                        }}
                        className={`py-1.5 rounded text-[11px] font-mono uppercase font-bold transition border ${
                          (bg.id === 'transparent' && bgRemovalSettings.type === 'transparent') ||
                          (bg.id === 'blur' && bgRemovalSettings.type === 'blur') ||
                          (bg.id === 'solid_white' && bgRemovalSettings.type === 'solid' && bgRemovalSettings.solidColor === '#ffffff') ||
                          (bg.id === 'solid_black' && bgRemovalSettings.type === 'solid' && bgRemovalSettings.solidColor === '#000000')
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-gray-950 border-gray-800 text-gray-400'
                        }`}
                      >
                        {bg.name}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center justify-between gap-2 mt-2 bg-gray-950 border border-gray-800 hover:border-indigo-500/60 rounded px-2.5 py-2 text-[10px] font-bold uppercase font-mono text-gray-400 cursor-pointer transition">
                    <span className="truncate">{bgRemovalSettings.bgImageUrl ? 'Replacement image selected' : 'Use custom image'}</span>
                    <span className="text-indigo-400 shrink-0">Browse</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => setBgRemovalSettings((current) => ({ ...current, type: 'image', bgImageUrl: String(reader.result) }));
                        reader.readAsDataURL(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </aside>

              {/* Remover Canvas Workspace */}
              <section className="flex-grow relative bg-gray-950">
                <BackgroundRemoverCanvas
                  imageSrc={processedUrl || imageSrc}
                  settings={bgRemovalSettings}
                  onMaskComplete={(outputPngUrl) => {
                    commitDerivedImage(outputPngUrl);
                  }}
                  onCancel={() => setMode('editor')}
                />
              </section>
            </motion.div>
          )}

          {/* --- E. PASSPORT LAYOUT VIEW --- */}
          {mode === 'passport' && imageSrc && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full flex flex-col-reverse lg:flex-row overflow-hidden"
              id="passport_view"
            >
              {/* Presets and options sidebar panel */}
              <aside className="w-full lg:w-80 bg-gray-900 border-r border-gray-900 flex flex-col p-4 text-left gap-5 select-none overflow-y-auto max-h-[35vh] lg:max-h-none shrink-0">
                <div>
                  <h2 className="text-sm font-bold text-indigo-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                    <Contact className="w-4.5 h-4.5" /> Passport Presets
                  </h2>
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5 uppercase">Select target country rules</p>
                </div>

                {/* Presets map */}
                <div className="space-y-2 flex-grow overflow-y-auto max-h-[300px] pr-1">
                  {PASSPORT_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPassportPreset(p)}
                      className={`w-full py-2.5 px-3 rounded border text-xs font-semibold text-left transition flex flex-col gap-1.5 ${
                        passportPreset.id === p.id
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="font-bold truncate max-w-[160px]">{p.country}</span>
                        <span className="text-[9px] font-mono opacity-80 uppercase bg-gray-900 px-1.5 py-0.5 rounded">
                          {p.widthMm}x{p.heightMm} mm
                        </span>
                      </div>
                      <span className="text-[10px] font-medium opacity-70 block">{p.name}</span>
                    </button>
                  ))}
                </div>
              </aside>

              {/* Passport workspace section */}
              <section className="flex-grow relative bg-gray-950">
                <PassportCanvas
                  imageSrc={processedUrl || imageSrc}
                  preset={passportPreset}
                  onSingleExport={(singleUrl) => {
                    commitDerivedImage(singleUrl);
                  }}
                  onExportPrintSheet={(sheetUrl) => {
                    commitDerivedImage(sheetUrl);
                  }}
                  onCancel={() => setMode('editor')}
                />
              </section>
            </motion.div>
          )}

          {/* --- F. BATCH PROCESSOR VIEW --- */}
          {mode === 'batch' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full"
              id="batch_view"
            >
              <BatchProcessor
                onAddImagesToEditor={(files) => {
                  if (files[0]) handleImageFile(files[0]);
                }}
              />
            </motion.div>
          )}

          {/* --- G. STANDALONE SMART COMPRESSION VIEW --- */}
          {mode === 'compress' && imageSrc && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full flex flex-col-reverse lg:flex-row overflow-hidden"
              id="compress_view"
            >
              {/* Sidebar controls (rendered below workspace on mobile, left of workspace on desktop) */}
              <aside className="w-full lg:w-80 bg-gray-900 border-t lg:border-t-0 lg:border-r border-gray-800 flex flex-col p-4 text-left gap-4 select-none overflow-y-auto shrink-0 max-h-[40vh] lg:max-h-none">
                <div>
                  <h2 className="text-sm font-bold text-indigo-400 uppercase tracking-widest font-mono flex items-center gap-1.5">
                    <Sliders className="w-4 h-4" /> Compression Settings
                  </h2>
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5 uppercase">Optimize format & budget sizing</p>
                </div>

                <div className="space-y-3">
                  {/* Format select */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">Format</label>
                    <select
                      value={compressionSettings.format}
                      onChange={(e) => setCompressionSettings({ ...compressionSettings, format: e.target.value as any })}
                      className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 font-mono cursor-pointer"
                    >
                      <option value="webp">WEBP (Adaptive Quality)</option>
                      <option value="jpeg">JPEG (Standard Lossy)</option>
                      <option value="png">PNG (Lossless Optimization)</option>
                      <option value="avif">AVIF (Deep Compression)</option>
                    </select>
                  </div>

                  <div className="rounded border border-gray-800 bg-gray-950 px-2.5 py-2 text-[9px] font-mono text-gray-500 leading-relaxed">
                    <span className="text-indigo-400 font-bold uppercase">Privacy-safe export</span><br />
                    EXIF and location metadata are stripped by browser canvas processing.
                  </div>

                  {/* Desired Size Mode selector */}
                  <div className="space-y-1.5 pt-2.5 border-t border-gray-800/80">
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">Desired Size Mode</label>
                      <button
                        onClick={() => setCompressionSettings({ ...compressionSettings, targetSizeKb: compressionSettings.targetSizeKb === null ? 150 : null })}
                        className="text-[9px] text-indigo-400 hover:text-indigo-300 font-mono underline cursor-pointer"
                      >
                        {compressionSettings.targetSizeKb === null ? 'Limit to KB' : 'Use Quality Slider'}
                      </button>
                    </div>

                    {compressionSettings.targetSizeKb === null ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-mono text-gray-400">
                          <span>Slider Quality:</span>
                          <span className="text-indigo-400 font-bold">{compressionSettings.quality}%</span>
                        </div>
                        <input
                          type="range"
                          min="5"
                          max="100"
                          value={compressionSettings.quality}
                          onChange={(e) => setCompressionSettings({ ...compressionSettings, quality: Number(e.target.value) })}
                          className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <input
                          type="number"
                          value={compressionSettings.targetSizeKb}
                          onChange={(e) => setCompressionSettings({ ...compressionSettings, targetSizeKb: Number(e.target.value) })}
                          className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 font-mono"
                          min="10"
                          max="20000"
                          placeholder="e.g. 100"
                        />
                        <span className="text-[9px] text-indigo-400 font-mono leading-relaxed block">
                          ⚡ Binary search automatically compiles multiple passes finding the ultimate quality meeting this target size.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Real-time statistics block */}
                <div className="bg-gray-950 border border-gray-850 rounded-xl p-3.5 space-y-3 flex-grow flex flex-col justify-end">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest font-mono">Optimization Stats</div>
                  
                  {isCompilingRealTime ? (
                    <div className="flex flex-col items-center justify-center py-4 gap-1 text-gray-500 text-xs font-mono">
                      <RefreshCw className="w-4.5 h-4.5 text-indigo-500 animate-spin" />
                      <span>Optimizing...</span>
                    </div>
                  ) : realTimeCompressResult ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-[11px] font-mono">
                        <span className="text-gray-500">ORIGINAL SIZE</span>
                        <span className="text-gray-300 font-bold">{(metadata?.size ? metadata.size / 1024 : 0).toFixed(0)} KB</span>
                      </div>
                      <div className="flex justify-between text-[11px] font-mono">
                        <span className="text-gray-500">COMPRESSED SIZE</span>
                        <span className="text-emerald-400 font-bold">{realTimeCompressResult.sizeKb.toFixed(0)} KB</span>
                      </div>
                      <div className="flex justify-between text-[11px] font-mono border-t border-gray-900 pt-2">
                        <span className="text-gray-500">SAVINGS</span>
                        <span className="text-emerald-400 font-bold">
                          {(((metadata?.size || 0) - realTimeCompressResult.blob.size) / 1024).toFixed(0)} KB (
                          {Math.max(0, Math.round((1 - realTimeCompressResult.blob.size / (metadata?.size || 1)) * 100))}%
                          )
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] font-mono">
                        <span className="text-gray-500">SSIM INDEX</span>
                        <span className="text-indigo-400 font-bold">{Math.round(realTimeCompressResult.ssim * 100)}%</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 font-mono text-center py-4">Slide quality to compute</div>
                  )}
                  
                  <button
                    onClick={() => {
                      if (realTimeCompressResult) {
                        const cleanName = imageName.substring(0, imageName.lastIndexOf('.')) || imageName;
                        const ext = realTimeCompressResult.format === 'jpeg' ? 'jpg' : realTimeCompressResult.format;
                        downloadBlob(realTimeCompressResult.blob, `imageforge_${cleanName}.${ext}`);
                        
                        // Save in recent exports
                        const savedItem = {
                          name: cleanName,
                          originalSize: metadata?.size || 0,
                          finalSize: realTimeCompressResult.blob.size,
                          format: realTimeCompressResult.format.toUpperCase(),
                          date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        };
                        setRecentExports((prev) => [savedItem, ...prev.slice(0, 4)]);
                      }
                    }}
                    disabled={!realTimeCompressResult}
                    className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-xl transition active:scale-95 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                  >
                    <Download className="w-4 h-4" /> Save Optimized Image
                  </button>
                </div>
              </aside>

              {/* Center workspace section: side-by-side preview comparisons */}
              <section className="flex-grow relative bg-gray-950 flex flex-col items-center justify-center p-4 md:p-6 select-none overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-5xl items-stretch">
                  {/* Left Column: Original */}
                  <div className="flex flex-col bg-gray-900 border border-gray-800 rounded-2xl p-4 gap-2 overflow-hidden justify-between min-h-[220px] sm:min-h-0">
                    <span className="text-[10px] font-mono uppercase text-gray-400 self-start">Original Image</span>
                    <div className="flex-grow flex items-center justify-center overflow-hidden rounded bg-gray-950/40 border border-gray-850 p-2">
                      <img
                        src={processedUrl || imageSrc}
                        alt="Original View"
                        className="max-h-[25vh] md:max-h-[45vh] object-contain shadow-md rounded"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="flex justify-between items-center text-[11px] font-mono text-gray-500 mt-1">
                      <span>{metadata?.width} x {metadata?.height}</span>
                      <span>{(metadata?.size ? metadata.size / 1024 : 0).toFixed(0)} KB</span>
                    </div>
                  </div>

                  {/* Right Column: Compressed */}
                  <div className="flex flex-col bg-gray-900 border border-indigo-950 rounded-2xl p-4 gap-2 overflow-hidden justify-between min-h-[220px] sm:min-h-0">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono uppercase text-indigo-400">Optimized Preview</span>
                      {isCompilingRealTime && <RefreshCw className="w-3 h-3 text-indigo-500 animate-spin" />}
                    </div>
                    <div className="flex-grow flex items-center justify-center overflow-hidden rounded bg-gray-950/40 border border-gray-850 p-2">
                      {realTimeCompressResult && compressedPreviewUrl ? (
                        <img
                          src={compressedPreviewUrl}
                          alt="Compressed View"
                          className="max-h-[25vh] md:max-h-[45vh] object-contain shadow-md rounded"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-gray-500 text-xs font-mono">
                          <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin" />
                          <span>Generating Optimized Preview...</span>
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between items-center text-[11px] font-mono text-gray-500 mt-1">
                      <span className="text-indigo-400 font-bold">Estimated SSIM: {realTimeCompressResult ? Math.round(realTimeCompressResult.ssim * 100) : 0}%</span>
                      <span className="text-emerald-400 font-bold">
                        {realTimeCompressResult ? `${realTimeCompressResult.sizeKb.toFixed(0)} KB` : 'Computing...'}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </motion.div>
          )}
          </AnimatePresence>
          </Suspense>
      </main>
    </div>

      {/* 3. Global Modal: COMPRESS & EXPORT COMPOSER */}
      <AnimatePresence>
        {showExportModal && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-gray-900 border border-gray-800 max-w-xl w-full rounded-2xl overflow-hidden p-6 text-left flex flex-col gap-6 shadow-2xl"
              id="export_modal"
            >
              {/* Header */}
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest font-mono text-indigo-400">Compression Engine</h3>
                <p className="text-[10px] text-gray-500 font-mono mt-0.5 uppercase">Specify export options with quality estimations</p>
              </div>

              {/* Parameters config */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-t border-gray-800/80 py-4">
                <div className="space-y-4">
                  {/* Format select */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">Format</label>
                    <select
                      value={compressionSettings.format}
                      onChange={(e) => setCompressionSettings({ ...compressionSettings, format: e.target.value as any })}
                      className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 font-mono"
                    >
                      <option value="webp">WEBP (Adaptive Quality)</option>
                      <option value="jpeg">JPEG (Standard Lossy)</option>
                      <option value="png">PNG (Lossless Optimization)</option>
                      <option value="avif">AVIF (Deep Compression)</option>
                    </select>
                  </div>

                  <div className="rounded border border-gray-800 bg-gray-950 px-2.5 py-2 text-[9px] font-mono text-gray-500 leading-relaxed">
                    <span className="text-indigo-400 font-bold uppercase">Privacy-safe export</span><br />
                    EXIF and location metadata are stripped by browser canvas processing.
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Quality vs Desired Target File Size Toggle */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">Desired Size Mode</label>
                      <button
                        onClick={() => setCompressionSettings({ ...compressionSettings, targetSizeKb: compressionSettings.targetSizeKb === null ? 150 : null })}
                        className="text-[9px] text-indigo-400 hover:text-indigo-300 font-mono underline"
                      >
                        {compressionSettings.targetSizeKb === null ? 'Limit to KB' : 'Use Quality Slider'}
                      </button>
                    </div>

                    {compressionSettings.targetSizeKb === null ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-mono text-gray-400">
                          <span>Slider Quality:</span>
                          <span className="text-indigo-400 font-bold">{compressionSettings.quality}%</span>
                        </div>
                        <input
                          type="range"
                          min="5"
                          max="100"
                          value={compressionSettings.quality}
                          onChange={(e) => setCompressionSettings({ ...compressionSettings, quality: Number(e.target.value) })}
                          className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <input
                          type="number"
                          value={compressionSettings.targetSizeKb}
                          onChange={(e) => setCompressionSettings({ ...compressionSettings, targetSizeKb: Number(e.target.value) })}
                          className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 font-mono"
                          min="10"
                          max="20000"
                          placeholder="e.g. 100"
                        />
                        <span className="text-[9px] text-indigo-400 font-mono leading-relaxed block">
                          ⚡ Binary Search automatically compiles multiple passes finding the ultimate quality meeting this target size.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Status and Results area */}
              <div className="flex-grow flex flex-col justify-center items-center text-center py-4 bg-gray-950/30 border border-gray-850 rounded-xl min-h-[140px] px-4 relative">
                {isExporting ? (
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                    <span className="text-xs font-mono font-semibold uppercase tracking-wider text-indigo-400 animate-pulse">Running multi-pass SSIM solver...</span>
                  </div>
                ) : exportResult ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
                    <div className="text-left bg-gray-900 border border-gray-800 p-2.5 rounded-lg">
                      <div className="text-[10px] text-gray-500 font-mono uppercase">Original Size</div>
                      <div className="text-sm font-black text-gray-200 mt-0.5">
                        {metadata ? (metadata.size / 1024).toFixed(0) : '0'} KB
                      </div>
                    </div>
                    <div className="text-left bg-gray-900 border border-gray-800 p-2.5 rounded-lg">
                      <div className="text-[10px] text-gray-500 font-mono uppercase text-emerald-400">Final Size</div>
                      <div className="text-sm font-black text-emerald-400 mt-0.5">
                        {exportResult.sizeKb.toFixed(0)} KB
                      </div>
                    </div>
                    <div className="text-left bg-gray-900 border border-gray-800 p-2.5 rounded-lg">
                      <div className="text-[10px] text-gray-500 font-mono uppercase">SSIM Quality</div>
                      <div className="text-sm font-black text-indigo-400 mt-0.5">
                        {Math.round(exportResult.ssim * 100)}%
                      </div>
                    </div>
                    <div className="text-left bg-gray-900 border border-gray-800 p-2.5 rounded-lg">
                      <div className="text-[10px] text-gray-500 font-mono uppercase">Optimal Q</div>
                      <div className="text-sm font-black text-gray-200 mt-0.5">
                        {exportResult.quality}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 font-mono">Configure criteria above and tap process</div>
                )}
              </div>

              {/* Action row footer */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="bg-transparent border border-gray-800 text-gray-400 hover:text-white px-4 py-2 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
                {exportResult ? (
                  <>
                    <button
                      onClick={handleShare}
                      className="bg-gray-850 hover:bg-gray-800 text-gray-300 px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Share2 className="w-4 h-4" /> Share
                    </button>
                    <button
                      onClick={triggerExportDownload}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2.5 rounded-lg flex items-center gap-1.5 shadow-xl transition active:scale-95"
                    >
                      <CheckCircle className="w-4 h-4" /> Save Output File
                    </button>
                  </>
                ) : (
                  <button
                    onClick={executeFinalExport}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2.5 rounded-lg flex items-center gap-1.5 transition active:scale-95"
                  >
                    Solve & Prepare File
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
