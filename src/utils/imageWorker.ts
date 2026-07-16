/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Web Worker for off-main-thread image processing.
// Receives ImageData + adjustments, processes pixels, returns result.
// This prevents the heavy per-pixel math from blocking the UI thread.

import { EditorAdjustments } from '../types';
import { applyAdjustmentsToImageData } from './imageProcessing';

export interface WorkerRequest {
  id: number;
  imageData: ImageData;
  adjustments: EditorAdjustments;
}

export interface WorkerResponse {
  id: number;
  imageData: ImageData;
}

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, imageData, adjustments } = e.data;
  try {
    applyAdjustmentsToImageData(imageData, adjustments);
    // Transfer the underlying buffer back to avoid copying
    (ctx as any).postMessage(
      { id, imageData } as WorkerResponse,
      [imageData.data.buffer]
    );
  } catch (err) {
    // On error, return the original data untouched
    (ctx as any).postMessage(
      { id, imageData } as WorkerResponse,
      [imageData.data.buffer]
    );
  }
};
