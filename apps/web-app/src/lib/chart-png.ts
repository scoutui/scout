import chartColorData from "@scoutui/palette/chart-colors.json";
import {
  type ChartFigure,
  type ChartFigureInput,
  chartFigure,
  type FigureColorRole,
  type FigurePoint,
  type FigureText,
} from "@/lib/chart-figure";

const SCALE = 2;

const ROLE_PRIMITIVES: Record<FigureColorRole, string> = {
  background: "neutral-panel",
  ink: "neutral-ink",
  muted: "neutral-muted",
  grid: "neutral-hairline",
};

const LINE_WIDTH = 2.5;
const DOT_RADIUS = 4;
const DOT_RING = 2;
const AREA_ALPHA = 0.3;
const AREA_EDGE = 2;
const SWATCH = 10;
const SWATCH_GAP = 8;
const VALUE_GAP = 8;
const ELLIPSIS = "…";

/** The parts of a canvas 2D context that `paintFigure` draws with. */
export type FigureContext = Pick<
  CanvasRenderingContext2D,
  | "font"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineJoin"
  | "lineCap"
  | "textAlign"
  | "textBaseline"
  | "globalAlpha"
  | "scale"
  | "fillRect"
  | "fillText"
  | "measureText"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "arc"
  | "fill"
  | "stroke"
>;

/** CSS font families for the figure's sans and mono text. */
export type FigureFonts = { sans: string; mono: string };

/** What `chartFigure` takes, apart from the colours, which `chartPng` reads from the page. */
export type ChartPngInput = Omit<ChartFigureInput, "colors">;

/** The chart as a 2560 × 1440 PNG in the light theme's colours, whatever theme the page shows. */
export async function chartPng(input: ChartPngInput): Promise<Blob> {
  await document.fonts.ready;
  const figure = chartFigure({ ...input, colors: lightChartColors() });
  if (figure === null) throw new Error("This chart has no image to export.");
  const canvas = document.createElement("canvas");
  canvas.width = figure.width * SCALE;
  canvas.height = figure.height * SCALE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("This browser can't draw the chart's image.");
  paintFigure(ctx, figure, pageFonts());
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("This browser can't draw the chart's image."))), "image/png");
  });
}

/**
 * The light theme's value for every chart colour token and each figure colour role, read from the `:root` rules
 * that declare the palette's `--pal-*` primitives. Sheets the page can't read are skipped.
 */
export function lightChartColors(sheets: Iterable<CSSStyleSheet> = document.styleSheets): Record<string, string> {
  const roots = rootStyles(sheets);
  const colors: Record<string, string> = {};
  const add = (key: string, primitive: string) => {
    for (const style of roots) {
      const value = style.getPropertyValue(`--pal-${primitive}`).trim();
      if (value !== "") colors[key] = value;
    }
  };
  for (const { token, primitive } of [...chartColorData.order, ...chartColorData.fixed]) add(token, primitive);
  for (const [role, primitive] of Object.entries(ROLE_PRIMITIVES)) add(role, primitive);
  return colors;
}

function rootStyles(sheets: Iterable<CSSStyleSheet>): CSSStyleDeclaration[] {
  const styles: CSSStyleDeclaration[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if ("selectorText" in rule && "style" in rule && String(rule.selectorText).split(",").some((s) => s.trim() === ":root")) {
        styles.push(rule.style as CSSStyleDeclaration);
      }
      if ("cssRules" in rule) visit(rule.cssRules as CSSRuleList);
    }
  };
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    visit(rules);
  }
  return styles;
}

function pageFonts(): FigureFonts {
  const style = getComputedStyle(document.documentElement);
  return { sans: style.getPropertyValue("--font-sans").trim(), mono: style.getPropertyValue("--font-mono").trim() };
}

/** Draws a figure at twice its size, so a 1280 × 720 figure fills a 2560 × 1440 canvas. */
export function paintFigure(ctx: FigureContext, figure: ChartFigure, fonts: FigureFonts): void {
  const { palette, plot, marks } = figure;
  const sans = (weight: number, size: number) => `${weight} ${size}px ${fonts.sans}`;
  const mono = (size: number) => `400 ${size}px ${fonts.mono}`;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, figure.width, figure.height);

  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (const tick of figure.yTicks) {
    ctx.beginPath();
    ctx.moveTo(plot.x, tick.y);
    ctx.lineTo(plot.x + plot.width, tick.y);
    ctx.stroke();
  }
  for (const label of [...figure.yTicks, ...figure.xLabels]) write(ctx, label, sans(400, 14), palette.muted);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (marks.kind === "lines") {
    for (const line of marks.lines) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = LINE_WIDTH;
      trace(ctx, line.points);
      ctx.stroke();
      const end = line.points.at(-1);
      if (end) {
        ctx.beginPath();
        ctx.arc(end.x, end.y, DOT_RADIUS, 0, 2 * Math.PI);
        ctx.fillStyle = line.color;
        ctx.fill();
        ctx.strokeStyle = palette.background;
        ctx.lineWidth = DOT_RING;
        ctx.stroke();
      }
    }
    for (const label of marks.endLabels) write(ctx, label, mono(14), label.color);
  } else if (marks.kind === "areas") {
    for (const area of marks.areas) {
      trace(ctx, [...area.top, ...[...area.bottom].reverse()]);
      ctx.closePath();
      ctx.fillStyle = area.color;
      ctx.globalAlpha = AREA_ALPHA;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = area.color;
      ctx.lineWidth = AREA_EDGE;
      trace(ctx, area.top);
      ctx.stroke();
    }
  } else {
    for (const bar of marks.bars) {
      ctx.fillStyle = bar.color;
      ctx.fillRect(bar.rect.x, bar.rect.y, bar.rect.width, bar.rect.height);
      write(ctx, bar.name, mono(15), palette.ink);
      write(ctx, bar.value, mono(15), palette.ink);
    }
  }

  for (const entry of figure.legend) {
    ctx.fillStyle = entry.color;
    ctx.fillRect(entry.x, entry.y - SWATCH / 2, SWATCH, SWATCH);
    ctx.font = mono(15);
    const valueWidth = ctx.measureText(entry.value).width;
    const labelX = entry.x + SWATCH + SWATCH_GAP;
    const label = fit(ctx, entry.label, entry.width - SWATCH - SWATCH_GAP - VALUE_GAP - valueWidth);
    write(ctx, { text: label, x: labelX, y: entry.y, align: "left", maxWidth: Number.POSITIVE_INFINITY }, mono(15), palette.ink);
    const valueX = labelX + ctx.measureText(label).width + VALUE_GAP;
    write(ctx, { text: entry.value, x: valueX, y: entry.y, align: "left", maxWidth: valueWidth }, mono(15), palette.muted);
  }

  write(ctx, figure.title, sans(600, 30), palette.ink);
  write(ctx, figure.subtitle, sans(400, 18), palette.muted);
  write(ctx, figure.footer, sans(400, 14), palette.muted);
}

function trace(ctx: FigureContext, points: FigurePoint[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

function write(ctx: FigureContext, text: FigureText, font: string, color: string): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = text.align;
  ctx.fillText(fit(ctx, text.text, text.maxWidth), text.x, text.y);
}

function fit(ctx: FigureContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  for (let end = text.length - 1; end > 0; end--) {
    const shortened = `${text.slice(0, end).trimEnd()}${ELLIPSIS}`;
    if (ctx.measureText(shortened).width <= maxWidth) return shortened;
  }
  return ELLIPSIS;
}
