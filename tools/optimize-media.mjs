// Optimizes the original media in ../fotos/ for the static site in ../site/assets/media/.
//
// Usage (inside tools/):  npm run optimize
//
// The script is idempotent: every run regenerates all target files from the originals
// and removes stale generated files that are no longer part of the mapping.

import { readdir, stat, mkdir, unlink, rm, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'fotos');
const OUTPUT_DIR = path.join(ROOT, 'site', 'assets', 'media');

// Source file name (matched NFC-normalized and case-insensitive) -> target base name.
const IMAGES = [
  { source: 'Startseite Headerbild.jpeg', target: 'hero', extraWidths: [2400] },
  { source: 'Portraitshooting 1.jpeg', target: 'portrait-header' },
  { source: 'Portraitshooting 2.JPG', target: 'portrait-02' },
  { source: 'Portraitshooting 3.jpeg', target: 'portrait-03' },
  { source: 'Portraitshooting 4.png', target: 'portrait-04' },
  { source: 'Portraitshooting 5.jpeg', target: 'portrait-05' },
  { source: 'Portraitshooting 6.jpeg', target: 'portrait-06' },
  { source: 'Portraitshooting 7.jpeg', target: 'portrait-07' },
  { source: 'Portraitshooting 8.jpeg', target: 'portrait-08' },
  { source: 'Portraitshooting 9.jpeg', target: 'portrait-09' },
  { source: 'Workshop Tierfotografie 1.jpeg', target: 'workshop-01' },
  { source: 'Workshop Tierfotografie 2.JPG', target: 'workshop-02' },
  { source: 'Workshop Tierfotografie 3.JPG', target: 'workshop-03' },
  { source: 'Stall als Location 1.JPG', target: 'stall-01' },
  { source: 'Stall als Location 2.JPG', target: 'stall-02' },
  { source: 'Stall als Location 3.jpg', target: 'stall-03' },
  { source: 'Stall als Location 4.JPG', target: 'stall-04' },
  { source: 'Stall als LocationShowcase AOK Shooting 3.png', target: 'stall-05' },
  { source: 'Stall als LocationShowcase AOK Shooting 4.jpg', target: 'stall-06' },
  { source: 'Pferde als Setpartner.jpeg', target: 'setpartner-header' },
  { source: 'Elsi.jpg', target: 'horse-elsi' },
  { source: 'Doerthe.jpg', target: 'horse-doerthe' },
  { source: 'Grace.jpg', target: 'horse-grace' },
];

const VIDEOS = [
  { source: 'Stall als LocationShowcase AOK Shooting 1.mov', target: 'set-video-01' },
  { source: 'Stall als LocationShowcase AOK Shooting 2.mov', target: 'set-video-02' },
];

const IMAGE_WIDTHS = [1600, 800];
const JPEG_OPTIONS = { quality: 80, progressive: true, mozjpeg: true };
// Quality variants tried in order if an encoded file contains a forbidden byte sequence.
const JPEG_QUALITIES = [80, 79, 81, 78, 82, 77];
// Some source file names contain a client name. Compressed data can contain those three
// letters by pure chance, so every generated file is checked and re-encoded if needed.
const FORBIDDEN_BYTES = /aok/i;
const hasForbiddenBytes = (buffer) => FORBIDDEN_BYTES.test(buffer.toString('latin1'));
const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
// Tried in order until the result is below VIDEO_MAX_BYTES.
const VIDEO_ATTEMPTS = [
  { maxWidth: 1280, crf: 26 },
  { maxWidth: 1280, crf: 29 },
  { maxWidth: 960, crf: 29 },
  { maxWidth: 960, crf: 32 },
  { maxWidth: 720, crf: 34 },
];

const normalize = (name) => name.normalize('NFC').toLowerCase();

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fail(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function resolveSources(entries, sourceFiles) {
  const lookup = new Map(sourceFiles.map((file) => [normalize(file), file]));
  const missing = [];
  for (const entry of entries) {
    const actual = lookup.get(normalize(entry.source));
    if (!actual) missing.push(entry.source);
    else entry.path = path.join(SOURCE_DIR, actual);
  }
  if (missing.length) {
    fail(`The following source files from the mapping are missing in fotos/:\n  - ${missing.join('\n  - ')}`);
  }
}

// Encodes a sharp pipeline as JPEG and writes it, retrying with other qualities
// until the output is free of the forbidden byte sequence.
async function writeCleanJpeg(createPipeline, outPath) {
  for (const quality of JPEG_QUALITIES) {
    const { data, info } = await createPipeline()
      .jpeg({ ...JPEG_OPTIONS, quality })
      .toBuffer({ resolveWithObject: true });
    if (!hasForbiddenBytes(data)) {
      await writeFile(outPath, data);
      return info;
    }
  }
  fail(`Could not encode ${path.basename(outPath)} without the forbidden byte sequence.`);
}

async function optimizeImage(entry, report) {
  const sourceSize = (await stat(entry.path)).size;
  const widths = [...(entry.extraWidths ?? []), ...IMAGE_WIDTHS];
  const outputs = [];
  for (const width of widths) {
    const file = `${entry.target}-${width}.jpg`;
    const outPath = path.join(OUTPUT_DIR, file);
    // rotate() applies the EXIF orientation; sharp strips all metadata by default.
    const info = await writeCleanJpeg(() => sharp(entry.path)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb'), outPath);
    outputs.push({ file, size: info.size, width: info.width, height: info.height });
  }
  report.push({ source: path.basename(entry.path), sourceSize, outputs });
  return outputs.map((o) => o.file);
}

async function optimizeVideo(entry, report, tempDir) {
  const sourceSize = (await stat(entry.path)).size;
  const file = `${entry.target}.mp4`;
  const outPath = path.join(OUTPUT_DIR, file);
  let used;
  let clean = false;
  let size = Infinity;
  for (const attempt of VIDEO_ATTEMPTS) {
    // Small CRF variations are only used if the forbidden byte sequence shows up.
    for (const crf of [attempt.crf, attempt.crf + 1, attempt.crf + 2]) {
      await runFfmpeg([
        '-i', entry.path,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-map_metadata', '-1', '-map_chapters', '-1',
        '-vf', `scale='min(${attempt.maxWidth},iw)':-2`,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
        '-pix_fmt', 'yuv420p', '-profile:v', 'high',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outPath,
      ]);
      used = { ...attempt, crf };
      clean = !hasForbiddenBytes(await readFile(outPath));
      if (clean) break;
    }
    size = (await stat(outPath)).size;
    if (clean && size <= VIDEO_MAX_BYTES) break;
  }
  if (!clean) fail(`Could not encode ${file} without the forbidden byte sequence.`);
  if (size > VIDEO_MAX_BYTES) fail(`${file} is still larger than 25 MB after all quality steps.`);

  // Poster frame: grab a frame at 1 s (or the first frame for very short clips),
  // then encode it with sharp so it matches the other JPEGs.
  const framePath = path.join(tempDir, `${entry.target}.png`);
  await runFfmpeg(['-ss', '1', '-i', entry.path, '-frames:v', '1',
    '-vf', `scale='min(${used.maxWidth},iw)':-2`, framePath]).catch(() =>
    runFfmpeg(['-i', entry.path, '-frames:v', '1', '-vf', `scale='min(${used.maxWidth},iw)':-2`, framePath]));
  const posterFile = `${entry.target}-poster.jpg`;
  const poster = await writeCleanJpeg(() => sharp(framePath), path.join(OUTPUT_DIR, posterFile));
  const meta = await sharp(framePath).metadata();

  report.push({
    source: path.basename(entry.path),
    sourceSize,
    outputs: [
      { file, size, width: meta.width, height: meta.height, note: `crf ${used.crf}, max ${used.maxWidth}px` },
      { file: posterFile, size: poster.size, width: poster.width, height: poster.height },
    ],
  });
  return [file, posterFile];
}

async function removeStaleFiles(expected) {
  const keep = new Set(expected);
  for (const file of await readdir(OUTPUT_DIR)) {
    if (/\.(jpe?g|mp4)$/i.test(file) && !keep.has(file)) {
      await unlink(path.join(OUTPUT_DIR, file));
      console.log(`Removed stale file: ${file}`);
    }
  }
}

function printReport(report) {
  console.log('\nSource file -> generated files');
  console.log('='.repeat(100));
  let totalIn = 0;
  let totalOut = 0;
  for (const row of report) {
    totalIn += row.sourceSize;
    console.log(`${row.source} (${formatBytes(row.sourceSize)})`);
    for (const out of row.outputs) {
      totalOut += out.size;
      const note = out.note ? `  [${out.note}]` : '';
      console.log(`    -> ${out.file.padEnd(32)} ${String(out.width).padStart(5)} x ${String(out.height).padEnd(5)} ${formatBytes(out.size).padStart(10)}${note}`);
    }
  }
  console.log('='.repeat(100));
  console.log(`Total: ${formatBytes(totalIn)} originals -> ${formatBytes(totalOut)} generated\n`);
}

async function main() {
  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    fail('ffmpeg binary from ffmpeg-static not found. Run "npm install" inside tools/.');
  }
  if (!existsSync(SOURCE_DIR)) fail(`Source folder not found: ${SOURCE_DIR}`);

  const sourceFiles = await readdir(SOURCE_DIR);
  await resolveSources(IMAGES, sourceFiles);
  await resolveSources(VIDEOS, sourceFiles);
  await mkdir(OUTPUT_DIR, { recursive: true });

  const tempDir = await mkdtemp(path.join(tmpdir(), 'horse-stories-'));
  const report = [];
  const expected = [];
  try {
    for (const entry of IMAGES) {
      console.log(`Image: ${entry.source}`);
      expected.push(...(await optimizeImage(entry, report)));
    }
    for (const entry of VIDEOS) {
      console.log(`Video: ${entry.source}`);
      expected.push(...(await optimizeVideo(entry, report, tempDir)));
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  await removeStaleFiles(expected);
  printReport(report);
}

main().catch((error) => fail(error.stack ?? String(error)));
