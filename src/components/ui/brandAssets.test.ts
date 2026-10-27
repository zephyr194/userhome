/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const tauriDir = fileURLToPath(new URL("../../../src-tauri/", import.meta.url));
const iconsDir = join(tauriDir, "icons");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type PngHeader = { width: number; height: number; bitDepth: number; colorType: number; data: Buffer };

function readPng(path: string): PngHeader {
  const buf = readFileSync(path);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${path} is not a PNG`);
  let offset = 8;
  let header: Omit<PngHeader, "data"> | undefined;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
      };
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  if (header === undefined) throw new Error(`${path} has no IHDR`);
  return { ...header, data: Buffer.concat(idat) };
}

function predict(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  if (filter === 4) {
    const p = left + up - upLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - up);
    const pc = Math.abs(p - upLeft);
    return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
  }
  throw new Error(`unknown PNG filter ${filter}`);
}

function rgbaPixels(png: PngHeader): Buffer {
  const bpp = 4;
  const stride = png.width * bpp;
  const raw = inflateSync(png.data);
  const out = Buffer.alloc(stride * png.height);
  for (let y = 0; y < png.height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
      out[y * stride + x] = (raw[rowStart + 1 + x] + predict(filter, left, up, upLeft)) & 0xff;
    }
  }
  return out;
}

describe("tray-template.png", () => {
  const tray = readPng(join(iconsDir, "tray-template.png"));

  it("is 44×44 RGBA (color type 6, 8-bit)", () => {
    expect({ width: tray.width, height: tray.height }).toEqual({ width: 44, height: 44 });
    expect({ bitDepth: tray.bitDepth, colorType: tray.colorType }).toEqual({ bitDepth: 8, colorType: 6 });
  });

  it("is monochrome black: every visible pixel has RGB 0 and only alpha varies", () => {
    const pixels = rgbaPixels(tray);
    let visibleWithColor = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha > 0 && (pixels[i] | pixels[i + 1] | pixels[i + 2]) !== 0) visibleWithColor++;
    }
    expect(visibleWithColor).toBe(0);
  });

  it("has both fully transparent and fully opaque pixels", () => {
    const pixels = rgbaPixels(tray);
    let transparent = 0;
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) transparent++;
      if (pixels[i] === 255) opaque++;
    }
    expect(transparent).toBeGreaterThan(0);
    expect(opaque).toBeGreaterThan(0);
  });
});

describe("packaged icons", () => {
  it("icon.png is 512×512", () => {
    const icon = readPng(join(iconsDir, "icon.png"));
    expect({ width: icon.width, height: icon.height }).toEqual({ width: 512, height: 512 });
  });

  it("every bundle.icon entry in tauri.conf.json exists", () => {
    const config = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8")) as {
      bundle: { icon: string[] };
    };
    const missing = config.bundle.icon.filter((path) => !existsSync(join(tauriDir, path)));
    expect(missing).toEqual([]);
  });

  it("icon-source.svg and userhome-icon.svg have identical content", () => {
    const source = readFileSync(join(iconsDir, "icon-source.svg"), "utf8");
    const userhome = readFileSync(join(iconsDir, "userhome-icon.svg"), "utf8");
    expect(userhome).toBe(source);
  });
});
