#!/usr/bin/env node
// Renders the scene backgrounds with Pollinations.ai into
// web/public/scenes/<id>.jpg. Set POLLINATIONS_KEY (a "pollen" key from
// enter.pollinations.ai): without one the free tier is rate-limited,
// low-resolution and watermarked, which isn't fit to ship. Seeds are fixed so results are reproducible;
// re-roll one scene with:  node scripts/generate-backgrounds.mjs koban --seed 42
//
// Usage: node scripts/generate-backgrounds.mjs [scene-id ...] [--seed N] [--force]
//
// The free tier allows one image per ~45 s per IP, so requests are paced.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "public", "scenes");

// One shared look so every scene matches the cast's cel-shaded anime style.
const STYLE =
  "anime movie background art, hand-painted, soft cel shading, lush detailed environment, " +
  "gentle cinematic lighting, vibrant but soft colors, wide shot at eye level, " +
  "empty scene, no people, no characters, no text, no letters, no watermark";

const SCENES = {
  narita_arrivals: "bright modern airport arrivals hall in Japan in the morning, polished reflective floor, long escalator on the right, tall glass windows with sunlight, baggage carousel, clean and spacious",
  narita_exterior: "outside a Japanese airport terminal on a clear morning, bus stop under a large curved white canopy, taxi lane, blue sky with fluffy white clouds, a red vending machine, trimmed trees",
  koban: "interior of a tiny Japanese neighbourhood police box, small wooden desk, wall map, a shelf of lost property bags, a red lamp glowing by the door, warm afternoon light",
  station_concourse: "underground Japanese train station concourse, a row of ticket machines with glowing screens, automatic ticket gates, large route map on the wall, departure boards, cool clean lighting",
  train_interior: "inside an empty Japanese commuter train carriage, long blue bench seats, hanging hand straps, warm sunlight through the windows, green rice fields and small houses passing outside",
  konbini_night: "inside a bright Japanese convenience store at night, neat shelves of rice balls and snacks, glowing drink refrigerators, cashier counter, glass front door showing a dark street",
  ueno_street_night: "lively Tokyo shopping street at night, colourful neon signs, red paper lanterns, elevated railway bridge overhead, wet pavement with reflections, warm and cool lights",
  hostel_lobby: "cosy traditional wooden hostel lobby in Asakusa at night, glowing paper lantern, wooden reception counter, shoe lockers, plants, warm golden lamp light",
  hostel_room: "cosy hostel dormitory room at night, wooden bunk beds with curtains, fairy lights, window showing the lit-up Tokyo Skytree in the distance, warm lamp light",
  police_station: "Japanese police station waiting area, clean service counters with windows, rows of plastic chairs, notice boards, potted plant, bright morning daylight through windows",
};

const args = process.argv.slice(2);
const force = args.includes("--force");
const seedArg = args.indexOf("--seed");
const seedOverride = seedArg >= 0 ? Number(args[seedArg + 1]) : null;
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--seed");
const ids = wanted.length ? wanted : Object.keys(SCENES);

mkdirSync(OUT, { recursive: true });

const KEY = process.env.POLLINATIONS_KEY ?? "";
if (!KEY) console.warn("POLLINATIONS_KEY not set: free tier (watermarked, 1 image / 45 s).");
const PACE_MS = KEY ? 2_000 : 50_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

for (const [i, id] of ids.entries()) {
  if (!SCENES[id]) {
    console.error(`unknown scene ${id}`);
    process.exitCode = 1;
    continue;
  }
  const file = join(OUT, `${id}.jpg`);
  if (existsSync(file) && !force && !wanted.length) {
    console.log(`skip ${id} (exists)`);
    continue;
  }
  const seed = seedOverride ?? 1000 + i * 17;
  const prompt = `${SCENES[id]}, ${STYLE}`;
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=1920&height=1080&model=flux&nologo=true&enhance=false&seed=${seed}` +
    (KEY ? `&token=${encodeURIComponent(KEY)}` : "");

  for (let attempt = 1; attempt <= 4; attempt++) {
    await sleep(Math.max(0, lastRequest + PACE_MS - Date.now()));
    lastRequest = Date.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(180_000),
        headers: KEY ? { Authorization: `Bearer ${KEY}` } : {},
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
      if (!res.ok || !isJpeg || buf.length < 20_000) throw new Error(`HTTP ${res.status}, ${buf.length} bytes`);
      writeFileSync(file, buf);
      console.log(`ok   ${id} (seed ${seed}, ${(buf.length / 1024).toFixed(0)} KB)`);
      break;
    } catch (e) {
      console.warn(`retry ${id} (${attempt}/4): ${e.message}`);
      if (attempt === 4) process.exitCode = 1;
    }
  }
}
