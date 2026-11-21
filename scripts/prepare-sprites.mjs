#!/usr/bin/env node
// Turns generated character art into game sprites.
//
//   node scripts/prepare-sprites.mjs <folder> [--course ja] [--key green|magenta]
//
// Files in <folder> are named <character_id>_<pose>.png (or .jpg/.webp):
//   kenji_happy.png, fumiko_base.png, nakajima_talk.png …
// "base" is the character's main sprite (the `sprite` path in story.toml);
// any other pose goes to web/public/characters/<id>/<pose>.png.
//
// The art is drawn on a flat green-screen background (#00FF00; magenta
// #FF00FF with --key magenta), which is keyed out with soft edges and the
// colour fringe removed. Each sprite is trimmed and
// fitted into the same 432×578 frame as the existing cast, feet at the bottom.
// Afterwards it records each character's poses (`poses = [...]`) in the
// course's story.toml, keeping poses rendered earlier.

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "web", "package.json"));
const sharp = require("sharp");

const POSES = ["happy", "sad", "surprised", "worried", "thinking", "annoyed", "embarrassed", "talk", "point", "bow", "wave"];
const W = 432;
const H = 578;
// Distance from the key colour below which a pixel is background, and above
// which it is solid. Tight, so green eyes or pink hair stay opaque.
const KEY_IN = 55;
const KEY_OUT = 110;
const KEYS = { green: [0, 255, 0], magenta: [255, 0, 255] };

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--"));
const course = args.includes("--course") ? args[args.indexOf("--course") + 1] : "ja";
const keyName = args.includes("--key") ? args[args.indexOf("--key") + 1] : "green";
const KEY = KEYS[keyName];
if (!KEY) {
  console.error(`unknown --key ${keyName} (green or magenta)`);
  process.exit(1);
}
if (!folder) {
  console.error("usage: node scripts/prepare-sprites.mjs <folder> [--course ja]");
  process.exit(1);
}

// Base sprite paths from the course's cast.
const storyPath = join(root, "server", "content", "courses", course, "story.toml");
let story = readFileSync(storyPath, "utf8");
const baseSprite = {};
for (const m of story.matchAll(/\[\[cast\]\]\s*\nid = "([^"]+)"[\s\S]*?\nsprite = "([^"]+)"/g)) baseSprite[m[1]] = m[2];

async function key(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const d = Math.hypot(KEY[0] - r, KEY[1] - g, KEY[2] - b);
    const a = Math.max(0, Math.min(1, (d - KEY_IN) / (KEY_OUT - KEY_IN)));
    if (a < 1) {
      // Pull the key colour's spill out of edge pixels.
      if (keyName === "green") {
        const spill = g - Math.max(r, b);
        if (spill > 0) data[i + 1] = g - spill * (1 - a);
      } else {
        const spill = Math.min(r, b) - g;
        if (spill > 0) {
          data[i] = r - spill * (1 - a);
          data[i + 2] = b - spill * (1 - a);
        }
      }
    }
    data[i + 3] = Math.round(data[i + 3] * a);
    // Opaque edge pixels can still carry a strong cast of the key colour
    // (anti-aliasing against the screen). Characters never wear it, so clamp it.
    if (a > 0 && keyName === "green") {
      const spill = data[i + 1] - Math.max(data[i], data[i + 2]);
      if (spill > 28) data[i + 1] = Math.max(data[i], data[i + 2]) + 10;
    }
  }
  const keyed = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  // Where the figure is in this image, after trimming the empty background.
  const { info: t } = await sharp(keyed).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const box = { left: -(t.trimOffsetLeft ?? 0), top: -(t.trimOffsetTop ?? 0), width: t.width, height: t.height };
  return { keyed, box, size: `${info.width}x${info.height}` };
}

/** Resizing blends edge pixels again; clear any key-colour cast it brings back. */
async function despill(png) {
  if (keyName !== "green") return png;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const cap = Math.max(data[i], data[i + 2]) + 10;
    if (data[i + 1] - cap > 18) data[i + 1] = cap;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// Group the files by character first: every pose of a character is cropped
// to the same box (the union of all of them), so scale and position match
// and a gesture never shrinks the figure.
const jobs = [];
for (const name of readdirSync(folder).sort()) {
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extname(name).toLowerCase())) continue;
  const stem = name.slice(0, -extname(name).length).toLowerCase();
  const cut = stem.lastIndexOf("_");
  const [id, pose] = cut > 0 ? [stem.slice(0, cut), stem.slice(cut + 1)] : [stem, "base"];
  if (!(id in baseSprite)) {
    console.warn(`skip ${name}: no character "${id}" in the ${course} course`);
    continue;
  }
  if (pose !== "base" && !POSES.includes(pose)) {
    console.warn(`skip ${name}: unknown pose "${pose}" (known: base, ${POSES.join(", ")})`);
    continue;
  }
  const out = pose === "base"
    ? join(root, "web", "public", baseSprite[id])
    : join(root, "web", "public", "characters", id, `${pose}.png`);
  jobs.push({ name, id, pose, out, ...(await key(join(folder, name))) });
}

const union = {};
for (const j of jobs) {
  const k = `${j.id}|${j.size}`;
  const u = union[k];
  const right = j.box.left + j.box.width;
  const bottom = j.box.top + j.box.height;
  union[k] = u
    ? { left: Math.min(u.left, j.box.left), top: Math.min(u.top, j.box.top), right: Math.max(u.right, right), bottom: Math.max(u.bottom, bottom) }
    : { left: j.box.left, top: j.box.top, right, bottom };
}

const found = {};
for (const j of jobs) {
  const u = union[`${j.id}|${j.size}`];
  const sprite = await sharp(j.keyed)
    .extract({ left: u.left, top: u.top, width: u.right - u.left, height: u.bottom - u.top })
    .resize(W, H, { fit: "contain", position: "bottom", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  mkdirSync(dirname(j.out), { recursive: true });
  await despill(sprite).then((buf) => sharp(buf).toFile(j.out));
  console.log(`${j.name} → ${j.out.slice(root.length + 1)}`);
  if (j.pose !== "base") (found[j.id] ??= []).push(j.pose);
}

// The talk frame alternates with the base many times a second, so anything
// besides the mouth that differs (a strand of hair, a line) flickers. Rebuild
// it as the base with only the mouth patch from the generated talk image.
for (const id of new Set(jobs.filter((j) => j.pose === "talk").map((j) => j.id))) {
  const talkPath = join(root, "web", "public", "characters", id, "talk.png");
  const basePath = join(root, "web", "public", baseSprite[id]);
  if (!existsSync(basePath) || !existsSync(talkPath)) continue;
  const base = await sharp(basePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const talk = await sharp(talkPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  // This character's [[cast]] entry, up to the next table.
  const entry = story.split(/\n(?=\[\[)/).find((block) => block.startsWith("[[cast]]") && block.includes(`\nid = "${id}"`)) ?? "";
  const counter = /\nstance = "counter"/.test(entry);
  const mouth = mouthPatch(base.data, talk.data, width, height, counter);
  if (!mouth) {
    console.warn(`[${id}] talk frame: no mouth change found, keeping it as generated`);
    continue;
  }
  const patch = await sharp(talkPath).extract(mouth).toBuffer();
  await sharp(basePath).composite([{ input: patch, left: mouth.left, top: mouth.top }]).png().toFile(talkPath + ".tmp");
  const { renameSync } = await import("node:fs");
  renameSync(talkPath + ".tmp", talkPath);
  console.log(`[${id}] talk frame = base + mouth ${mouth.width}×${mouth.height} at ${mouth.left},${mouth.top}`);
}

/**
 * The mouth: the biggest cluster of changed pixels in the face band (just
 * below the top of the figure — deeper for waist-up counter art), found on a
 * coarse grid so stray single-pixel differences don't count. Props, hands and
 * outlines elsewhere are ignored.
 */
function mouthPatch(a, b, width, height, counter) {
  const CELL = 4;
  // The figure's top and height, from the base's opaque pixels.
  let top = height, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 2) {
      if (a[(y * width + x) * 4 + 3] > 128) { top = Math.min(top, y); bottom = Math.max(bottom, y); break; }
    }
  }
  const fig = Math.max(1, bottom - top);
  // Counter art is waist-up, so the face sits lower and larger; start below the eyes.
  const bandTop = top + Math.round(fig * (counter ? 0.2 : 0.05));
  const bandBottom = top + Math.round(fig * (counter ? 0.4 : 0.17));
  const gw = Math.ceil(width / CELL);
  const gh = Math.ceil(height / CELL);
  const hot = new Float32Array(gw * gh);
  for (let y = bandTop; y < bandBottom && y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (a[i + 3] < 128 || b[i + 3] < 128) continue;
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 80) hot[Math.floor(y / CELL) * gw + Math.floor(x / CELL)] += 1;
    }
  }
  const seen = new Uint8Array(gw * gh);
  let best = null;
  for (let start = 0; start < hot.length; start++) {
    if (seen[start] || hot[start] < 3) continue;
    const stack = [start];
    seen[start] = 1;
    let weight = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    while (stack.length) {
      const c = stack.pop();
      const cx = c % gw, cy = Math.floor(c / gw);
      weight += hot[c];
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const n = ny * gw + nx;
        if (!seen[n] && hot[n] >= 3) { seen[n] = 1; stack.push(n); }
      }
    }
    if (!best || weight > best.weight) best = { weight, x0, y0, x1, y1 };
  }
  if (!best || best.weight < 20) return null;
  // A cell of margin so the patch edge blends.
  const left = Math.max(0, (best.x0 - 1) * CELL);
  const patchTop = Math.max(0, (best.y0 - 1) * CELL);
  const right = Math.min(width, (best.x1 + 2) * CELL);
  const patchBottom = Math.min(height, (best.y1 + 2) * CELL);
  return { left, top: patchTop, width: right - left, height: patchBottom - patchTop };
}

// Record every pose that now has art (this run's and earlier ones).
for (const id of Object.keys(found)) {
  const poses = POSES.filter((pose) => existsSync(join(root, "web", "public", "characters", id, `${pose}.png`)));
  const line = `poses = ${JSON.stringify(poses).replaceAll(",", ", ")}`;
  const block = new RegExp(`(\\[\\[cast\\]\\]\\s*\\nid = "${id}"\\n[\\s\\S]*?)(\\n\\[\\[|$)`);
  story = story.replace(block, (_, body, next) => {
    const updated = /\nposes = \[[^\]]*\]/.test(body) ? body.replace(/\nposes = \[[^\]]*\]/, `\n${line}`) : body.replace(/\n(id = "[^"]+")/, `\n$1\n${line}`);
    return updated + next;
  });
  console.log(`[${id}] ${line}`);
}
writeFileSync(storyPath, story);
