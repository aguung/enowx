// Sparkline renders a tiny SVG area/line chart from a number series.
export function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  if (values.length === 0) {
    return <div className="text-[11px] text-white/30">no data yet</div>;
  }
  const w = 100;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${i * step},${height - (v / max) * height}`);
  const line = pts.join(" ");
  const area = `0,${height} ${line} ${w},${height}`;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-9 w-full">
      <polygon points={area} fill="url(#spark)" opacity="0.25" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        className="text-sky-300"
      />
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(125 211 252)" />
          <stop offset="100%" stopColor="rgb(125 211 252)" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
