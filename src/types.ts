/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ImageMetadata {
  name: string;
  size: number;
  type: string;
  width: number;
  height: number;
  lastModified: number;
  exif?: {
    camera?: string;
    lens?: string;
    iso?: string;
    exposureTime?: string;
    fNumber?: string;
    focalLength?: string;
    dateTaken?: string;
    gps?: {
      latitude: number;
      longitude: number;
    } | null;
  };
}

export type AppMode =
  | 'home'
  | 'editor'
  | 'crop'
  | 'bg-remover'
  | 'white-bg'
  | 'passport'
  | 'compress'
  | 'convert'
  | 'batch'
  | 'metadata';

export interface EditorAdjustments {
  // Exposure & Tone
  exposure: number;      // -100 to 100
  brightness: number;    // -100 to 100
  contrast: number;      // -100 to 100
  highlights: number;    // -100 to 100
  shadows: number;       // -100 to 100
  
  // Color
  temperature: number;   // -100 to 100 (blue to yellow)
  tint: number;          // -100 to 100 (green to magenta)
  saturation: number;    // -100 to 100
  hue: number;           // -180 to 180
  vibrance: number;      // -100 to 100

  // Detail & Effects
  sharpness: number;     // 0 to 100
  clarity: number;       // -100 to 100
  denoise: number;       // 0 to 100
  blur: number;          // 0 to 100 (gaussian blur radius)
  vignette: number;      // 0 to 100

  // Color Filters & Presets
  grayscale: boolean;
  sepia: boolean;
  invert: boolean;
  threshold: boolean;
  thresholdVal: number;  // 0 to 255
  posterize: boolean;
  posterizeLevels: number; // 2 to 20

  // Canvas Transform
  rotate: number;        // 0, 90, 180, 270 or any angle
  flipH: boolean;
  flipV: boolean;
  
  // Advanced Curves and Levels
  curvesPoints: { x: number; y: number }[]; // Tone curves graph points, default [0,0, 128,128, 255,255]
  levelsMin: number;     // Black point 0-255
  levelsMax: number;     // White point 0-255
  levelsGamma: number;   // Midtones 0.1-10.0
}

export const DEFAULT_ADJUSTMENTS: EditorAdjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  hue: 0,
  vibrance: 0,
  sharpness: 0,
  clarity: 0,
  denoise: 0,
  blur: 0,
  vignette: 0,
  grayscale: false,
  sepia: false,
  invert: false,
  threshold: false,
  thresholdVal: 128,
  posterize: false,
  posterizeLevels: 4,
  rotate: 0,
  flipH: false,
  flipV: false,
  curvesPoints: [
    { x: 0, y: 0 },
    { x: 128, y: 128 },
    { x: 255, y: 255 }
  ],
  levelsMin: 0,
  levelsMax: 255,
  levelsGamma: 1.0,
};

export interface CropSettings {
  aspectRatio: number | null; // width / height, null for free aspect
  aspectName: string;         // 'Custom', '1:1', '16:9', etc.
  shape: 'rect' | 'circle' | 'oval' | 'triangle' | 'polygon' | 'heart' | 'star';
  sides?: number;             // For polygons
  customWidth: number;
  customHeight: number;
}

export type BackgroundRemovalType = 'transparent' | 'solid' | 'gradient' | 'blur' | 'image';

export interface BackgroundRemovalSettings {
  type: BackgroundRemovalType;
  solidColor: string;
  gradientStart: string;
  gradientEnd: string;
  bgImageUrl: string | null;
  blurRadius: number;
  tolerance: number;          // 0 to 100
  colorKey: string;           // hex color or '#ffffff'
  feather: number;            // 0 to 20
  grow: number;               // -10 to 10 (shrink/grow mask)
  brushMode: 'erase' | 'restore' | 'none';
  brushSize: number;          // 5 to 100
  brushHardness: number;      // 0 to 100
}

export const DEFAULT_BG_REMOVAL_SETTINGS: BackgroundRemovalSettings = {
  type: 'transparent',
  solidColor: '#ffffff',
  gradientStart: '#111827',
  gradientEnd: '#4b5563',
  bgImageUrl: null,
  blurRadius: 10,
  tolerance: 15,
  colorKey: '#ffffff',
  feather: 2,
  grow: 0,
  brushMode: 'none',
  brushSize: 30,
  brushHardness: 50,
};

export interface PassportPreset {
  id: string;
  country: string;
  name: string;
  widthMm: number;
  heightMm: number;
  widthPx: number; // calculated standard at 300dpi
  heightPx: number;
  regulations: string[];
}

export const PASSPORT_PRESETS: PassportPreset[] = [
  {
    id: 'usa',
    country: 'United States',
    name: 'US Passport / Visa (2x2")',
    widthMm: 51,
    heightMm: 51,
    widthPx: 600,
    heightPx: 600,
    regulations: [
      'Square aspect ratio (2x2 inches)',
      'Head must be between 1" and 1 3/8" (25-35mm) from bottom of chin to top of hair',
      'Plain white or off-white background'
    ]
  },
  {
    id: 'india',
    country: 'India',
    name: 'India Passport (2x2")',
    widthMm: 51,
    heightMm: 51,
    widthPx: 600,
    heightPx: 600,
    regulations: [
      'Square photo format (51x51mm)',
      'Head height should be 35mm to 40mm (70-80%)',
      'Light colored background, plain white preferred'
    ]
  },
  {
    id: 'uk',
    country: 'United Kingdom',
    name: 'UK Passport (35x45mm)',
    widthMm: 35,
    heightMm: 45,
    widthPx: 413,
    heightPx: 531,
    regulations: [
      '35mm wide by 45mm high',
      'Head height between 29mm and 34mm',
      'Plain light-grey or cream background'
    ]
  },
  {
    id: 'canada',
    country: 'Canada',
    name: 'Canada Passport (50x70mm)',
    widthMm: 50,
    heightMm: 70,
    widthPx: 591,
    heightPx: 827,
    regulations: [
      '50mm wide by 70mm high',
      'Head size between 31mm and 36mm from chin to crown',
      'Plain white or light-coloured background'
    ]
  },
  {
    id: 'australia',
    country: 'Australia',
    name: 'Australia Passport (35x45mm)',
    widthMm: 35,
    heightMm: 45,
    widthPx: 413,
    heightPx: 531,
    regulations: [
      '35mm wide by 45mm high',
      'Head size between 32mm and 36mm',
      'Plain white or light grey background, uniform lighting'
    ]
  },
  {
    id: 'japan',
    country: 'Japan',
    name: 'Japan Passport (35x45mm)',
    widthMm: 35,
    heightMm: 45,
    widthPx: 413,
    heightPx: 531,
    regulations: [
      '35mm wide by 45mm high',
      'Head size between 32mm and 36mm',
      'Solid plain background, light colored'
    ]
  },
  {
    id: 'germany',
    country: 'Germany / Schengen',
    name: 'Schengen Visa (35x45mm)',
    widthMm: 35,
    heightMm: 45,
    widthPx: 413,
    heightPx: 531,
    regulations: [
      'Standard Schengen dimensions (35x45mm)',
      'Centred biometrical face alignment',
      'Background neutral grey or white'
    ]
  },
  {
    id: 'singapore',
    country: 'Singapore',
    name: 'Singapore Passport (35x45mm)',
    widthMm: 35,
    heightMm: 45,
    widthPx: 413,
    heightPx: 531,
    regulations: [
      '35mm wide by 45mm high',
      'Face size must be 25mm to 35mm from chin to crown',
      'Plain white background, matte finish'
    ]
  }
];

export interface CompressionSettings {
  format: 'png' | 'jpeg' | 'webp' | 'avif';
  quality: number;              // 1 to 100
  targetSizeKb: number | null;  // Or desired target file size (e.g. 100)
  preserveMetadata: boolean;
  preset: 'max-quality' | 'balanced' | 'small-file' | 'custom';
}

export const DEFAULT_COMPRESSION_SETTINGS: CompressionSettings = {
  format: 'webp',
  quality: 80,
  targetSizeKb: null,
  preserveMetadata: false,
  preset: 'balanced',
};

export interface EditorProject {
  id: string;
  name: string;
  originalUrl: string;          // Source image data URI or object URL
  currentUrl: string;           // Edited version URL
  metadata: ImageMetadata;
  adjustments: EditorAdjustments;
  createdAt: number;
}

export interface ExportHistoryItem {
  id: string;
  name: string;
  originalSize: number;
  compressedSize: number;
  format: string;
  quality: number;
  timestamp: number;
  imageUrl: string;
}

export interface BatchItem {
  id: string;
  file: File;
  name: string;
  size: number;
  width: number;
  height: number;
  thumbnailUrl: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  compressedSize?: number;
  compressedUrl?: string;
}
