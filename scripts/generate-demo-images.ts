/**
 * Generates the placeholder product pictures used by supabase/seed-dev.sql.
 * Plain shapes on coloured backgrounds: no text and no photos from other
 * websites. Run with `npm run demo:images` and commit the output in public/demo.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

type Shape = "phone" | "laptop" | "station" | "charger" | "kettle" | "powerbank" | "speaker";

const SIZE = 800;

const IMAGES: { file: string; shape: Shape; background: [string, string]; body: string }[] = [
  { file: "galaxy-a15-front", shape: "phone", background: ["#dbeafe", "#bfdbfe"], body: "#1e293b" },
  { file: "galaxy-a15-back", shape: "phone", background: ["#e0e7ff", "#c7d2fe"], body: "#3b82f6" },
  { file: "redmi-note-13", shape: "phone", background: ["#fee2e2", "#fecaca"], body: "#7f1d1d" },
  { file: "spark-20-pro", shape: "phone", background: ["#dcfce7", "#bbf7d0"], body: "#14532d" },
  { file: "iphone-13-refurb", shape: "phone", background: ["#f1f5f9", "#e2e8f0"], body: "#0f172a" },
  { file: "gan-charger-65w", shape: "charger", background: ["#fef9c3", "#fde68a"], body: "#f8fafc" },
  { file: "thinkpad-e14", shape: "laptop", background: ["#e2e8f0", "#cbd5e1"], body: "#111827" },
  { file: "pavilion-15", shape: "laptop", background: ["#e0f2fe", "#bae6fd"], body: "#475569" },
  { file: "river-2-pro-front", shape: "station", background: ["#ffedd5", "#fed7aa"], body: "#334155" },
  { file: "river-2-pro-side", shape: "station", background: ["#fef3c7", "#fde68a"], body: "#1f2937" },
  { file: "kettle-1-7l", shape: "kettle", background: ["#fce7f3", "#fbcfe8"], body: "#e2e8f0" },
  { file: "galaxy-s21-used", shape: "phone", background: ["#ede9fe", "#ddd6fe"], body: "#4c1d95" },
  { file: "power-bank-20000", shape: "powerbank", background: ["#ccfbf1", "#99f6e4"], body: "#0f766e" },
  { file: "flip-6-speaker", shape: "speaker", background: ["#ffe4e6", "#fecdd3"], body: "#be123c" },
];

function shapeSvg(shape: Shape, body: string): string {
  const screen = "#94a3b8";
  switch (shape) {
    case "phone":
      return `<rect x="290" y="130" width="220" height="540" rx="36" fill="${body}"/>
              <rect x="306" y="170" width="188" height="460" rx="14" fill="${screen}"/>
              <circle cx="400" cy="150" r="7" fill="#64748b"/>`;
    case "laptop":
      return `<rect x="190" y="220" width="420" height="270" rx="18" fill="${body}"/>
              <rect x="208" y="238" width="384" height="234" rx="8" fill="${screen}"/>
              <path d="M130 510 H670 L640 560 H160 Z" fill="#64748b"/>`;
    case "station":
      return `<rect x="200" y="260" width="400" height="300" rx="24" fill="${body}"/>
              <path d="M300 260 V220 H500 V260" fill="none" stroke="#64748b" stroke-width="20" stroke-linecap="round"/>
              <rect x="240" y="300" width="140" height="70" rx="8" fill="#22c55e"/>
              <circle cx="450" cy="335" r="22" fill="#94a3b8"/><circle cx="520" cy="335" r="22" fill="#94a3b8"/>
              <circle cx="290" cy="460" r="22" fill="#94a3b8"/><circle cx="360" cy="460" r="22" fill="#94a3b8"/>
              <circle cx="430" cy="460" r="22" fill="#94a3b8"/>`;
    case "charger":
      return `<rect x="290" y="250" width="220" height="250" rx="30" fill="${body}" stroke="#94a3b8" stroke-width="6"/>
              <rect x="350" y="170" width="18" height="80" fill="#64748b"/><rect x="432" y="170" width="18" height="80" fill="#64748b"/>
              <rect x="360" y="420" width="80" height="30" rx="8" fill="#94a3b8"/>`;
    case "kettle":
      return `<path d="M270 270 H530 L560 560 H240 Z" fill="${body}" stroke="#94a3b8" stroke-width="6"/>
              <path d="M530 300 C640 300 640 480 540 480" fill="none" stroke="#64748b" stroke-width="22" stroke-linecap="round"/>
              <path d="M270 300 L200 260" stroke="#64748b" stroke-width="22" stroke-linecap="round"/>
              <rect x="320" y="220" width="160" height="50" rx="14" fill="#64748b"/>`;
    case "powerbank":
      return `<rect x="260" y="200" width="280" height="400" rx="34" fill="${body}"/>
              <circle cx="330" cy="280" r="14" fill="#a7f3d0"/><circle cx="385" cy="280" r="14" fill="#a7f3d0"/>
              <circle cx="440" cy="280" r="14" fill="#a7f3d0"/><circle cx="495" cy="280" r="14" fill="#64748b"/>
              <rect x="320" y="520" width="80" height="26" rx="8" fill="#0f172a"/><rect x="420" y="520" width="80" height="26" rx="8" fill="#0f172a"/>`;
    case "speaker":
      return `<rect x="170" y="290" width="460" height="220" rx="110" fill="${body}"/>
              ${Array.from({ length: 5 }, (_, row) =>
                Array.from(
                  { length: 12 },
                  (_, column) =>
                    `<circle cx="${230 + column * 30}" cy="${330 + row * 30}" r="6" fill="#fda4af"/>`,
                ).join(""),
              ).join("")}`;
  }
}

function toSvg({ shape, background, body }: (typeof IMAGES)[number]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${background[0]}"/><stop offset="1" stop-color="${background[1]}"/>
    </linearGradient></defs>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
    <ellipse cx="400" cy="640" rx="210" ry="22" fill="#0f172a" opacity="0.12"/>
    ${shapeSvg(shape, body)}
  </svg>`;
}

async function main(): Promise<void> {
  const directory = path.join(process.cwd(), "public", "demo");
  await mkdir(directory, { recursive: true });
  for (const image of IMAGES) {
    const file = path.join(directory, `${image.file}.webp`);
    const info = await sharp(Buffer.from(toSvg(image)))
      .webp({ quality: 78 })
      .toFile(file);
    console.log(`${image.file}.webp  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(1)} KB`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
