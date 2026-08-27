#!/usr/bin/env node
/**
 * Generates public/favicon.ico, public/icon-192.png, public/icon-512.png from public/logo.svg
 * at build time (wired into the "build" script in package.json, ahead of `vite build`).
 *
 * logo.svg uses CSS custom properties (var(--accent,...), currentColor) for in-app theming;
 * outside a browser DOM there's no cascade to resolve them from, so this script bakes in
 * static brand colors before rasterizing: the accent purple (also the SVG's own var()
 * fallback) and a dark ink neutral for currentColor, so the icon reads consistently
 * regardless of which Flow theme is active when the tab/panel isn't focused.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'logo.svg');

const ACCENT = '#8839EF';
const INK = '#1E1E2E';

function resolvedSvgSource() {
  const raw = readFileSync(svgPath, 'utf8');
  return raw.replace(/var\(--accent,\s*#[0-9A-Fa-f]{6}\)/g, ACCENT).replaceAll('currentColor', INK);
}

/**
 * Wraps a PNG buffer in a minimal, valid single-image ICO container (the "PNG-compressed
 * icon" form Windows Vista+ and every browser accept -- no BMP re-encoding needed).
 * Layout: 6-byte ICONDIR + 16-byte ICONDIRENTRY + the raw PNG bytes.
 */
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  const dimensionByte = size >= 256 ? 0 : size; // 0 means "256" in ICO's 1-byte dimension field
  entry.writeUInt8(dimensionByte, 0); // width
  entry.writeUInt8(dimensionByte, 1); // height
  entry.writeUInt8(0, 2); // color count (0 = no palette / true color)
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // size of the embedded PNG
  entry.writeUInt32LE(header.length + entry.length, 12); // offset to the embedded PNG

  return Buffer.concat([header, entry, png]);
}

async function rasterize(svgBuffer, size) {
  // Rasterize well above every target size so every output (including the largest, 512px)
  // downsamples from a sharp source instead of upscaling a blurry one.
  return sharp(svgBuffer, { density: 1000 }).resize(size, size).png().toBuffer();
}

async function main() {
  mkdirSync(publicDir, { recursive: true });
  const svgBuffer = Buffer.from(resolvedSvgSource());

  const favicon32 = await rasterize(svgBuffer, 32);
  writeFileSync(join(publicDir, 'favicon.ico'), pngToIco(favicon32, 32));

  for (const size of [192, 512]) {
    const png = await rasterize(svgBuffer, size);
    writeFileSync(join(publicDir, `icon-${size}.png`), png);
  }

  console.log('gen-icons: wrote favicon.ico, icon-192.png, icon-512.png from logo.svg');
}

main().catch((error) => {
  console.error('gen-icons failed:', error);
  process.exit(1);
});
