/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { BatchItem, CompressionSettings } from '../types';
import { compressImage } from '../utils/compression';
import { Play, Pause, Trash2, Download, CheckCircle, FileImage, Layers, ArrowUpRight, FolderDown, RefreshCw } from 'lucide-react';
import { convertHeicToJpeg } from '../utils/heicHelper';
import JSZip from 'jszip';

interface BatchProcessorProps {
  onAddImagesToEditor: (files: File[]) => void;
}

export default function BatchProcessor({ onAddImagesToEditor }: BatchProcessorProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [isHeicConverting, setIsHeicConverting] = useState<boolean>(false);
  
  // Batch Options
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp' | 'avif'>('webp');
  const [quality, setQuality] = useState<number>(80);
  const [targetSizeKb, setTargetSizeKb] = useState<number | null>(null);
  const [scale, setScale] = useState<number>(100); // percentage scale
  const [prefix, setPrefix] = useState<string>('optimized_');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean thumbnails on unmount
  useEffect(() => {
    return () => {
      items.forEach(item => URL.revokeObjectURL(item.thumbnailUrl));
    };
  }, []);

  const handleFilesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    addFileList(Array.from(e.target.files));
  };

  const addFileList = async (files: File[]) => {
    setIsHeicConverting(true);
    try {
      const processedFiles = await Promise.all(
        files.map(async file => {
          const isHeic = file.type === 'image/heic' || file.type === 'image/heif' || 
                         file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
          if (isHeic) {
            try {
              return await convertHeicToJpeg(file);
            } catch (err) {
              console.error('HEIC conversion failed for file:', file.name, err);
              return file; // fallback
            }
          }
          return file;
        })
      );

      const newItems: BatchItem[] = processedFiles.map(file => {
        const thumbUrl = URL.createObjectURL(file);
        return {
          id: Math.random().toString(36).substring(7),
          file,
          name: file.name,
          size: file.size,
          width: 0,
          height: 0,
          thumbnailUrl: thumbUrl,
          status: 'pending',
          progress: 0
        };
      });
      setItems(prev => [...prev, ...newItems]);
    } finally {
      setIsHeicConverting(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      addFileList(Array.from(e.dataTransfer.files));
    }
  };

  const removeItem = (id: string) => {
    setItems(prev => {
      const target = prev.find(item => item.id === id);
      if (target) URL.revokeObjectURL(target.thumbnailUrl);
      return prev.filter(item => item.id !== id);
    });
  };

  const clearAll = () => {
    items.forEach(item => URL.revokeObjectURL(item.thumbnailUrl));
    setItems([]);
    setIsRunning(false);
    setCurrentIdx(0);
  };

  // Main Batch Engine Loop
  useEffect(() => {
    if (!isRunning) return;

    // Find next pending file
    const nextPendingIdx = items.findIndex((item, idx) => idx >= currentIdx && item.status === 'pending');
    
    if (nextPendingIdx === -1) {
      setIsRunning(false);
      return;
    }

    setCurrentIdx(nextPendingIdx);
    processBatchItem(nextPendingIdx);
  }, [isRunning, currentIdx, items]);

  const processBatchItem = async (index: number) => {
    const item = items[index];
    if (!item) return;

    // Update status to processing
    setItems(prev => prev.map((it, idx) => idx === index ? { ...it, status: 'processing', progress: 20 } : it));

    try {
      const img = new Image();
      const loadPromise = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
      });

      const url = URL.createObjectURL(item.file);
      img.src = url;
      await loadPromise;
      URL.revokeObjectURL(url);

      // Setup Scaling / Resizing OffscreenCanvas
      const canvas = document.createElement('canvas');
      const w = Math.round(img.width * (scale / 100));
      const h = Math.round(img.height * (scale / 100));
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
      }

      setItems(prev => prev.map((it, idx) => idx === index ? { ...it, progress: 60 } : it));

      // Execute smart compression using our core engine
      const compressionResult = await compressImage(canvas, format, targetSizeKb, quality, false);

      const compressedUrl = URL.createObjectURL(compressionResult.blob);

      setItems(prev => prev.map((it, idx) => idx === index ? {
        ...it,
        status: 'completed',
        progress: 100,
        compressedSize: compressionResult.blob.size,
        compressedUrl,
        width: w,
        height: h
      } : it));

      // Trigger next pass in chain
      setCurrentIdx(index + 1);
    } catch (e: any) {
      setItems(prev => prev.map((it, idx) => idx === index ? {
        ...it,
        status: 'failed',
        progress: 0,
        error: e.message || 'Processing failed'
      } : it));
      setCurrentIdx(index + 1);
    }
  };

  const toggleRun = () => {
    setIsRunning(!isRunning);
  };

  // ZIP Compiler: Bundles all completed processed files into a single structured .zip and triggers a browser download dialog
  const downloadZip = async () => {
    const completed = items.filter(it => it.status === 'completed' && it.compressedUrl);
    if (completed.length === 0) return;

    const zip = new JSZip();

    for (const item of completed) {
      const res = await fetch(item.compressedUrl!);
      const blob = await res.blob();
      
      // Determine file extension
      const ext = format === 'png' ? 'png' : format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'avif';
      
      // Clean original extension if present
      const cleanName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
      const fileName = `${prefix}${cleanName}.${ext}`;

      zip.file(fileName, blob);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);
    
    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = `imageforge_batch_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(zipUrl);
  };

  const getSavings = (orig: number, comp: number) => {
    const diff = orig - comp;
    if (diff <= 0) return '0%';
    return `${Math.round((diff / orig) * 100)}%`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 h-full bg-gray-950 text-gray-100 font-sans relative" id="batch_processor_root">
      {isHeicConverting && (
        <div className="fixed inset-0 bg-gray-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-[100] gap-3">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
          <div className="text-xs font-mono uppercase tracking-widest text-indigo-400 font-semibold animate-pulse">
            Converting HEIC Images...
          </div>
        </div>
      )}
      {/* Sidebar Batch Controls */}
      <div className="lg:col-span-1 bg-gray-900 border border-gray-800 p-4 rounded-xl flex flex-col gap-5 text-left h-fit">
        <div>
          <h2 className="text-sm font-bold text-indigo-400 uppercase tracking-widest font-mono flex items-center gap-2">
            <Layers className="w-4 h-4" /> Batch Options
          </h2>
          <p className="text-[10px] text-gray-500 mt-1 font-mono uppercase">Configure common operations</p>
        </div>

        {/* Name prefix */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider font-mono">Filename Prefix</label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 font-mono"
            placeholder="optimized_"
          />
        </div>

        {/* Format Select */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider font-mono">Output Format</label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as any)}
            className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 font-mono"
          >
            <option value="webp">WEBP (Highly Recommended)</option>
            <option value="jpeg">JPEG (Standard Lossy)</option>
            <option value="png">PNG (Lossless Optimization)</option>
            <option value="avif">AVIF (Ultra High Quality)</option>
          </select>
        </div>

        {/* Quality / Size toggle */}
        <div className="space-y-4 border-t border-gray-800/80 pt-4">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider font-mono">Compression Mode</label>
            <button
              onClick={() => setTargetSizeKb(targetSizeKb === null ? 200 : null)}
              className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 font-mono underline"
            >
              {targetSizeKb === null ? 'Set Target Size' : 'Set Quality Slider'}
            </button>
          </div>

          {targetSizeKb === null ? (
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[11px] font-mono text-gray-400">
                <span>QUALITY</span>
                <div className="flex items-center gap-0.5">
                  <input
                    type="number"
                    min="5"
                    max="100"
                    value={quality}
                    onChange={(e) => {
                      if (e.target.value === '') return;
                      let val = Math.round(Number(e.target.value));
                      if (isNaN(val)) return;
                      if (val < 5) val = 5;
                      if (val > 100) val = 100;
                      setQuality(val);
                    }}
                    onBlur={(e) => {
                      let val = Math.round(Number(e.target.value));
                      if (isNaN(val)) val = 80;
                      let clamped = Math.max(5, Math.min(100, val));
                      setQuality(clamped);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-12 text-right bg-gray-950 border border-gray-800/80 focus:border-indigo-500/80 rounded px-1 py-0.5 text-[11px] font-bold text-indigo-400 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-gray-500 font-bold">%</span>
                </div>
              </div>
              <input
                type="range"
                min="5"
                max="100"
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider font-mono">Target File Size (KB)</label>
              <input
                type="number"
                value={targetSizeKb}
                onChange={(e) => setTargetSizeKb(Number(e.target.value))}
                className="w-full bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 font-mono"
                min="10"
                max="10000"
              />
            </div>
          )}
        </div>

        {/* Common resize factor */}
        <div className="space-y-2 border-t border-gray-800/80 pt-4">
          <div className="flex justify-between items-center text-[11px] font-mono text-gray-400">
            <span>RESIZE SCALE</span>
            <div className="flex items-center gap-0.5">
              <input
                type="number"
                min="10"
                max="100"
                step="5"
                value={scale}
                onChange={(e) => {
                  if (e.target.value === '') return;
                  let val = Math.round(Number(e.target.value));
                  if (isNaN(val)) return;
                  if (val < 10) val = 10;
                  if (val > 100) val = 100;
                  setScale(val);
                }}
                onBlur={(e) => {
                  let val = Math.round(Number(e.target.value));
                  if (isNaN(val)) val = 100;
                  let clamped = Math.max(10, Math.min(100, val));
                  setScale(clamped);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-12 text-right bg-gray-950 border border-gray-800/80 focus:border-indigo-500/80 rounded px-1 py-0.5 text-[11px] font-bold text-indigo-400 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-gray-500 font-bold">%</span>
            </div>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            className="w-full h-1 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>

        {/* Actions panel */}
        <div className="flex flex-col gap-2 border-t border-gray-800/80 pt-4 mt-auto">
          {items.length > 0 && (
            <button
              onClick={toggleRun}
              className={`w-full font-bold text-xs py-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-lg transition active:scale-95 cursor-pointer ${
                isRunning ? 'bg-amber-600 hover:bg-amber-500' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isRunning ? 'Pause Processing' : 'Run Batch Optimize'}
            </button>
          )}

          {items.filter(it => it.status === 'completed').length > 0 && (
            <button
              onClick={downloadZip}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-lg transition active:scale-95 cursor-pointer"
            >
              <FolderDown className="w-4 h-4" /> Download All as ZIP
            </button>
          )}

          {items.length > 0 && (
            <button
              onClick={clearAll}
              className="w-full bg-transparent hover:bg-red-950/20 text-red-400 border border-red-950/60 font-semibold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear All Files
            </button>
          )}
        </div>
      </div>

      {/* Main Upload Arena and Process Grid */}
      <div className="lg:col-span-3 flex flex-col gap-4">
        {/* Upload Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="bg-gray-900 border-2 border-dashed border-gray-800 hover:border-indigo-500/50 rounded-xl p-8 flex flex-col items-center justify-center gap-2 cursor-pointer group transition duration-200 text-center"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFilesUpload}
            multiple
            accept="image/*,.heic,.heif"
            className="hidden"
          />
          <FileImage className="w-12 h-12 text-gray-600 group-hover:text-indigo-400 transition" />
          <div className="text-xs font-bold text-gray-300">Drag and drop multiple photos here</div>
          <div className="text-[10px] text-gray-500 font-mono uppercase">Supports bulk JPG, PNG, WEBP, AVIF</div>
        </div>

        {/* Files processing list card view */}
        <div className="flex-grow bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-3">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest font-mono">
              Batch Process Queue ({items.length} Files)
            </span>
            <div className="text-[10px] text-gray-500 font-mono">
              {items.filter(it => it.status === 'completed').length} / {items.length} COMPLETED
            </div>
          </div>

          {items.length === 0 ? (
            <div className="flex-grow flex flex-col items-center justify-center gap-2 text-gray-600 font-mono text-xs py-20">
              <Layers className="w-10 h-10 text-gray-800" />
              <span>Queue is empty. Add some photos to batch optimize.</span>
            </div>
          ) : (
            <div className="overflow-y-auto space-y-2 flex-grow max-h-[400px] pr-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="bg-gray-950 border border-gray-800 rounded-lg p-2.5 flex items-center justify-between gap-4 group transition-colors hover:border-gray-700"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={item.thumbnailUrl}
                      className="w-10 h-10 object-cover rounded bg-gray-900 border border-gray-800"
                      alt={item.name}
                    />
                    <div className="text-left min-w-0">
                      <div className="text-xs font-semibold text-gray-200 truncate max-w-xs">{item.name}</div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {(item.size / 1024).toFixed(1)} KB
                        {item.width > 0 && ` • ${item.width}x${item.height} px`}
                      </div>
                    </div>
                  </div>

                  {/* Progress bar / Status */}
                  <div className="flex items-center gap-4">
                    {item.status === 'pending' && (
                      <span className="text-[10px] text-gray-500 font-semibold font-mono bg-gray-900 px-2 py-0.5 rounded border border-gray-800 uppercase">
                        Pending
                      </span>
                    )}

                    {item.status === 'processing' && (
                      <div className="flex flex-col items-end gap-1 w-24">
                        <span className="text-[10px] text-indigo-400 font-mono uppercase font-bold animate-pulse">
                          Optimizing {item.progress}%
                        </span>
                        <div className="w-full bg-gray-900 rounded-full h-1.5 overflow-hidden border border-gray-800">
                          <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${item.progress}%` }} />
                        </div>
                      </div>
                    )}

                    {item.status === 'completed' && item.compressedSize && (
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-[10px] text-emerald-400 font-bold font-mono">
                            {(item.compressedSize / 1024).toFixed(1)} KB
                          </div>
                          <div className="text-[9px] text-gray-500 font-mono">
                            Saved {getSavings(item.size, item.compressedSize)}
                          </div>
                        </div>
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                      </div>
                    )}

                    {item.status === 'failed' && (
                      <span className="text-[10px] text-red-400 font-mono font-bold bg-red-950/20 border border-red-950 px-2 py-0.5 rounded" title={item.error}>
                        Failed
                      </span>
                    )}

                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-gray-500 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition"
                      title="Remove file"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
