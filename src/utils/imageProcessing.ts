/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EditorAdjustments } from '../types';

// Helper to clamp values to 0-255
export function clamp(val: number): number {
  return Math.max(0, Math.min(255, val));
}

// Fast integer clamp without function call overhead — used in hot loops
function clamp255(val: number): number {
  return val < 0 ? 0 : (val > 255 ? 255 : val);
}

// Cubic Spline Interpolation for Tone Curves
export function getCurveLUT(points: { x: number; y: number }[]): Uint8Array {
  const lut = new Uint8Array(256);
  // Sort points by x-coordinate just in case
  const sorted = [...points].sort((a, b) => a.x - b.x);

  // If we have less than 2 points, make a linear map
  if (sorted.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }

  // Linear or cubic interpolation
  // For a simple, ultra-fast and robust implementation, we can use monotone cubic spline or linear interpolation.
  // Let's implement linear interpolation between sorted points first, then apply a moving average filter to smooth it out.
  // This is highly robust and avoids wild oscillations (Runge's phenomenon).
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

  // Smooth the LUT using a Gaussian moving window (radius 4) for professional smooth curves
  for (let i = 0; i < 256; i++) {
    let sum = 0;
    let count = 0;
    const radius = 3;
    for (let j = -radius; j <= radius; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < 256) {
        // Weighted by distance
        const weight = 1 / (1 + Math.abs(j));
        sum += raw[idx] * weight;
        count += weight;
      }
    }
    lut[i] = clamp(Math.round(sum / count));
  }

  return lut;
}

// Convert Hex to RGB
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const fullHex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 255, g: 255, b: 255 };
}

// Calculate Histogram of ImageData
export interface HistogramData {
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
}

export function calculateHistogram(imageData: ImageData): HistogramData {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const luma = new Array(256).fill(0);
  
  const data = imageData.data;
  const len = data.length;

  for (let i = 0; i < len; i += 4) {
    const rv = data[i];
    const gv = data[i+1];
    const bv = data[i+2];
    const lv = Math.round(0.299 * rv + 0.587 * gv + 0.114 * bv);

    r[rv]++;
    g[gv]++;
    b[bv]++;
    luma[lv]++;
  }

  return { r, g, b, luma };
}

/**
 * Pre-compute a combined exposure + brightness + contrast lookup table.
 * Instead of doing 3 floating-point operations per channel per pixel,
 * we do a single LUT lookup. This is 3x faster for the most common adjustments.
 */
function buildToneLUT(expFactor: number, brightFactor: number, contrFactor: number): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let val = i * expFactor;       // Exposure
    val += brightFactor;           // Brightness
    val = contrFactor * (val - 128) + 128; // Contrast
    lut[i] = clamp255(Math.round(val));
  }
  return lut;
}

// Core adjustment function running pixel-by-pixel on ImageData
export function applyAdjustmentsToImageData(
  imageData: ImageData,
  adj: EditorAdjustments
): void {
  const data = imageData.data;
  const len = data.length;
  const width = imageData.width;
  const height = imageData.height;

  // 1. Exposure and Tone Factor
  // exposure goes -100 to 100, maps to multipliers 0.25 to 4.0
  const expFactor = Math.pow(2, adj.exposure / 50);
  const brightFactor = adj.brightness * 1.5; // -150 to 150
  
  // contrast factor
  const contrFactor = (259 * (adj.contrast * 1.2 + 255)) / (255 * (259 - adj.contrast * 1.2));

  // Pre-compute combined tone LUT for exposure+brightness+contrast
  // This replaces 3 per-pixel floating-point operations with a single lookup
  const needsTone = adj.exposure !== 0 || adj.brightness !== 0 || adj.contrast !== 0;
  const toneLUT = needsTone ? buildToneLUT(expFactor, brightFactor, contrFactor) : null;

  // Temperature / Tint offsets
  const tempOffset = adj.temperature * 0.4; // -40 to 40
  const tintOffset = adj.tint * 0.4;       // -40 to 40

  // Saturation & Vibrance Factor
  const satFactor = 1 + adj.saturation / 100;
  const vibFactor = adj.vibrance / 100;
  const hueRadians = (adj.hue * Math.PI) / 180;
  const hueCos = Math.cos(hueRadians);
  const hueSin = Math.sin(hueRadians);

  // Levels Calculations & LUT precomputation
  const minInput = adj.levelsMin;
  const maxInput = adj.levelsMax;
  const gamma = adj.levelsGamma;
  
  const hasLevels = minInput > 0 || maxInput < 255 || gamma !== 1.0;
  let levelsLUT: Uint8Array | null = null;
  if (hasLevels) {
    levelsLUT = new Uint8Array(256);
    const range = Math.max(1, maxInput - minInput);
    for (let j = 0; j < 256; j++) {
      const norm = Math.max(0, Math.min(1, (j - minInput) / range));
      levelsLUT[j] = Math.max(0, Math.min(255, Math.round(Math.pow(norm, 1 / gamma) * 255)));
    }
  }

  // Curves LUT
  const curvesLUT = getCurveLUT(adj.curvesPoints);

  // Check if curves is identity (default) — skip if so
  let curvesIsIdentity = true;
  for (let i = 0; i < 256; i++) {
    if (curvesLUT[i] !== i) { curvesIsIdentity = false; break; }
  }

  // Posterize factor
  const postStep = adj.posterize ? 255 / (adj.posterizeLevels - 1) : 1;

  // Optimize Vignette constant factors
  const halfW = width / 2;
  const halfH = height / 2;
  const vignetteCoeff = adj.vignette / 120;

  // Pre-check which stages are active so we can skip entire blocks
  const hasHighlights = adj.highlights !== 0;
  const hasShadows = adj.shadows !== 0;
  const hasTemp = adj.temperature !== 0;
  const hasTint = adj.tint !== 0;
  const hasHue = adj.hue !== 0;
  const hasVibrance = vibFactor !== 0;
  const hasSaturation = satFactor !== 1;
  const hasVignette = adj.vignette > 0;

  let px = 0;
  let py = 0;

  for (let i = 0; i < len; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const a = data[i + 3];

    if (a === 0) {
      px++;
      if (px === width) {
        px = 0;
        py++;
      }
      continue; // Skip fully transparent
    }

    // --- 1. Basic Exposure, Contrast, Brightness via LUT ---
    if (toneLUT) {
      r = toneLUT[r];
      g = toneLUT[g];
      b = toneLUT[b];
    }

    // --- 2. Highlights & Shadows ---
    if (hasHighlights || hasShadows) {
      // Simple shadows/highlights adjustment using a threshold
      const lumaValue = 0.299 * r + 0.587 * g + 0.114 * b;
      
      if (hasHighlights) {
        // Highlights affects lighter pixels (luma > 128)
        const highWeight = lumaValue > 128 ? (lumaValue - 128) / 128 : 0;
        const highFactor = 1 + (adj.highlights / 100) * highWeight * 0.5;
        r *= highFactor;
        g *= highFactor;
        b *= highFactor;
      }

      if (hasShadows) {
        // Shadows affects darker pixels (luma < 128)
        const shadowWeight = lumaValue < 128 ? (128 - lumaValue) / 128 : 0;
        const shadowFactor = 1 + (adj.shadows / 100) * shadowWeight * 0.5;
        r *= shadowFactor;
        g *= shadowFactor;
        b *= shadowFactor;
      }
    }

    // --- 3. Levels Adjustments (Min, Max, Gamma) ---
    if (levelsLUT) {
      r = levelsLUT[clamp255(Math.round(r))];
      g = levelsLUT[clamp255(Math.round(g))];
      b = levelsLUT[clamp255(Math.round(b))];
    }

    // --- 4. Curves splines ---
    if (!curvesIsIdentity) {
      r = curvesLUT[clamp255(Math.round(r))];
      g = curvesLUT[clamp255(Math.round(g))];
      b = curvesLUT[clamp255(Math.round(b))];
    }

    // --- 5. White Balance (Temperature and Tint) ---
    if (hasTemp) {
      // Temperature: warm increases yellow (red/green), cool increases blue
      r += tempOffset;
      g += tempOffset * 0.5;
      b -= tempOffset;
    }

    if (hasTint) {
      // Tint: green vs magenta (red/blue)
      r -= tintOffset * 0.5;
      g += tintOffset;
      b -= tintOffset * 0.5;
    }

    // Hue rotation in YIQ color space. Unlike a channel swap this preserves
    // perceived luminance while rotating only the chroma component.
    if (hasHue) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const iq_i = 0.596 * r - 0.275 * g - 0.321 * b;
      const q = 0.212 * r - 0.523 * g + 0.311 * b;
      const rotatedI = iq_i * hueCos - q * hueSin;
      const rotatedQ = iq_i * hueSin + q * hueCos;
      r = y + 0.956 * rotatedI + 0.621 * rotatedQ;
      g = y - 0.272 * rotatedI - 0.647 * rotatedQ;
      b = y - 1.106 * rotatedI + 1.703 * rotatedQ;
    }

    // --- 6. Saturation & Vibrance ---
    let luma = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // Vibrance adjustment: affects desaturated colors more than saturated ones
    if (hasVibrance) {
      let maxVal = r;
      if (g > maxVal) maxVal = g;
      if (b > maxVal) maxVal = b;
      let minVal = r;
      if (g < minVal) minVal = g;
      if (b < minVal) minVal = b;

      const sat = maxVal === 0 ? 0 : (maxVal - minVal) / maxVal;
      const vibAmt = vibFactor * (1 - sat) * 1.5;
      r += (r - luma) * vibAmt;
      g += (g - luma) * vibAmt;
      b += (b - luma) * vibAmt;
    }

    // Saturation
    if (hasSaturation) {
      r = luma + (r - luma) * satFactor;
      g = luma + (g - luma) * satFactor;
      b = luma + (b - luma) * satFactor;
    }

    // --- 7. Color Presets & FX ---
    // Grayscale
    if (adj.grayscale) {
      luma = 0.299 * r + 0.587 * g + 0.114 * b;
      r = luma;
      g = luma;
      b = luma;
    }

    // Sepia
    if (adj.sepia) {
      const tr = 0.393 * r + 0.769 * g + 0.189 * b;
      const tg = 0.349 * r + 0.686 * g + 0.168 * b;
      const tb = 0.272 * r + 0.534 * g + 0.131 * b;
      r = tr;
      g = tg;
      b = tb;
    }

    // Invert
    if (adj.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    // Threshold
    if (adj.threshold) {
      const avg = (r + g + b) / 3;
      const thresholdVal = adj.thresholdVal;
      const finalVal = avg >= thresholdVal ? 255 : 0;
      r = finalVal;
      g = finalVal;
      b = finalVal;
    }

    // Posterize
    if (adj.posterize) {
      r = Math.round(r / postStep) * postStep;
      g = Math.round(g / postStep) * postStep;
      b = Math.round(b / postStep) * postStep;
    }

    // Vignette effect
    if (hasVignette) {
      // Distance from center of image, normalized to 0-1
      const dx = (px - halfW) / halfW;
      const dy = (py - halfH) / halfH;
      const distSq = dx * dx + dy * dy; // 0 at center, up to 2 at corners

      // Vignette factor: darker at edges
      const clampedDistSq = distSq > 1 ? 1 : distSq;
      const vignetteFactor = 1 - vignetteCoeff * clampedDistSq;
      r *= vignetteFactor;
      g *= vignetteFactor;
      b *= vignetteFactor;
    }

    // Clamp and write back — single final clamp instead of intermediate ones
    const rRound = Math.round(r);
    const gRound = Math.round(g);
    const bRound = Math.round(b);
    data[i] = rRound < 0 ? 0 : (rRound > 255 ? 255 : rRound);
    data[i + 1] = gRound < 0 ? 0 : (gRound > 255 ? 255 : gRound);
    data[i + 2] = bRound < 0 ? 0 : (bRound > 255 ? 255 : bRound);

    px++;
    if (px === width) {
      px = 0;
      py++;
    }
  }

  // Denoise before detail enhancement. A low-radius blur blended with the
  // source reduces sensor noise without turning the complete image soft.
  if (adj.denoise > 0) {
    const original = new Uint8ClampedArray(imageData.data);
    applyFastBlur(imageData, Math.max(1, Math.round(adj.denoise * 0.35)));
    const mix = Math.min(0.75, adj.denoise / 140);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(original[i] * (1 - mix) + data[i] * mix);
      data[i + 1] = Math.round(original[i + 1] * (1 - mix) + data[i + 1] * mix);
      data[i + 2] = Math.round(original[i + 2] * (1 - mix) + data[i + 2] * mix);
    }
  }

  // --- 8. Box/Gaussian Blur filter ---
  if (adj.blur > 0) {
    applyFastBlur(imageData, adj.blur);
  }

  // --- 9. Local contrast / sharpness filter ---
  if (adj.clarity > 0) {
    applySharpen(imageData, Math.min(100, adj.clarity * 0.55));
  } else if (adj.clarity < 0) {
    applyFastBlur(imageData, Math.min(30, Math.abs(adj.clarity) * 0.35));
  }
  if (adj.sharpness > 0) {
    applySharpen(imageData, adj.sharpness);
  }
}

/**
 * Reusable buffer pool to avoid repeated allocations for blur/sharpen.
 * For a given pixel count, we cache the buffer and reuse it.
 */
let _sharedBufferA: Uint8ClampedArray | null = null;
let _sharedBufferB: Uint8ClampedArray | null = null;
let _sharedBufferSize = 0;

function getSharedBuffers(size: number): [Uint8ClampedArray, Uint8ClampedArray] {
  if (_sharedBufferSize !== size || !_sharedBufferA || !_sharedBufferB) {
    _sharedBufferA = new Uint8ClampedArray(size);
    _sharedBufferB = new Uint8ClampedArray(size);
    _sharedBufferSize = size;
  }
  return [_sharedBufferA, _sharedBufferB];
}

// Fast Horizontal & Vertical Box Blur passes to simulate high-quality Gaussian Blur (O(N) operation)
export function applyFastBlur(imageData: ImageData, radius: number): void {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  // Map slider value 1-100 to actual blur radius 1-15
  const r = clamp(Math.round((radius / 100) * 15));
  if (r <= 0) return;

  // Reuse shared buffers instead of allocating new ones each call
  const [buffer] = getSharedBuffers(data.length);
  boxBlur(data, buffer, width, height, r);
  boxBlur(buffer, data, width, height, r); // Second pass makes it more Gaussian
}

/**
 * Optimized box blur — uses a single shared temp buffer instead of allocating
 * a new one per call. The temp buffer is passed from the caller's pool.
 */
function boxBlur(
  src: Uint8ClampedArray,
  dest: Uint8ClampedArray,
  w: number,
  h: number,
  r: number
): void {
  // We need a temporary buffer to hold the intermediate horizontal blur result.
  // Use the second shared buffer from our pool.
  const [, temp] = getSharedBuffers(src.length);

  const diam = 2 * r + 1;
  const invDiam = 1 / diam; // Multiply instead of divide in inner loop
  
  // 1. Horizontal Pass (src -> temp)
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w * 4;
    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
    
    // Initialize sum of the window from -r to r
    for (let k = -r; k <= r; k++) {
      const xIdx = k < 0 ? 0 : (k >= w ? w - 1 : k);
      const idx = rowOffset + xIdx * 4;
      rSum += src[idx];
      gSum += src[idx + 1];
      bSum += src[idx + 2];
      aSum += src[idx + 3];
    }
    
    // Write first pixel
    temp[rowOffset] = (rSum * invDiam + 0.5) | 0;
    temp[rowOffset + 1] = (gSum * invDiam + 0.5) | 0;
    temp[rowOffset + 2] = (bSum * invDiam + 0.5) | 0;
    temp[rowOffset + 3] = (aSum * invDiam + 0.5) | 0;
    
    // Slide horizontally
    for (let x = 1; x < w; x++) {
      const outX = (x - r - 1) < 0 ? 0 : (x - r - 1);
      const outIdx = rowOffset + outX * 4;
      
      const inX = (x + r) >= w ? w - 1 : (x + r);
      const inIdx = rowOffset + inX * 4;
      
      rSum += src[inIdx] - src[outIdx];
      gSum += src[inIdx + 1] - src[outIdx + 1];
      bSum += src[inIdx + 2] - src[outIdx + 2];
      aSum += src[inIdx + 3] - src[outIdx + 3];
      
      const destIdx = rowOffset + x * 4;
      temp[destIdx] = (rSum * invDiam + 0.5) | 0;
      temp[destIdx + 1] = (gSum * invDiam + 0.5) | 0;
      temp[destIdx + 2] = (bSum * invDiam + 0.5) | 0;
      temp[destIdx + 3] = (aSum * invDiam + 0.5) | 0;
    }
  }
  
  // 2. Vertical Pass (temp -> dest)
  for (let x = 0; x < w; x++) {
    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
    
    // Initialize sum of the window from -r to r
    for (let k = -r; k <= r; k++) {
      const yIdx = k < 0 ? 0 : (k >= h ? h - 1 : k);
      const idx = (yIdx * w + x) * 4;
      rSum += temp[idx];
      gSum += temp[idx + 1];
      bSum += temp[idx + 2];
      aSum += temp[idx + 3];
    }
    
    // Write first pixel of column
    const startIdx = x * 4;
    dest[startIdx] = (rSum * invDiam + 0.5) | 0;
    dest[startIdx + 1] = (gSum * invDiam + 0.5) | 0;
    dest[startIdx + 2] = (bSum * invDiam + 0.5) | 0;
    dest[startIdx + 3] = (aSum * invDiam + 0.5) | 0;
    
    // Slide vertically
    for (let y = 1; y < h; y++) {
      const outY = (y - r - 1) < 0 ? 0 : (y - r - 1);
      const outIdx = (outY * w + x) * 4;
      
      const inY = (y + r) >= h ? h - 1 : (y + r);
      const inIdx = (inY * w + x) * 4;
      
      rSum += temp[inIdx] - temp[outIdx];
      gSum += temp[inIdx + 1] - temp[outIdx + 1];
      bSum += temp[inIdx + 2] - temp[outIdx + 2];
      aSum += temp[inIdx + 3] - temp[outIdx + 3];
      
      const destIdx = (y * w + x) * 4;
      dest[destIdx] = (rSum * invDiam + 0.5) | 0;
      dest[destIdx + 1] = (gSum * invDiam + 0.5) | 0;
      dest[destIdx + 2] = (bSum * invDiam + 0.5) | 0;
      dest[destIdx + 3] = (aSum * invDiam + 0.5) | 0;
    }
  }
}

// 3x3 Convolution Sharpening — reuses shared buffer instead of allocating
export function applySharpen(imageData: ImageData, amount: number): void {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  const factor = amount / 100; // 0 to 1
  const f = factor;
  const c = 1 + 4 * f;

  // Reuse shared buffer instead of allocating a new copy
  const [temp] = getSharedBuffers(data.length);
  temp.set(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;

      const idxTop = ((y - 1) * width + x) * 4;
      const idxBot = ((y + 1) * width + x) * 4;
      const idxLeft = (y * width + x - 1) * 4;
      const idxRight = (y * width + x + 1) * 4;

      for (let ch = 0; ch < 3; ch++) {
        const val =
          c * temp[idx + ch] -
          f * (temp[idxTop + ch] + temp[idxBot + ch] + temp[idxLeft + ch] + temp[idxRight + ch]);

        const rounded = (val + 0.5) | 0; // Faster than Math.round
        data[idx + ch] = rounded < 0 ? 0 : (rounded > 255 ? 255 : rounded);
      }
    }
  }
}
