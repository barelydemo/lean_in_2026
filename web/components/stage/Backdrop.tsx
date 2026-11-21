"use client";

import { useState, type ReactNode } from "react";

/**
 * Each scene uses painted art from /public/scenes/<id>.jpg (rendered by
 * scripts/generate-backgrounds.mjs). If an image is missing or fails to
 * load, the vector painting below is used instead.
 */
const sceneImage = (scene: string) => `/scenes/${scene}.jpg`;

const W = 1600;
const H = 900;

function Sky({ id, stops }: { id: string; stops: [number, string][] }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {stops.map(([o, c]) => (
            <stop key={o} offset={o} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id})`} />
    </>
  );
}

function Glow({ cx, cy, r, color, opacity = 0.6 }: { cx: number; cy: number; r: number; color: string; opacity?: number }) {
  // Two backdrops coexist during a crossfade, so ids must encode every parameter.
  const id = `g-${cx}-${cy}-${r}-${color.replace(/[^a-z0-9]/gi, "")}-${opacity}`.replace(/\./g, "_");
  return (
    <>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor={color} stopOpacity={opacity} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
    </>
  );
}

function Sign({ x, y, w, h, fill, text, color = "#111", size = 26 }: {
  x: number; y: number; w: number; h: number; fill: string; text: string; color?: string; size?: number;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={fill} />
      <text x={x + w / 2} y={y + h / 2 + size / 3} textAnchor="middle" fontSize={size} fontWeight={700}
        fill={color} fontFamily="Zen Maru Gothic, sans-serif">{text}</text>
    </g>
  );
}

const scenes: Record<string, () => ReactNode> = {
  narita_arrivals: () => (
    <>
      <Sky id="na" stops={[[0, "#dfe9f3"], [0.55, "#c4d3e3"], [1, "#8d9db3"]]} />
      {/* glass wall */}
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={i * 180 - 20} y={80} width={170} height={420} fill="#f4f9ff" opacity={0.55} />
      ))}
      <rect x={0} y={60} width={W} height={26} fill="#7b879a" />
      <path d={`M0 60 Q ${W / 2} -30 ${W} 60`} fill="none" stroke="#9aa6b8" strokeWidth={14} />
      {/* escalator */}
      <path d="M1050 560 L1450 260 L1520 260 L1120 560 Z" fill="#5d6779" />
      <path d="M1060 560 L1460 262" stroke="#d7e3f2" strokeWidth={6} />
      <path d="M1110 560 L1510 262" stroke="#d7e3f2" strokeWidth={6} />
      <Sign x={180} y={130} w={360} h={70} fill="#ffd23f" text="到着  Arrivals" />
      <Sign x={620} y={130} w={300} h={70} fill="#1b2a44" color="#fff" text="手荷物 Baggage" size={24} />
      {/* floor */}
      <rect x={0} y={560} width={W} height={340} fill="#b9c3cf" />
      <rect x={0} y={560} width={W} height={340} fill="url(#na)" opacity={0.25} />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={i * 150} y1={560} x2={i * 260 - 600} y2={H} stroke="#a3adba" strokeWidth={2} />
      ))}
      <Glow cx={400} cy={280} r={420} color="#ffffff" opacity={0.7} />
      <Glow cx={1300} cy={300} r={300} color="#fff6dc" opacity={0.5} />
    </>
  ),

  narita_exterior: () => (
    <>
      <Sky id="ne" stops={[[0, "#8fb7e0"], [0.5, "#cfe0ef"], [1, "#e9e3d6"]]} />
      <Glow cx={1250} cy={120} r={380} color="#fff4d1" opacity={0.8} />
      {/* clouds */}
      {[[200, 160, 1], [700, 110, 1.4], [1150, 200, 0.9]].map(([x, y, s], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${s})`} fill="#fff" opacity={0.75}>
          <ellipse cx={0} cy={0} rx={120} ry={34} />
          <ellipse cx={60} cy={-20} rx={80} ry={36} />
          <ellipse cx={-60} cy={-12} rx={70} ry={28} />
        </g>
      ))}
      {/* terminal building + canopy */}
      <rect x={0} y={300} width={W} height={260} fill="#9ea9b6" />
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={i} x={i * 100 + 10} y={330} width={80} height={170} fill="#cde2f3" opacity={0.7} />
      ))}
      <path d={`M-40 300 L${W + 40} 300 L${W + 40} 270 Q ${W / 2} 210 -40 270 Z`} fill="#e7ecf1" />
      {[160, 560, 960, 1360].map((x) => (
        <rect key={x} x={x} y={300} width={22} height={300} fill="#6f7b89" />
      ))}
      <Sign x={680} y={240} w={250} h={46} fill="#1b2a44" color="#fff" text="第1ターミナル" size={22} />
      {/* road */}
      <rect x={0} y={560} width={W} height={340} fill="#5b6068" />
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={i * 180} y={700} width={100} height={10} fill="#f1f1f1" opacity={0.85} />
      ))}
      <rect x={0} y={560} width={W} height={24} fill="#c8c2b4" />
      {/* bus + vending machine */}
      <g transform="translate(90 455)">
        <rect width={420} height={150} rx={22} fill="#f6f6f2" />
        <rect y={110} width={420} height={14} fill="#3d7bd9" />
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={20 + i * 65} y={20} width={55} height={60} rx={6} fill="#2b3442" opacity={0.85} />
        ))}
        <circle cx={80} cy={150} r={26} fill="#222" />
        <circle cx={340} cy={150} r={26} fill="#222" />
      </g>
      <g transform="translate(1330 380)">
        <rect width={110} height={190} rx={8} fill="#e33d3d" />
        <rect x={10} y={14} width={90} height={100} rx={4} fill="#fff" opacity={0.9} />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={16 + (i % 4) * 21} y={22 + Math.floor(i / 4) * 46} width={14} height={36} rx={4}
            fill={["#4ab3f4", "#f4c34a", "#55c27a", "#f47b4a"][i % 4]} />
        ))}
        <Glow cx={55} cy={60} r={120} color="#fff" opacity={0.25} />
      </g>
    </>
  ),

  koban: () => (
    <>
      <Sky id="ko" stops={[[0, "#e9dcc4"], [1, "#c9b597"]]} />
      <rect x={0} y={600} width={W} height={300} fill="#8a7a63" />
      {/* wall map */}
      <rect x={180} y={150} width={520} height={330} rx={6} fill="#f6f1e4" stroke="#6b5c46" strokeWidth={8} />
      <path d="M220 400 C 320 300, 420 420, 520 250 S 650 300, 670 200" stroke="#5aa0d8" strokeWidth={14} fill="none" />
      <path d="M230 200 L 660 440 M 300 460 L 600 170" stroke="#d9cfb8" strokeWidth={10} />
      <circle cx={470} cy={330} r={14} fill="#e33d3d" />
      {/* red lamp */}
      <circle cx={1180} cy={120} r={34} fill="#ff3b3b" />
      <Glow cx={1180} cy={120} r={260} color="#ff3b3b" opacity={0.45} />
      {/* lost property shelf */}
      <g transform="translate(1000 230)">
        <rect width={420} height={360} fill="#6e5a40" />
        {[0, 1, 2].map((r) => (
          <rect key={r} x={10} y={20 + r * 115} width={400} height={8} fill="#4c3d2b" />
        ))}
        <rect x={40} y={50} width={90} height={80} rx={14} fill="#2f3b52" />
        <rect x={170} y={70} width={110} height={60} rx={10} fill="#a33f3f" />
        <rect x={60} y={170} width={130} height={75} rx={18} fill="#d8c06a" />
        <rect x={250} y={160} width={90} height={85} rx={12} fill="#45644d" />
      </g>
      {/* desk */}
      <rect x={120} y={620} width={1360} height={60} rx={10} fill="#5c4a35" />
      <rect x={140} y={680} width={1320} height={220} fill="#4a3b2a" />
      <rect x={300} y={580} width={160} height={40} rx={4} fill="#efe9dc" />
      <Glow cx={800} cy={200} r={600} color="#fff5df" opacity={0.35} />
    </>
  ),

  station_concourse: () => (
    <>
      <Sky id="sc" stops={[[0, "#2a3447"], [1, "#4b5568"]]} />
      <rect x={0} y={0} width={W} height={70} fill="#1a2030" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={i * 210 + 40} y={20} width={150} height={14} rx={7} fill="#f3f7ff" opacity={0.9}
          style={{ animation: `flicker ${5 + i}s infinite` }} />
      ))}
      {/* fare map wall */}
      <rect x={120} y={120} width={1360} height={260} rx={8} fill="#f4f4ef" />
      {Array.from({ length: 5 }, (_, r) => (
        <path key={r} d={`M160 ${160 + r * 45} C 500 ${120 + r * 60}, 900 ${220 + r * 20}, 1440 ${150 + r * 50}`}
          stroke={["#2f7de1", "#e14c2f", "#26a65b", "#f0a020", "#8e44ad"][r]} strokeWidth={9} fill="none" />
      ))}
      {Array.from({ length: 18 }, (_, i) => (
        <circle key={i} cx={180 + i * 72} cy={170 + ((i * 37) % 170)} r={9} fill="#fff" stroke="#222" strokeWidth={3} />
      ))}
      {/* departure board */}
      <rect x={560} y={400} width={480} height={90} rx={6} fill="#111" />
      <text x={580} y={440} fontSize={26} fill="#ffb347" fontFamily="monospace">特急 上野 08:52</text>
      <text x={580} y={475} fontSize={22} fill="#7cffb2" fontFamily="monospace">Ltd. Exp  Ueno   1番線</text>
      {/* ticket machines */}
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i} transform={`translate(${120 + i * 230} 520)`}>
          <rect width={190} height={300} rx={12} fill="#cfd6df" />
          <rect x={20} y={24} width={150} height={110} rx={6} fill="#5fc3ff" opacity={0.85} />
          <Glow cx={95} cy={80} r={140} color="#5fc3ff" opacity={0.25} />
          <rect x={30} y={160} width={130} height={18} rx={4} fill="#7d8896" />
          <rect x={60} y={200} width={70} height={60} rx={4} fill="#3c4655" />
        </g>
      ))}
      <rect x={0} y={820} width={W} height={80} fill="#2c3240" />
    </>
  ),

  train_interior: () => (
    <>
      <Sky id="ti" stops={[[0, "#e9eef2"], [1, "#c8d1da"]]} />
      {/* scenery through the windows */}
      <defs>
        <clipPath id="tiw">
          {Array.from({ length: 4 }, (_, i) => (
            <rect key={i} x={70 + i * 390} y={150} width={330} height={260} rx={26} />
          ))}
        </clipPath>
      </defs>
      <g clipPath="url(#tiw)">
        <rect x={0} y={150} width={W} height={260} fill="#9fd0f0" />
        <g style={{ animation: "scroll-x 6s linear infinite" }}>
          {Array.from({ length: 40 }, (_, i) => (
            <g key={i}>
              <rect x={i * 80} y={330} width={60} height={80} fill={i % 3 ? "#7cb36b" : "#5e9a55"} />
              <rect x={i * 80 + 10} y={290 - (i % 5) * 18} width={36} height={60 + (i % 5) * 18} fill="#d8d2c4" />
              <rect x={i * 80 + 54} y={240} width={6} height={170} fill="#444" opacity={0.5} />
            </g>
          ))}
        </g>
      </g>
      {Array.from({ length: 4 }, (_, i) => (
        <rect key={i} x={70 + i * 390} y={150} width={330} height={260} rx={26} fill="none" stroke="#aab4bf" strokeWidth={14} />
      ))}
      {/* straps */}
      <rect x={0} y={40} width={W} height={12} fill="#9aa3ad" />
      {Array.from({ length: 14 }, (_, i) => (
        <g key={i} transform={`translate(${60 + i * 115} 52)`}>
          <rect x={-3} width={6} height={50} fill="#d9d9d9" />
          <circle cx={0} cy={70} r={20} fill="none" stroke="#f2f2f2" strokeWidth={7} />
        </g>
      ))}
      {/* seats */}
      <rect x={0} y={470} width={W} height={110} rx={10} fill="#3d6fb6" />
      <rect x={0} y={560} width={W} height={60} fill="#2c568f" />
      <rect x={0} y={620} width={W} height={280} fill="#a7a091" />
      <Glow cx={800} cy={250} r={700} color="#ffffff" opacity={0.35} />
    </>
  ),

  ueno_street_night: () => (
    <>
      <Sky id="un" stops={[[0, "#0b1030"], [0.6, "#2b1c4a"], [1, "#4a2140"]]} />
      {/* skyline */}
      {Array.from({ length: 22 }, (_, i) => {
        const h = 200 + ((i * 97) % 260);
        return <rect key={i} x={i * 75 - 10} y={560 - h} width={70} height={h} fill={i % 2 ? "#151a36" : "#1c2245"} />;
      })}
      {Array.from({ length: 70 }, (_, i) => (
        <rect key={i} x={(i * 53) % W} y={260 + ((i * 71) % 260)} width={10} height={14}
          fill="#ffd88a" opacity={(i % 4) / 5 + 0.2} />
      ))}
      {/* vertical neon signs */}
      {[["居酒屋", "#ff4fa3", 210], ["カラオケ", "#4fd6ff", 640], ["ラーメン", "#ffcf4f", 1120]].map(([t, c, x]) => (
        <g key={t as string}>
          <rect x={x as number} y={200} width={70} height={300} rx={8} fill="#120d22" stroke={c as string} strokeWidth={4} />
          <text x={(x as number) + 35} y={250} fontSize={40} fill={c as string} textAnchor="middle"
            style={{ writingMode: "vertical-rl" }} fontFamily="Zen Maru Gothic, sans-serif">{t}</text>
          <Glow cx={(x as number) + 35} cy={350} r={180} color={c as string} opacity={0.35} />
        </g>
      ))}
      {/* elevated rail */}
      <rect x={0} y={420} width={W} height={40} fill="#262a3d" />
      {[100, 500, 900, 1300].map((x) => (
        <rect key={x} x={x} y={460} width={50} height={120} fill="#1e2133" />
      ))}
      <rect x={0} y={580} width={W} height={320} fill="#16131f" />
      <rect x={0} y={580} width={W} height={320} fill="url(#un)" opacity={0.35} />
      {/* lanterns */}
      {[340, 420, 500].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={520} rx={26} ry={34} fill="#ff5a3c" />
          <Glow cx={x} cy={520} r={90} color="#ff7a3c" opacity={0.5} />
        </g>
      ))}
    </>
  ),

  konbini_night: () => (
    <>
      <Sky id="kn" stops={[[0, "#f4f8fb"], [1, "#e1e7ee"]]} />
      <rect x={0} y={0} width={W} height={90} fill="#ffffff" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={60 + i * 260} y={30} width={200} height={16} rx={8} fill="#ffffff"
          stroke="#e9eef5" strokeWidth={4} />
      ))}
      {/* brand stripes (generic) */}
      <rect x={0} y={90} width={W} height={18} fill="#2fa35a" />
      <rect x={0} y={108} width={W} height={12} fill="#2f6fd6" />
      {/* shelves */}
      {Array.from({ length: 3 }, (_, s) => (
        <g key={s} transform={`translate(${80 + s * 520} 170)`}>
          <rect width={460} height={470} rx={8} fill="#dde3ea" />
          {[0, 1, 2, 3].map((r) => (
            <g key={r}>
              <rect x={10} y={30 + r * 110} width={440} height={10} fill="#b8c0ca" />
              {Array.from({ length: 9 }, (_, k) => (
                <path key={k} d={`M${24 + k * 48} ${110 + r * 110} l20 -40 l20 40 z`}
                  fill={["#f7f3e8", "#ffffff", "#f2ead7"][(k + r) % 3]} stroke="#2b2b2b" strokeWidth={2} />
              ))}
            </g>
          ))}
        </g>
      ))}
      {/* hot food case & register */}
      <rect x={1050} y={640} width={480} height={120} rx={10} fill="#f6c67a" opacity={0.85} />
      <Glow cx={1290} cy={690} r={200} color="#ffb84a" opacity={0.45} />
      <rect x={0} y={760} width={W} height={140} fill="#cfd6de" />
      {/* night outside the glass door */}
      <rect x={1460} y={140} width={140} height={620} fill="#141a33" />
      <Glow cx={1530} cy={300} r={80} color="#ff4fa3" opacity={0.5} />
      <Glow cx={800} cy={60} r={900} color="#ffffff" opacity={0.5} />
    </>
  ),

  hostel_lobby: () => (
    <>
      <Sky id="hl" stops={[[0, "#3a2618"], [1, "#6b4a2f"]]} />
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={i} x={i * 100} y={0} width={96} height={600} fill={i % 2 ? "#5a3d26" : "#61432a"} />
      ))}
      {/* paper lantern */}
      <line x1={420} y1={0} x2={420} y2={90} stroke="#222" strokeWidth={4} />
      <ellipse cx={420} cy={180} rx={80} ry={100} fill="#ffe7b8" />
      {[-60, -30, 0, 30, 60].map((dy) => (
        <ellipse key={dy} cx={420} cy={180 + dy} rx={78 - Math.abs(dy) / 3} ry={4} fill="#d9b77e" />
      ))}
      <Glow cx={420} cy={180} r={420} color="#ffcf7a" opacity={0.55} />
      {/* sign */}
      <g transform="translate(900 120) rotate(-3)">
        <rect width={300} height={140} fill="#f7f0de" />
        <text x={150} y={90} fontSize={54} textAnchor="middle" fill="#c0392b" fontFamily="Zen Maru Gothic, sans-serif" fontWeight={700}>日本語だけ！</text>
      </g>
      {/* shoe lockers */}
      <g transform="translate(1220 260)">
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={(i % 3) * 110} y={Math.floor(i / 3) * 90} width={100} height={80} fill="#8a6440" stroke="#4a3220" strokeWidth={4} />
        ))}
      </g>
      {/* counter */}
      <rect x={60} y={560} width={1000} height={70} rx={8} fill="#a8763f" />
      <rect x={80} y={630} width={960} height={270} fill="#7d552c" />
      <rect x={0} y={630} width={W} height={270} fill="#2a1b10" opacity={0.4} />
    </>
  ),

  hostel_room: () => (
    <>
      <Sky id="hr" stops={[[0, "#1c1530"], [1, "#3a2a40"]]} />
      {/* window with Skytree */}
      <rect x={560} y={90} width={480} height={360} rx={10} fill="#0d1636" stroke="#6b4a2f" strokeWidth={16} />
      {Array.from({ length: 40 }, (_, i) => (
        <circle key={i} cx={580 + ((i * 113) % 440)} cy={110 + ((i * 59) % 150)} r={1.5} fill="#fff" opacity={0.7} />
      ))}
      {/* Tokyo Tower, lit orange */}
      <path d="M800 160 L830 440 L770 440 Z" fill="none" stroke="#ff8a3d" strokeWidth={5} />
      <path d="M786 300 L814 300 M778 370 L822 370 M800 160 L800 440" stroke="#ff8a3d" strokeWidth={3} />
      <rect x={784} y={292} width={32} height={10} fill="#ffb070" />
      <Glow cx={800} cy={320} r={170} color="#ff8a3d" opacity={0.45} />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={575 + i * 38} y={380 - (i % 4) * 20} width={30} height={70 + (i % 4) * 20} fill="#1a2348" />
      ))}
      {/* bunks */}
      {[80, 1180].map((x) => (
        <g key={x} transform={`translate(${x} 160)`}>
          <rect width={340} height={700} fill="#7d552c" />
          <rect x={14} y={40} width={312} height={230} fill="#2a1d14" />
          <rect x={14} y={360} width={312} height={230} fill="#2a1d14" />
          <rect x={20} y={200} width={300} height={60} rx={12} fill="#f0e6d2" />
          <rect x={20} y={520} width={300} height={60} rx={12} fill="#f0e6d2" />
          <rect x={20} y={40} width={150} height={220} fill="#b0414f" opacity={0.8} />
          <Glow cx={170} cy={480} r={150} color="#ffcf7a" opacity={0.35} />
        </g>
      ))}
      <rect x={0} y={860} width={W} height={40} fill="#3b2a1b" />
      <Glow cx={800} cy={700} r={500} color="#ffb86b" opacity={0.18} />
    </>
  ),

  police_station: () => (
    <>
      <Sky id="ps" stops={[[0, "#dfe6e8"], [1, "#b9c4c8"]]} />
      <rect x={0} y={0} width={W} height={80} fill="#f5f8f8" />
      {Array.from({ length: 5 }, (_, i) => (
        <rect key={i} x={80 + i * 310} y={28} width={220} height={18} rx={9} fill="#ffffff"
          style={{ animation: `flicker ${7 + i * 2}s infinite` }} />
      ))}
      {/* counter windows */}
      {Array.from({ length: 4 }, (_, i) => (
        <g key={i} transform={`translate(${100 + i * 370} 160)`}>
          <rect width={320} height={320} fill="#9fb3bb" />
          <rect x={16} y={16} width={288} height={200} fill="#d9f0f7" opacity={0.75} />
          <Sign x={60} y={240} w={200} h={50} fill="#1f3c88" color="#fff" text={["受付", "遺失物", "相談", "交通"][i]} size={24} />
        </g>
      ))}
      <rect x={0} y={520} width={W} height={60} fill="#7c8d94" />
      <rect x={0} y={580} width={W} height={320} fill="#9aa6ab" />
      {/* chairs + folder */}
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={140 + i * 120} y={700} width={90} height={70} rx={14} fill="#2f6fd6" />
      ))}
      <rect x={1050} y={640} width={400} height={30} rx={6} fill="#6a5a46" />
      <rect x={1150} y={605} width={200} height={36} rx={4} fill="#e8d9a8" />
      <Glow cx={800} cy={120} r={800} color="#ffffff" opacity={0.4} />
    </>
  ),
};

/** Warm/cool grade and vignette per scene, applied over the painting. */
const GRADE: Record<string, string> = {
  narita_arrivals: "rgba(180,210,255,0.10)",
  narita_exterior: "rgba(255,220,170,0.08)",
  koban: "rgba(255,190,120,0.12)",
  station_concourse: "rgba(90,140,255,0.12)",
  train_interior: "rgba(255,240,210,0.06)",
  ueno_street_night: "rgba(130,60,255,0.16)",
  konbini_night: "rgba(200,240,255,0.06)",
  hostel_lobby: "rgba(255,170,80,0.14)",
  hostel_room: "rgba(120,90,200,0.14)",
  police_station: "rgba(150,200,210,0.10)",
};

export function Backdrop({ scene }: { scene: string }) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const paint = scenes[scene] ?? scenes.narita_arrivals;
  return (
    <div className="absolute inset-0 overflow-hidden">
      {!failed[scene] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sceneImage(scene)}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
          onError={() => setFailed((f) => ({ ...f, [scene]: true }))}
        />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full">
          {paint()}
        </svg>
      )}
      <div className="absolute inset-0" style={{ background: GRADE[scene] ?? "transparent", mixBlendMode: "soft-light" }} />
      {/* gentle depth-of-field and vignette, so the cast pops */}
      <div className="absolute inset-0 backdrop-blur-[0.6px]" />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(20,18,30,0.28) 100%)" }}
      />
    </div>
  );
}
