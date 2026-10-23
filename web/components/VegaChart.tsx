"use client";

import { useEffect, useRef } from "react";

/** Renders the agent's Vega-Lite chart in the app's type and colors. */
export function VegaChart({ spec }: { spec: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let view: { finalize: () => void } | undefined;
    let cancelled = false;
    (async () => {
      const { default: embed } = await import("vega-embed");
      if (cancelled || !ref.current) return;
      const css = getComputedStyle(document.documentElement);
      const ink = css.getPropertyValue("--ink").trim();
      const mute = css.getPropertyValue("--mute").trim();
      const line = css.getPropertyValue("--line").trim();
      const accent = css.getPropertyValue("--accent").trim();
      const font = getComputedStyle(document.body).fontFamily;
      const parsed = JSON.parse(spec);
      const result = await embed(
        ref.current,
        { ...parsed, width: "container", height: 240, background: "transparent", title: undefined },
        {
          actions: false,
          renderer: "svg",
          config: {
            font,
            view: { stroke: null },
            range: { category: [accent, ink, mute] },
            mark: { color: accent },
            axis: { labelColor: mute, titleColor: mute, gridColor: line, domainColor: line, tickColor: line, labelFontSize: 11, titleFontWeight: 400 },
            legend: { labelColor: mute, titleColor: mute },
          },
        },
      );
      view = result.view;
    })().catch(() => {});
    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec]);

  const title = (() => {
    try {
      const t = JSON.parse(spec).title;
      return typeof t === "string" ? t : t?.text;
    } catch {
      return undefined;
    }
  })();

  return (
    <div className="grid gap-2">
      {title && <div className="label">{title}</div>}
      <div ref={ref} className="w-full" />
    </div>
  );
}
