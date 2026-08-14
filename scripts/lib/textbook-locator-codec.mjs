import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
} from "node:zlib";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const textbookLocatorRawPath = path.join(projectRoot, "data", "textbook-locators.v1.json");
export const textbookLocatorCompressedPath = `${textbookLocatorRawPath}.br`;
const maxDecodedBytes = 32 * 1024 * 1024;

function decodeJson(bytes, label) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`教科書定位索引不是有效 JSON：${label}`, { cause: error });
  }
}

function decompress(compressed, label) {
  let decoded;
  try {
    decoded = brotliDecompressSync(compressed, { maxOutputLength: maxDecodedBytes });
  } catch (error) {
    throw new Error(`無法解壓教科書定位索引：${label}`, { cause: error });
  }
  if (!decoded.length) throw new Error(`教科書定位索引不可為空：${label}`);
  return decoded;
}

function canonicalBrotli(bytes) {
  const windowBits = Math.min(24, Math.max(22, Math.ceil(Math.log2(Math.max(1, bytes.length)))));
  return brotliCompressSync(bytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_LGWIN]: windowBits,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });
}

function atomicWrite(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, target);
}

export function readTextbookLocator(compressedPath = textbookLocatorCompressedPath) {
  const compressed = fs.readFileSync(compressedPath);
  return decodeJson(decompress(compressed, compressedPath), compressedPath);
}

export function compressTextbookLocator({
  rawPath = textbookLocatorRawPath,
  compressedPath = textbookLocatorCompressedPath,
} = {}) {
  if (!fs.existsSync(rawPath)) {
    if (!fs.existsSync(compressedPath)) {
      throw new Error(`找不到教科書定位索引：${rawPath}`);
    }
    const compressed = fs.readFileSync(compressedPath);
    const decoded = decompress(compressed, compressedPath);
    decodeJson(decoded, compressedPath);
    return {
      rawBytes: decoded.length,
      compressedBytes: compressed.length,
      updated: false,
    };
  }

  const raw = fs.readFileSync(rawPath);
  if (!raw.length || raw.length > maxDecodedBytes) {
    throw new Error(`教科書定位索引大小不合法：${rawPath}`);
  }
  decodeJson(raw, rawPath);
  const compressed = canonicalBrotli(raw);
  const roundTrip = decompress(compressed, compressedPath);
  if (!roundTrip.equals(raw)) throw new Error("教科書定位索引 Brotli 往返驗證失敗");

  const previous = fs.existsSync(compressedPath) ? fs.readFileSync(compressedPath) : null;
  const updated = !previous?.equals(compressed);
  if (updated) atomicWrite(compressedPath, compressed);
  fs.rmSync(rawPath);
  return {
    rawBytes: raw.length,
    compressedBytes: compressed.length,
    updated,
  };
}
