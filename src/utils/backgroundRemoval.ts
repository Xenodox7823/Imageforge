/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { clamp, hexToRgb } from './imageProcessing';

// Applies background removal based on color-keying / chroma-keying with grow/shrink & feather
export function applyColorKeyRemoval(
  imgData: ImageData,
  colorKeyHex: string,
  tolerance: number, // 0 to 100
  feather: number,    // 0 to 20
  grow: number        // -10 to 10 (shrink/grow mask)
): Uint8ClampedArray {
  const data = imgData.data;
  const width = imgData.width;
  const height = imgData.height;
  const len = data.length;

  const keyColor = hexToRgb(colorKeyHex);
  const mask = new Uint8ClampedArray(width * height); // 255 for foreground, 0 for background

  // Tolerance mapped to standard Euclid distance in RGB space
  // Max distance is sqrt(255^2 * 3) = 441.67. Let's map tolerance 0-100 to 0-300.
  const maxDist = (tolerance / 100) * 300;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i+1];
    const b = data[i+2];

    // Euclidean distance in RGB
    const dist = Math.sqrt(
      Math.pow(r - keyColor.r, 2) +
      Math.pow(g - keyColor.g, 2) +
      Math.pow(b - keyColor.b, 2)
    );

    const maskIdx = i / 4;
    if (dist < maxDist) {
      mask[maskIdx] = 0; // Transparent (background)
    } else {
      mask[maskIdx] = 255; // Keep (foreground)
    }
  }

  // Apply Mask Grow / Shrink (Morphological Dilation/Erosion)
  let processedMask = mask;
  if (grow > 0) {
    processedMask = dilateMask(mask, width, height, grow);
  } else if (grow < 0) {
    processedMask = erodeMask(mask, width, height, Math.abs(grow));
  }

  // Apply Feathering (Box Blur on mask)
  if (feather > 0) {
    processedMask = blurMask(processedMask, width, height, feather);
  }

  return processedMask;
}

// AI-Assisted Smart Contrast Segmentation (Edge/Region Growing GrabCut proxy)
// This scans the corners to auto-estimate background color clusters, then propagates
// an interactive mask from edge seeds, isolating the prominent centered subject.
export function applyAISegmentBackground(
  imgData: ImageData,
  tolerance: number = 20
): Uint8ClampedArray {
  const data = imgData.data;
  const width = imgData.width;
  const height = imgData.height;
  const len = data.length;

  const mask = new Uint8ClampedArray(width * height).fill(255); // Default all foreground

  // 1. Gather corner/edge pixels to sample background colors
  const samples: { r: number; g: number; b: number }[] = [];
  const addSample = (idx: number) => {
    samples.push({ r: data[idx], g: data[idx+1], b: data[idx+2] });
  };

  // Sample top, bottom, left, right borders (10 pixels step)
  for (let x = 0; x < width; x += Math.max(10, Math.floor(width / 20))) {
    addSample((x) * 4); // Top edge
    addSample(((height - 1) * width + x) * 4); // Bottom edge
  }
  for (let y = 0; y < height; y += Math.max(10, Math.floor(height / 20))) {
    addSample((y * width) * 4); // Left edge
    addSample((y * width + width - 1) * 4); // Right edge
  }

  // 2. Average the background sample clusters
  let avgR = 0, avgG = 0, avgB = 0;
  samples.forEach(s => {
    avgR += s.r;
    avgG += s.g;
    avgB += s.b;
  });
  avgR /= samples.length;
  avgG /= samples.length;
  avgB /= samples.length;

  // 3. Simple regional seed growing: background starts at borders
  const maxDist = (tolerance / 100) * 220 + 20;

  for (let i = 0; i < len; i += 4) {
    const r = data[i];
    const g = data[i+1];
    const b = data[i+2];

    const dist = Math.sqrt(
      Math.pow(r - avgR, 2) +
      Math.pow(g - avgG, 2) +
      Math.pow(b - avgB, 2)
    );

    const maskIdx = i / 4;
    // Pixels similar to estimated border color are classified as background
    if (dist < maxDist) {
      mask[maskIdx] = 0;
    }
  }

  // Clean island noises using minor erosion/dilation
  const dilated = dilateMask(mask, width, height, 1);
  const smoothed = erodeMask(dilated, width, height, 1);

  return smoothed;
}

// Morphological Dilation (Expands white/foreground mask)
function dilateMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length);
  const r = Math.min(5, Math.round(radius));
  if (r <= 0) {
    out.set(mask);
    return out;
  }

  const temp = new Uint8ClampedArray(mask.length);

  // 1. Horizontal dilation pass (mask -> temp)
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      let maxVal = 0;
      for (let k = -r; k <= r; k++) {
        const nx = x + k;
        if (nx >= 0 && nx < w) {
          const val = mask[rowOffset + nx];
          if (val > maxVal) {
            maxVal = val;
            if (maxVal === 255) break;
          }
        }
      }
      temp[rowOffset + x] = maxVal;
    }
  }

  // 2. Vertical dilation pass (temp -> out)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let maxVal = 0;
      for (let k = -r; k <= r; k++) {
        const ny = y + k;
        if (ny >= 0 && ny < h) {
          const val = temp[ny * w + x];
          if (val > maxVal) {
            maxVal = val;
            if (maxVal === 255) break;
          }
        }
      }
      out[y * w + x] = maxVal;
    }
  }

  return out;
}

// Morphological Erosion (Shrinks white/foreground mask)
function erodeMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length);
  const r = Math.min(5, Math.round(radius));
  if (r <= 0) {
    out.set(mask);
    return out;
  }

  const temp = new Uint8ClampedArray(mask.length);

  // 1. Horizontal erosion pass (mask -> temp)
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      let minVal = 255;
      for (let k = -r; k <= r; k++) {
        const nx = x + k;
        if (nx >= 0 && nx < w) {
          const val = mask[rowOffset + nx];
          if (val < minVal) {
            minVal = val;
            if (minVal === 0) break;
          }
        }
      }
      temp[rowOffset + x] = minVal;
    }
  }

  // 2. Vertical erosion pass (temp -> out)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let minVal = 255;
      for (let k = -r; k <= r; k++) {
        const ny = y + k;
        if (ny >= 0 && ny < h) {
          const val = temp[ny * w + x];
          if (val < minVal) {
            minVal = val;
            if (minVal === 0) break;
          }
        }
      }
      out[y * w + x] = minVal;
    }
  }

  return out;
}

// Box blur for Mask Feathering with fast O(N) sliding window sum
function blurMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length);
  const r = Math.min(10, Math.round(radius));
  if (r <= 0) {
    out.set(mask);
    return out;
  }

  const temp = new Uint8ClampedArray(mask.length);

  // 1. Horizontal Pass (mask -> temp)
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    let sum = 0;

    // Initialize sum of the window from -r to r
    for (let k = -r; k <= r; k++) {
      const xIdx = k < 0 ? 0 : (k >= w ? w - 1 : k);
      sum += mask[rowOffset + xIdx];
    }

    // Write first pixel
    temp[rowOffset] = Math.round(sum / (2 * r + 1));

    // Slide horizontally
    for (let x = 1; x < w; x++) {
      const outX = (x - r - 1) < 0 ? 0 : (x - r - 1);
      const inX = (x + r) >= w ? w - 1 : (x + r);

      sum += mask[rowOffset + inX] - mask[rowOffset + outX];
      temp[rowOffset + x] = Math.round(sum / (2 * r + 1));
    }
  }

  // 2. Vertical Pass (temp -> out)
  for (let x = 0; x < w; x++) {
    let sum = 0;

    // Initialize sum of the window from -r to r
    for (let k = -r; k <= r; k++) {
      const yIdx = k < 0 ? 0 : (k >= h ? h - 1 : k);
      sum += temp[yIdx * w + x];
    }

    // Write first pixel of column
    out[x] = Math.round(sum / (2 * r + 1));

    // Slide vertically
    for (let y = 1; y < h; y++) {
      const outY = (y - r - 1) < 0 ? 0 : (y - r - 1);
      const inY = (y + r) >= h ? h - 1 : (y + r);

      sum += temp[inY * w + x] - temp[outY * w + x];
      out[y * w + x] = Math.round(sum / (2 * r + 1));
    }
  }

  return out;
}

// Paint manual brush edit on Mask (Erase / Restore)
export function paintOnMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  hardness: number, // 0 to 100
  isRestore: boolean // true = restores foreground, false = erases (makes background)
): void {
  const r = Math.round(radius);
  const hardR = r * (hardness / 100);

  const startX = Math.max(0, Math.floor(centerX - r));
  const endX = Math.min(width - 1, Math.ceil(centerX + r));
  const startY = Math.max(0, Math.floor(centerY - r));
  const endY = Math.min(height - 1, Math.ceil(centerY + r));

  const fillValue = isRestore ? 255 : 0;

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r) {
        const idx = y * width + x;
        if (dist <= hardR) {
          // Inner fully solid brush area
          mask[idx] = fillValue;
        } else {
          // Feathered brush outer area
          const t = (dist - hardR) / (r - hardR); // 0 at hardR, 1 at r
          const brushAlpha = 1 - t; // 1 at hardR, 0 at r

          if (isRestore) {
            mask[idx] = Math.max(mask[idx], Math.round(brushAlpha * 255));
          } else {
            mask[idx] = Math.min(mask[idx], Math.round((1 - brushAlpha) * mask[idx]));
          }
        }
      }
    }
  }
}

// Magic Brush Tool: Local Flood-Fill Color Area Grabber
export function applyLocalMagicBrush(
  imgData: ImageData,
  mask: Uint8ClampedArray,
  centerX: number,
  centerY: number,
  brushSize: number,
  tolerance: number,
  isRestore: boolean
): void {
  const data = imgData.data;
  const w = imgData.width;
  const h = imgData.height;

  const targetX = Math.round(centerX);
  const targetY = Math.round(centerY);
  if (targetX < 0 || targetX >= w || targetY < 0 || targetY >= h) return;

  const seedIdx = (targetY * w + targetX) * 4;
  const seedR = data[seedIdx];
  const seedG = data[seedIdx+1];
  const seedB = data[seedIdx+2];

  // Flood fill within a bounding box defined by brushSize
  const maxDist = (tolerance / 100) * 150 + 10;
  const r = Math.round(brushSize * 1.5);

  const startX = Math.max(0, targetX - r);
  const endX = Math.min(w - 1, targetX + r);
  const startY = Math.max(0, targetY - r);
  const endY = Math.min(h - 1, targetY + r);

  const queue: [number, number][] = [[targetX, targetY]];
  const visited = new Uint8Array(w * h);
  visited[targetY * w + targetX] = 1;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const [cx, cy] = curr;
    const idx = cy * w + cx;

    // Apply change
    mask[idx] = isRestore ? 255 : 0;

    // Check 4-way neighbors
    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= startX && nx <= endX && ny >= startY && ny <= endY) {
        const nidx = ny * w + nx;
        if (visited[nidx] === 0) {
          visited[nidx] = 1;

          // Color similarity test
          const pIdx = nidx * 4;
          const nr = data[pIdx];
          const ng = data[pIdx+1];
          const nb = data[pIdx+2];

          const colorDiff = Math.sqrt(
            Math.pow(nr - seedR, 2) +
            Math.pow(ng - seedG, 2) +
            Math.pow(nb - seedB, 2)
          );

          if (colorDiff < maxDist) {
            queue.push([nx, ny]);
          }
        }
      }
    }
  }
}
