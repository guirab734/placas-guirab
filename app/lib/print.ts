import QRCode from "qrcode";

const SVG_NS = "http://www.w3.org/2000/svg";
const MM_TO_PT = 72 / 25.4;
export const PLAQUE_WIDTH_MM = 124;
export const PLAQUE_HEIGHT_MM = 144;
export const PLAQUE_SIZE_CM = `${(PLAQUE_WIDTH_MM / 10).toLocaleString("pt-BR")} × ${(PLAQUE_HEIGHT_MM / 10).toLocaleString("pt-BR")} cm`;
const PLAQUE_SIZE_MM = `${PLAQUE_WIDTH_MM} x ${PLAQUE_HEIGHT_MM} mm`;
const A4_PLAQUE_X = [20.5, 152.5];
const A4_PLAQUE_Y = 34;
const PLAQUE_PNG_DPI = 300;

export type PrintPlaque = { url: string; label?: string };
export const MAX_PRINT_BATCH = 50;

let templatePromise: Promise<string> | undefined;

function templateMarkup(): Promise<string> {
  templatePromise ??= fetch("/plaque-template.svg?v=124x144-v1", { cache: "force-cache" })
    .then(response => {
      if (!response.ok) throw new Error("Não foi possível carregar a arte. Tente novamente.");
      return response.text();
    }).catch(error => {
      templatePromise = undefined;
      throw error;
    });
  return templatePromise;
}

export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg", errorCorrectionLevel: "H", margin: 4,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

function filenameBase(value: string) { return value.replace(/\.(pdf|svg|png|zip)$/i, ""); }

export async function downloadQrSvg(url: string, filename: string) {
  saveBlob(new Blob([await qrSvg(url)], { type: "image/svg+xml" }), `${filenameBase(filename)}.svg`);
}

export async function downloadQrPng(url: string, filename: string) {
  const data = await QRCode.toDataURL(url, { errorCorrectionLevel: "H", margin: 4, width: 1800 });
  const response = await fetch(data);
  saveBlob(await response.blob(), `${filenameBase(filename)}.png`);
}

export async function plaqueSvg(url: string, _label?: string): Promise<string> {
  const doc = new DOMParser().parseFromString(await templateMarkup(), "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("A arte não pôde ser lida.");
  const overlay = doc.createElementNS(SVG_NS, "g");
  overlay.setAttribute("transform", `scale(${MM_TO_PT})`);
  const cover = doc.createElementNS(SVG_NS, "rect");
  cover.setAttribute("x", "72.4"); cover.setAttribute("y", "95.7");
  cover.setAttribute("width", "34.2"); cover.setAttribute("height", "34.2");
  cover.setAttribute("fill", "white");
  overlay.appendChild(cover);
  const qrDoc = new DOMParser().parseFromString(await qrSvg(url), "image/svg+xml");
  const qr = doc.importNode(qrDoc.documentElement, true);
  qr.setAttribute("x", "72.4"); qr.setAttribute("y", "95.7");
  qr.setAttribute("width", "34.2"); qr.setAttribute("height", "34.2");
  overlay.appendChild(qr);
  doc.documentElement.appendChild(overlay);
  return new XMLSerializer().serializeToString(doc.documentElement);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function withPngPrintResolution(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pixelsPerMeter = Math.round(PLAQUE_PNG_DPI / 0.0254);
  const resolution = new Uint8Array(21);
  const resolutionView = new DataView(resolution.buffer);
  resolutionView.setUint32(0, 9);
  resolution.set([112, 72, 89, 115], 4); // PNG pHYs chunk.
  resolutionView.setUint32(8, pixelsPerMeter);
  resolutionView.setUint32(12, pixelsPerMeter);
  resolution[16] = 1;
  resolutionView.setUint32(17, crc32(resolution.subarray(4, 17)));
  const parts: BlobPart[] = [bytes.subarray(0, 8)];
  const sourceView = new DataView(bytes.buffer);
  for (let offset = 8; offset < bytes.length;) {
    const length = sourceView.getUint32(offset);
    const end = offset + length + 12;
    const chunkType = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (chunkType !== "pHYs") parts.push(bytes.subarray(offset, end));
    if (chunkType === "IHDR") parts.push(resolution);
    offset = end;
  }
  return new Blob(parts, { type: "image/png" });
}

async function plaquePng(url: string, label?: string): Promise<Blob> {
  const markup = await plaqueSvg(url, label);
  const source = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PLAQUE_WIDTH_MM / 25.4 * PLAQUE_PNG_DPI);
  canvas.height = Math.round(PLAQUE_HEIGHT_MM / 25.4 * PLAQUE_PNG_DPI);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Não foi possível gerar a imagem da placa. Tente novamente."));
      image.src = source;
    });
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Seu navegador não conseguiu criar a imagem da placa.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error("Não foi possível salvar a imagem da placa.")), "image/png");
    });
    return await withPngPrintResolution(blob);
  } finally {
    URL.revokeObjectURL(source);
    canvas.width = 1; canvas.height = 1;
  }
}

export async function downloadPlaquePng(url: string, filename: string, label?: string) {
  saveBlob(await plaquePng(url, label), `${filenameBase(filename)}.png`);
}

function validatePrintBatch(items: PrintPlaque[]) {
  if (items.length < 1 || items.length > MAX_PRINT_BATCH) throw new Error(`Selecione de 1 a ${MAX_PRINT_BATCH} placas para imprimir.`);
  if (new Set(items.map(item => item.url)).size !== items.length) {
    throw new Error("Cada placa do lote precisa ter um QR Code diferente.");
  }
}

export async function downloadBatchPlaquePngs(items: PrintPlaque[], filename: string) {
  validatePrintBatch(items);
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  const manifest = ["placa,arquivo,url"];
  const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const label = item.label?.trim() || `Placa ${String(index + 1).padStart(3, "0")}`;
    const base = label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `Placa-${String(index + 1).padStart(3, "0")}`;
    let name = `${base}.png`;
    let suffix = 2;
    while (files[name]) name = `${base}-${suffix++}.png`;
    files[name] = new Uint8Array(await (await plaquePng(item.url, label)).arrayBuffer());
    manifest.push([label, name, item.url].map(csvCell).join(","));
  }
  files["placas.csv"] = strToU8(`\ufeff${manifest.join("\r\n")}\r\n`);
  const archive = zipSync(files, { level: 0 });
  saveBlob(new Blob([new Uint8Array(archive)], { type: "application/zip" }), `${filenameBase(filename)}.zip`);
}

async function renderableSvg(url: string, label?: string) {
  const markup = await plaqueSvg(url, label);
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const element = doc.documentElement;
  // Attach invisibly so SVG style and clip paths resolve reliably during export.
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;pointer-events:none";
  holder.appendChild(document.importNode(element, true));
  document.body.appendChild(holder);
  return { element: holder.firstElementChild!, cleanup: () => holder.remove() };
}

export async function downloadPlaquePdf(url: string, filename: string, label?: string) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({ unit: "mm", format: [PLAQUE_WIDTH_MM, PLAQUE_HEIGHT_MM], compress: true });
  pdf.viewerPreferences({ PrintScaling: "None" });
  const svg = await renderableSvg(url, label);
  try { await svg2pdf(svg.element, pdf, { x: 0, y: 0, width: PLAQUE_WIDTH_MM, height: PLAQUE_HEIGHT_MM, loadImages: false }); }
  finally { svg.cleanup(); }
  pdf.setProperties({ title: `Plaquinha Guirab - ${PLAQUE_SIZE_MM}`, subject: "Texto e QR Code em vetor; topo arredondado; imprimir em tamanho real (100%)" });
  pdf.save(`${filenameBase(filename)}.pdf`);
}

function cropMarks(pdf: import("jspdf").jsPDF, x: number) {
  pdf.setDrawColor(60, 60, 60); pdf.setLineWidth(0.15);
  for (const cx of [x, x + PLAQUE_WIDTH_MM]) for (const cy of [A4_PLAQUE_Y, A4_PLAQUE_Y + PLAQUE_HEIGHT_MM]) {
    const dx = cx === x ? -1 : 1, dy = cy === A4_PLAQUE_Y ? -1 : 1;
    pdf.line(cx + dx * 1.2, cy, cx + dx * 3, cy);
    pdf.line(cx, cy + dy * 1.2, cx, cy + dy * 3);
  }
}

function printScaleGuide(pdf: import("jspdf").jsPDF, pageLabel = "") {
  pdf.setDrawColor(80, 80, 80); pdf.setLineWidth(0.2);
  pdf.line(98.5, 184, 198.5, 184);
  pdf.line(98.5, 182.5, 98.5, 185.5); pdf.line(198.5, 182.5, 198.5, 185.5);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(80, 80, 80);
  pdf.text("Confira com uma regua: esta linha deve medir 10 cm", 148.5, 189, { align: "center" });
  pdf.text(`Imprimir em tamanho real (100%) - corte de ${PLAQUE_SIZE_MM}${pageLabel}`, 148.5, 194, { align: "center" });
}

export async function downloadA4Pdf(url: string, filename: string, label?: string) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  pdf.viewerPreferences({ PrintScaling: "None" });
  const svg = await renderableSvg(url, label);
  try {
    for (const x of A4_PLAQUE_X) {
      await svg2pdf(svg.element, pdf, { x, y: A4_PLAQUE_Y, width: PLAQUE_WIDTH_MM, height: PLAQUE_HEIGHT_MM, loadImages: false });
      cropMarks(pdf, x);
    }
  } finally { svg.cleanup(); }
  printScaleGuide(pdf);
  pdf.setProperties({ title: `Plaquinhas Guirab - duas por A4 - ${PLAQUE_SIZE_MM}`, subject: `Imprimir em tamanho real (100%); corte de ${PLAQUE_SIZE_MM}` });
  pdf.save(`${filenameBase(filename)}.pdf`);
}

export async function downloadBatchA4Pdf(items: PrintPlaque[], filename: string) {
  validatePrintBatch(items);
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  pdf.viewerPreferences({ PrintScaling: "None" });
  const pages = Math.ceil(items.length / 2);
  for (let index = 0; index < items.length; index++) {
    if (index > 0 && index % 2 === 0) pdf.addPage("a4", "landscape");
    const item = items[index];
    const x = A4_PLAQUE_X[index % 2];
    const svg = await renderableSvg(item.url, item.label);
    try {
      await svg2pdf(svg.element, pdf, { x, y: A4_PLAQUE_Y, width: PLAQUE_WIDTH_MM, height: PLAQUE_HEIGHT_MM, loadImages: false });
    } finally { svg.cleanup(); }
    cropMarks(pdf, x);
    if (index % 2 === 1 || index === items.length - 1) {
      printScaleGuide(pdf, ` - Página ${Math.floor(index / 2) + 1}/${pages}`);
    }
  }
  pdf.setProperties({ title: `Plaquinhas Guirab - lote de impressão - ${PLAQUE_SIZE_MM}`, subject: `QR Codes individuais em vetor; até duas placas por A4; corte de ${PLAQUE_SIZE_MM}; imprimir em tamanho real (100%)` });
  pdf.save(`${filenameBase(filename)}.pdf`);
}
