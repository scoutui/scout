import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Oklch = readonly [l: number, c: number, h: number];
type Rgb = readonly [r: number, g: number, b: number];
type Theme = "light" | "dark";

const css = readFileSync(new URL("../palette.css", import.meta.url), "utf8");

/** `--pal-<name>: oklch(L C H);` declarations inside the block that follows `selector`. */
function block(selector: string): Map<string, Oklch> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out = new Map<string, Oklch>();
  for (const m of body.matchAll(/--pal-([a-z0-9-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\);/g)) {
    out.set(m[1] as string, [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  const declared = body.match(/--pal-[a-z0-9-]+\s*:/g)?.length ?? 0;
  if (declared !== out.size) {
    throw new Error(`${selector}: ${declared - out.size} --pal-* declaration(s) are not plain oklch(L C H)`);
  }
  return out;
}

const THEMES: Record<Theme, Map<string, Oklch>> = {
  light: block(":root {"),
  dark: block('[data-theme="dark"] {'),
};

function token(theme: Theme, name: string): Oklch {
  const v = THEMES[theme].get(name);
  if (!v) throw new Error(`--pal-${name} missing in ${theme}`);
  return v;
}

// OKLCH -> linear sRGB (Björn Ottosson's matrices).
function toLinear([l, c, h]: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const clamp = (rgb: Rgb): Rgb => rgb.map((v) => Math.min(1, Math.max(0, v))) as unknown as Rgb;
const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

function maxChroma(l: number, h: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(toLinear([l, mid, h]))) lo = mid;
    else hi = mid;
  }
  return lo;
}

const luminance = (rgb: Rgb) => {
  const [r, g, b] = clamp(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear RGB.
const CVD = {
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
} as const;
function simulate(rgb: Rgb, kind: keyof typeof CVD): Rgb {
  const v = clamp(rgb);
  return CVD[kind].map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as unknown as Rgb;
}

function toOklab(rgb: Rgb): Rgb {
  const [r, g, b] = clamp(rgb);
  const cbrt = (x: number) => Math.cbrt(x);
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
/** ΔE in OKLab, ×100. */
const deltaE = (a: Rgb, b: Rgb) => 100 * Math.hypot(...toOklab(a).map((v, i) => v - (toOklab(b)[i] as number)));

// sRGB alpha blend of `fg` at `alpha` over `bg` (what the browser paints for `ring-ring/50`).
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function blend(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  const f = clamp(fg);
  const g = clamp(bg);
  return f.map((v, i) => decode(alpha * encode(v) + (1 - alpha) * encode(g[i] as number))) as unknown as Rgb;
}

const rgb = (theme: Theme, name: string) => toLinear(token(theme, name));
const surfaces = (theme: Theme) => [rgb(theme, "neutral-panel"), rgb(theme, "neutral-canvas")];

describe.each(["light", "dark"] as const)("palette (%s)", (theme) => {
  it("sets text-role steps at ≥ 4.5:1 on panel and canvas", () => {
    for (const name of ["red-graphic", "orange-text", "green-graphic", "neutral-muted", "neutral-faint"]) {
      for (const surface of surfaces(theme)) {
        expect(contrast(rgb(theme, name), surface), `${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the warn text readable on its own tint", () => {
    expect(contrast(rgb(theme, "orange-text"), rgb(theme, "orange-tint"))).toBeGreaterThanOrEqual(4.5);
  });

  it("sets status graphics at ≥ 3:1 on panel and canvas, and the teal role at ≥ 3:1 on panel", () => {
    for (const name of ["red-graphic", "orange-graphic", "green-graphic"]) {
      for (const surface of surfaces(theme)) {
        expect(contrast(rgb(theme, name), surface), name).toBeGreaterThanOrEqual(3);
      }
    }
    expect(contrast(rgb(theme, "teal-graphic"), rgb(theme, "neutral-panel"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps status and teal graphics vivid: in sRGB gamut at ≥ 90% of the maximum chroma", () => {
    for (const name of ["red-graphic", "orange-graphic", "green-graphic", "teal-graphic"]) {
      const [l, c, h] = token(theme, name);
      expect(inGamut(toLinear([l, c, h])), `${name} in gamut`).toBe(true);
      expect(c / maxChroma(l, h), `${name} vibrancy`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("separates warn from error, and the teal role from warn, under deuteranopia and protanopia", () => {
    for (const [a, b] of [
      ["orange-graphic", "red-graphic"],
      ["teal-graphic", "orange-graphic"],
    ] as const) {
      for (const kind of ["deutan", "protan"] as const) {
        const d = deltaE(simulate(rgb(theme, a), kind), simulate(rgb(theme, b), kind));
        expect(d, `${a}/${b} ${kind}`).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("keeps teal, violet, blue and the Local line apart: ΔE ≥ 15, and ≥ 6 under deuteranopia and protanopia", () => {
    const lines = ["teal-graphic", "violet-graphic", "blue-graphic", "grey-soft"];
    for (const [i, a] of lines.entries()) {
      for (const b of lines.slice(i + 1)) {
        expect(deltaE(rgb(theme, a), rgb(theme, b)), `${a}/${b}`).toBeGreaterThanOrEqual(15);
        for (const kind of ["deutan", "protan"] as const) {
          const d = deltaE(simulate(rgb(theme, a), kind), simulate(rgb(theme, b), kind));
          expect(d, `${a}/${b} ${kind}`).toBeGreaterThanOrEqual(6);
        }
      }
    }
  });

  it("sets the chart colours at ≥ 3:1 on the panel", () => {
    for (const name of ["berry-graphic", "sky-graphic", "indigo-graphic", "pink-graphic"]) {
      expect(contrast(rgb(theme, name), rgb(theme, "neutral-panel")), name).toBeGreaterThanOrEqual(3);
    }
  });

  it("steps the selected fill clear of the hover band and the panel", () => {
    const [selected] = token(theme, "neutral-hover");
    const [band] = token(theme, "neutral-band");
    const [panel] = token(theme, "neutral-panel");
    expect(Math.abs(selected - band)).toBeGreaterThanOrEqual(0.02);
    expect(Math.abs(selected - panel)).toBeGreaterThanOrEqual(0.04);
  });

  it("keeps the ink focus ring at ≥ 3:1 when painted at 50% over the panel", () => {
    const panel = rgb(theme, "neutral-panel");
    expect(contrast(blend(rgb(theme, "neutral-ink"), panel, 0.5), panel)).toBeGreaterThanOrEqual(3);
  });

  it("keeps each status graphic at ≥ 3:1 on its own tint, and ink readable on it", () => {
    for (const hue of ["red", "orange", "green"]) {
      const tint = rgb(theme, `${hue}-tint`);
      expect(contrast(rgb(theme, `${hue}-graphic`), tint), `${hue} graphic on tint`).toBeGreaterThanOrEqual(3);
      expect(contrast(rgb(theme, "neutral-ink"), tint), `ink on ${hue} tint`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("palette parity", () => {
  it("declares the same primitives in both themes", () => {
    expect([...THEMES.dark.keys()].sort()).toEqual([...THEMES.light.keys()].sort());
  });
});

describe("lookalikes.json", () => {
  it("lists exactly the chart colour pairs under ΔE 15, or under 6 for deuteranopia or protanopia, in either theme", () => {
    const chart = [
      "teal-graphic",
      "violet-graphic",
      "blue-graphic",
      "berry-graphic",
      "sky-graphic",
      "indigo-graphic",
      "pink-graphic",
      "grey-graphic",
      "grey-soft",
    ];
    const themes = ["light", "dark"] as const;
    const kinds = ["deutan", "protan"] as const;
    const expected: string[] = [];
    for (const [i, a] of chart.entries()) {
      for (const b of chart.slice(i + 1)) {
        const normal = Math.min(...themes.map((t) => deltaE(rgb(t, a), rgb(t, b))));
        const cvd = Math.min(
          ...themes.flatMap((t) => kinds.map((k) => deltaE(simulate(rgb(t, a), k), simulate(rgb(t, b), k)))),
        );
        if (normal < 15 || cvd < 6) expected.push([a, b].sort().join("|"));
      }
    }
    const listed = JSON.parse(readFileSync(new URL("../lookalikes.json", import.meta.url), "utf8")) as [
      string,
      string,
    ][];
    expect(listed.map((pair) => [...pair].sort().join("|")).sort()).toEqual(expected.sort());
  });
});
