"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Crosshair, ExternalLink, LoaderCircle, MapPin, RefreshCw } from "lucide-react";
import type * as Leaflet from "leaflet";
import { plateLocationLabel } from "../lib/plate-location";
import "leaflet/dist/leaflet.css";
import "../registration-location-map.css";

type Props = {
  latitude: number;
  longitude: number;
  address?: string;
  neighborhood?: string;
  locationSource?: "gps" | "saved" | null;
};

export function RegistrationLocationMap({ latitude, longitude, address, neighborhood, locationSource }: Props) {
  const headingId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const tileLayerRef = useRef<Leaflet.TileLayer | null>(null);
  const coordinatesRef = useRef({ latitude, longitude });
  coordinatesRef.current = { latitude, longitude };
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [boot, setBoot] = useState(0);
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 85 && Math.abs(longitude) <= 180;
  const coordinateLabel = Number.isFinite(latitude) && Number.isFinite(longitude) ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : "Coordenadas indisponíveis";
  const addressLabel = address?.trim() || neighborhood?.trim()
    ? plateLocationLabel({ address: address ?? "", neighborhood: neighborhood ?? "", latitude, longitude }) : "";

  useEffect(() => {
    if (!valid) return;
    let disposed = false;
    let map: Leaflet.Map | null = null;
    let observer: ResizeObserver | null = null;
    let frame: number | null = null;
    setReady(false); setMapError(false); setTileError(false);
    void import("leaflet").then(L => {
      if (disposed || !containerRef.current) return;
      const current = coordinatesRef.current;
      map = L.map(containerRef.current, {
        center: [current.latitude, current.longitude], zoom: 17, minZoom: 3, maxZoom: 19,
        maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 0.8,
        zoomControl: false, attributionControl: true, keyboard: true, scrollWheelZoom: false,
      });
      mapRef.current = map;
      L.control.zoom({ zoomInTitle: "Aproximar mapa", zoomOutTitle: "Afastar mapa" }).addTo(map);
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, minZoom: 3, noWrap: true,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        referrerPolicy: "strict-origin-when-cross-origin",
        updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1,
      });
      tiles.on("tileerror", () => { if (!disposed) setTileError(true); });
      tiles.addTo(map); tileLayerRef.current = tiles;
      const icon = L.divIcon({
        className: "registration-location-pin",
        html: '<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 42s14-15 14-25A14 14 0 0 0 3 17c0 10 14 25 14 25Z" fill="#1a73e8" stroke="#fff" stroke-width="2.5"/><circle cx="17" cy="16.5" r="5.5" fill="#fff"/></svg>',
        iconSize: [34, 44], iconAnchor: [17, 43], tooltipAnchor: [0, -42],
      });
      markerRef.current = L.marker([current.latitude, current.longitude], { icon, draggable: false, keyboard: true, title: "Localização da placa", alt: "Localização da placa" })
        .bindTooltip("Localização da placa", { direction: "top" }).addTo(map);
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => { if (!disposed) map?.invalidateSize({ animate: false, pan: false }); });
        observer.observe(containerRef.current);
      }
      frame = requestAnimationFrame(() => { if (!disposed) map?.invalidateSize({ animate: false, pan: false }); });
      setReady(true);
    }).catch(() => {
      if (disposed) return;
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      map?.remove(); map = null;
      mapRef.current = null; markerRef.current = null; tileLayerRef.current = null;
      setReady(false); setMapError(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      map?.remove();
      mapRef.current = null; markerRef.current = null; tileLayerRef.current = null;
    };
  }, [boot, valid]);

  useEffect(() => {
    if (!valid || !mapRef.current || !markerRef.current) return;
    markerRef.current.setLatLng([latitude, longitude]);
    mapRef.current.setView([latitude, longitude], 17, { animate: false });
  }, [latitude, longitude, valid]);

  function recenter() {
    const map = mapRef.current;
    if (!map || !valid) return;
    map.stop();
    map.setView([latitude, longitude], 17, { animate: false });
    map.invalidateSize({ animate: false, pan: false });
  }

  function retryTiles() {
    setTileError(false);
    tileLayerRef.current?.redraw();
    recenter();
  }

  return <section className="registration-location-map" aria-labelledby={headingId}>
    <div className="registration-location-heading"><div><h3 id={headingId}><MapPin size={16} aria-hidden="true" />Localização da placa</h3><p>{locationSource === "gps" ? "Posição obtida deste aparelho" : locationSource === "saved" ? "Posição já cadastrada" : "Confira a posição no mapa"}</p></div><button type="button" className="registration-location-recenter" onClick={recenter} disabled={!ready || !valid}><Crosshair size={14} aria-hidden="true" /><span>Recentralizar localização</span></button></div>
    <div className="registration-location-viewport">
      <div ref={containerRef} className="registration-location-canvas" role="region" aria-label="Mapa da localização da placa. Arraste para explorar, use os botões para aproximar e recentralize para voltar ao pin." />
      {(!valid || mapError) ? <div className="registration-location-state" role="status"><MapPin size={25} aria-hidden="true" /><p>Não foi possível exibir o mapa. A localização continua no formulário.</p>{valid && <button type="button" onClick={() => setBoot(value => value + 1)}><RefreshCw size={14} aria-hidden="true" />Tentar novamente</button>}</div> : !ready && <div className="registration-location-state" role="status"><LoaderCircle className="spin" size={23} aria-hidden="true" /><p>Carregando localização no mapa…</p></div>}
    </div>
    {tileError && <div className="registration-location-tile-error" role="status"><p>Algumas ruas não carregaram. O pin e as coordenadas continuam disponíveis.</p><button type="button" onClick={retryTiles}><RefreshCw size={13} aria-hidden="true" />Recarregar ruas</button></div>}
    <div className="registration-location-caption"><span className="registration-location-legend"><i aria-hidden="true" />Pin azul: localização da placa</span>{addressLabel && <p>{addressLabel}</p>}<code>{coordinateLabel}</code><small>Explorar o mapa não altera a localização. Ela só será gravada ao salvar o cadastro.</small>{valid && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Ver no Google Maps <ExternalLink size={12} aria-hidden="true" /></a>}</div>
  </section>;
}
