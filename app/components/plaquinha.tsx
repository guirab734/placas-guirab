"use client";

import { useEffect, useState } from "react";
import { plaqueSvg, PLAQUE_WIDTH_MM, PLAQUE_HEIGHT_MM } from "../lib/print";

export function PlaquePreview({ url, label }: { url: string; label?: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setError(false);
    setSource(null);
    plaqueSvg(url).then(markup => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
      setSource(objectUrl);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (error) return <p role="alert">Não foi possível carregar a prévia da arte.</p>;
  if (!source) return <div style={{ aspectRatio: `${PLAQUE_WIDTH_MM} / ${PLAQUE_HEIGHT_MM}`, display: "grid", placeItems: "center", color: "#5f6368" }}>Carregando arte…</div>;
  return <img src={source} alt={`${label ? `${label}: ` : ""}prévia da plaquinha, com NFC à esquerda e QR Code à direita`} style={{ width: "100%", height: "auto", display: "block" }} />;
}
