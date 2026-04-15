import { createWorker, Worker } from "tesseract.js";
import { parseCardNumber } from "./parser";

let worker: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = await createWorker("eng");
  }
  return worker;
}

/**
 * Crop to the bottom 20% of an image and enhance contrast.
 * Returns a data URL of the processed region.
 */
function preprocessImage(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // Crop bottom 20% — where card number is printed
  const cropY = Math.floor(imageData.height * 0.8);
  const cropHeight = imageData.height - cropY;

  canvas.width = imageData.width;
  canvas.height = cropHeight;

  // Draw the full image to a temp canvas first, then crop
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d")!;
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  tempCtx.putImageData(imageData, 0, 0);

  // Draw cropped region with contrast enhancement
  ctx.filter = "contrast(1.5) grayscale(1)";
  ctx.drawImage(
    tempCanvas,
    0, cropY, imageData.width, cropHeight,
    0, 0, imageData.width, cropHeight
  );

  return canvas.toDataURL("image/png");
}

/**
 * Run OCR on a captured image and try to extract a card number.
 * Returns the card number string if found, null otherwise.
 * Never throws — all errors are caught and return null.
 */
export async function recognizeCardNumber(
  imageData: ImageData
): Promise<string | null> {
  try {
    const w = await getWorker();
    const processedImage = preprocessImage(imageData);
    const { data } = await w.recognize(processedImage);
    return parseCardNumber(data.text);
  } catch {
    return null;
  }
}
