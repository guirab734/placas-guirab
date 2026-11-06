"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, CheckCircle2, ChevronDown, ClipboardList, Copy, ExternalLink, History, Link2, LoaderCircle, MapPin, MessageSquareText, Pencil, Phone, Printer, RotateCcw, ShieldCheck, Store, UserRound, X } from "lucide-react";
import type { Loja } from "../lib/types";
import "../fieldwork-next.css";

type ArchivedRecord = { id: string; createdAt: string; snapshot: Loja };
type Props = { loja: Loja; label: string; onClose: () => void; onEdit: (loja: Loja) => void; onPrint: (loja: Loja) => void; onChanged: (loja: Loja) => void };
const count = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("pt-BR");
const dateOnly = (value: string | null | undefined) => value ? value.slice(0, 10).split("-").reverse().join("/") : "Não informada";
function timestamp(value: string | null | undefined) { if (!value) return "Ainda sem atualização"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date); }
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  const result = await response.json().catch(() => null) as (T & { error?: string; message?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error || result?.message || "Não foi possível concluir. Tente novamente.");
  return result;
}

export function EstablishmentRecord({ loja, label, onClose, onEdit, onPrint, onChanged }: Props) {
  const [history, setHistory] = useState<ArchivedRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const drawerRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cancelResetRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const confirmOpenRef = useRef(false);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  confirmOpenRef.current = confirmReset;
  busyRef.current = Boolean(busy);
  onCloseRef.current = onClose;
  const available = !loja.targetUrl.trim();
  const permanentUrl = `https://placas.guirab.com.br/r/${encodeURIComponent(loja.code)}`;
  const initial = loja.initialReviews, current = loja.currentReviews;
  const difference = initial == null || current == null ? null : current - initial;
  const percentage = initial != null && initial > 0 && difference != null ? difference / initial * 100 : null;
  const signed = (value: number, suffix = "") => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(value)}${suffix}`;
  const phoneNumber = (loja.ownerPhone || "").replace(/[^\d+]/g, "");
  const businessNumber = (loja.businessPhone || "").replace(/[^\d+]/g, "");

  useEffect(() => { setCopyState("idle"); }, [loja.code]);
  async function copyPermanentLink() {
    try {
      await navigator.clipboard.writeText(permanentUrl);
      setCopyState("copied");
    } catch { setCopyState("error"); }
  }

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); if (confirmOpenRef.current) setConfirmReset(false); else onCloseRef.current(); }
      if (event.key !== "Tab") return;
      const container = confirmOpenRef.current ? confirmRef.current : drawerRef.current;
      const nodes = container?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", handleKey); before?.focus(); };
  }, []);
  useEffect(() => { if (confirmReset) cancelResetRef.current?.focus(); else if (document.activeElement === document.body) resetRef.current?.focus(); }, [confirmReset]);
  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true); setHistoryError("");
    void request<{ historico: ArchivedRecord[] }>(`/api/lojas/${encodeURIComponent(loja.id)}/historico`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setHistory(result.historico); }).catch((failure) => { if (!controller.signal.aborted) setHistoryError(failure instanceof Error ? failure.message : "Não foi possível carregar o histórico."); }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [loja.id, loja.updatedAt, historyRevision]);

  async function resetPlate() {
    if (busy) return;
    setBusy("reset"); setActionError(""); setStatus("");
    try {
      const result = await request<{ loja: Loja }>(`/api/lojas/${encodeURIComponent(loja.id)}/redefinir`, { method: "POST", body: JSON.stringify({ confirm: true }) });
      onChanged(result.loja); setConfirmReset(false); setHistoryRevision((version) => version + 1); setStatus("Placa liberada. O cadastro anterior está no histórico e pode ser restaurado.");
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : "Não foi possível redefinir a placa."); }
    finally { setBusy(null); }
  }
  async function restoreRecord(historyId: string) {
    if (busy) return;
    setBusy(historyId); setActionError(""); setStatus("");
    try {
      const result = await request<{ loja: Loja }>(`/api/lojas/${encodeURIComponent(loja.id)}/restaurar`, { method: "POST", body: JSON.stringify({ historyId }) });
      onChanged(result.loja); setHistoryRevision((version) => version + 1); setStatus("Cadastro restaurado. O endereço permanente da placa foi preservado.");
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : "Não foi possível restaurar o cadastro."); }
    finally { setBusy(null); }
  }

  return <div className="crm-drawer-overlay field-dossier" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="crm-drawer" ref={drawerRef} role="dialog" aria-modal={!confirmReset} aria-labelledby="crm-record-title" inert={confirmReset}>
      <header className="crm-drawer-header"><div className="crm-dossier-code"><span className="crm-kicker">CÓDIGO DA PLACA</span><h2 id="crm-record-title">{loja.code}</h2></div><div className="crm-dossier-caption"><span>Ficha do estabelecimento</span><strong>{label}</strong></div><button className="icon-button" ref={closeRef} onClick={onClose} disabled={Boolean(busy)} aria-label="Fechar ficha"><X size={21} /></button></header>
      <div className="crm-drawer-scroll">
        <section className="crm-record-identity"><span className={`crm-business-avatar${available ? " available" : ""}`}><Store size={28} /></span><div><span className="crm-dossier-eyebrow">{available ? "EM ESTOQUE" : "ESTABELECIMENTO VINCULADO"}</span><h3>{available && (!loja.name || loja.name === label || loja.name === label.split(" · ")[0]) ? "Pronta para uma nova loja." : loja.name}</h3><p className="crm-dossier-address"><MapPin size={14} />{[loja.address, loja.neighborhood].filter(Boolean).join(" · ") || "Localização ainda não cadastrada"}</p></div><span className={`status-badge ${available ? "available" : loja.active ? "active" : "paused"}`}><i />{available ? "Disponível" : loja.active ? "Ativa" : "Pausada"}</span></section>
        <div className="crm-dossier-ribbon"><span><CalendarDays size={15} />Adesão <b>{dateOnly(loja.joinedAt)}</b></span><span><Phone size={15} />Responsável <b>{loja.ownerName || "Não informado"}</b></span><span><Link2 size={15} />Acessos ao link <b>{Number(loja.scans || 0).toLocaleString("pt-BR")}</b></span><span><History size={15} />Último acesso <b>{loja.lastAccess ? timestamp(loja.lastAccess) : "Nenhum ainda"}</b></span></div>
        <div className="crm-record-actions"><button className="button primary" onClick={() => onEdit(loja)} disabled={Boolean(busy)}><Pencil size={15} />Editar cadastro</button><button className="button secondary" onClick={() => onPrint(loja)} disabled={Boolean(busy)}><Printer size={15} />Impressão</button></div>
        {status && <div className="crm-feedback success" role="status"><CheckCircle2 size={17} /><span>{status}</span></div>}
        {actionError && !confirmReset && <div className="crm-feedback error" role="alert">{actionError}</div>}
        <section className="crm-reviews-section" aria-labelledby="crm-reviews-title"><div className="crm-section-heading"><div><h3 id="crm-reviews-title">Evolução das avaliações</h3><p>O resultado desde que esta placa chegou.</p></div><ClipboardList size={19} /></div><div className="crm-review-cards"><div><span>Avaliações na adesão</span><strong>{count(initial)}</strong><small>ponto de partida</small></div><div><span>Avaliações atuais</span><strong>{count(current)}</strong><small>última contagem cadastrada</small></div><div className={`crm-growth ${difference != null && difference < 0 ? "negative" : ""}`}><span>Crescimento</span><strong>{percentage != null ? signed(percentage, "%") : difference != null ? signed(difference) : "—"}{difference != null && difference !== 0 && (difference > 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />)}</strong><small>{difference == null ? "informe as duas contagens" : percentage == null ? "sem base percentual" : `${signed(difference)} avaliações`}</small></div></div><p className="crm-manual-note">{initial === 0 && difference != null ? "Base inicial zero: o aumento aparece em quantidade, sem percentual. " : "O percentual é calculado a partir das contagens cadastradas. "}<span>Atualização da contagem: {timestamp(loja.reviewsUpdatedAt)}.</span></p></section>
        <div className="crm-dossier-grid">
        <section className="crm-info-section"><div className="crm-section-heading"><h3>Cadastro e contato</h3><UserRound size={18} /></div><dl className="crm-info-grid"><div><dt><CalendarDays size={14} />Data de adesão</dt><dd>{dateOnly(loja.joinedAt)}</dd></div><div><dt><CalendarDays size={14} />Próximo contato</dt><dd>{loja.nextContactAt ? dateOnly(loja.nextContactAt) : "Não agendado"}</dd></div><div><dt><UserRound size={14} />Responsável</dt><dd>{loja.ownerName || "Não informado"}</dd></div><div><dt><Phone size={14} />Telefone do responsável</dt><dd>{phoneNumber ? <a href={`tel:${phoneNumber}`}>{loja.ownerPhone}</a> : "Não informado"}</dd></div><div className="wide"><dt><Phone size={14} />Telefone comercial</dt><dd>{businessNumber ? <a href={`tel:${businessNumber}`}>{loja.businessPhone}</a> : "Não informado"}</dd></div><div className="wide"><dt><MapPin size={14} />Endereço</dt><dd>{loja.address || "Não informado"}</dd></div><div><dt><MapPin size={14} />Bairro</dt><dd>{loja.neighborhood || "Não informado"}</dd></div><div><dt><MapPin size={14} />Coordenadas</dt><dd>{loja.latitude != null && loja.longitude != null ? `${loja.latitude.toFixed(6)}, ${loja.longitude.toFixed(6)}` : "Não informadas"}</dd></div></dl></section>
        <section className="crm-notes-section"><div className="crm-section-heading"><h3>Observações</h3><MessageSquareText size={18} /></div><p className={!loja.notes ? "empty" : ""}>{loja.notes || "Nenhuma observação registrada."}</p></section>
        </div>
        <div className="crm-permanent-link"><Link2 size={16} /><div><span>Endereço permanente da placa · use também no NFC</span><code>{permanentUrl}</code></div><div className="crm-permanent-actions"><button type="button" className="button secondary" onClick={() => void copyPermanentLink()} aria-label={`Copiar link permanente da placa ${loja.code}`}>{copyState === "copied" ? <CheckCircle2 size={15} /> : <Copy size={15} />}{copyState === "copied" ? "Link copiado" : "Copiar link"}</button><a className="button secondary" href={permanentUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Testar placa</a></div>{copyState !== "idle" && <p className={`crm-copy-feedback${copyState === "error" ? " error" : ""}`} role={copyState === "error" ? "alert" : "status"}>{copyState === "copied" ? "Link copiado. Você já pode gravá-lo na etiqueta NFC." : "O navegador não permitiu copiar. Selecione e copie o endereço acima."}</p>}</div>
        <section className="crm-history-section" aria-labelledby="crm-history-title"><div className="crm-section-heading"><div><h3 id="crm-history-title">Histórico de cadastros</h3><p>Os dados arquivados continuam disponíveis.</p></div><History size={19} /></div>{historyLoading ? <div className="crm-history-state" role="status"><LoaderCircle size={19} className="spin" />Carregando histórico…</div> : historyError ? <div className="crm-history-state error" role="alert"><p>{historyError}</p><button className="text-button" onClick={() => setHistoryRevision((version) => version + 1)}>Tentar novamente</button></div> : !history.length ? <div className="crm-history-state"><History size={20} /><p>Nenhum cadastro arquivado para esta placa.</p></div> : <div className="crm-history-list">{history.map((entry) => <article className="crm-history-entry" key={entry.id}><div className="crm-history-entry-heading"><div><strong>{entry.snapshot.targetUrl ? entry.snapshot.name : "Placa sem loja"}</strong><span>Arquivado em {timestamp(entry.createdAt)}</span></div><button className="button secondary" disabled={Boolean(busy)} onClick={() => void restoreRecord(entry.id)}>{busy === entry.id ? <LoaderCircle size={13} className="spin" /> : <RotateCcw size={13} />}Restaurar</button></div><div className="crm-history-counts"><span>Inicial <b>{count(entry.snapshot.initialReviews)}</b></span><span>Atual <b>{count(entry.snapshot.currentReviews)}</b></span><span>Adesão <b>{dateOnly(entry.snapshot.joinedAt)}</b></span></div><details><summary>Ver cadastro arquivado<ChevronDown size={12} /></summary><dl className="crm-history-detail"><div><dt>Responsável</dt><dd>{entry.snapshot.ownerName || "Não informado"}</dd></div><div><dt>Telefone</dt><dd>{entry.snapshot.ownerPhone || "Não informado"}</dd></div><div><dt>Endereço</dt><dd>{[entry.snapshot.address, entry.snapshot.neighborhood].filter(Boolean).join(" · ") || "Não informado"}</dd></div><div><dt>Próximo contato</dt><dd>{entry.snapshot.nextContactAt ? dateOnly(entry.snapshot.nextContactAt) : "Não agendado"}</dd></div><div><dt>Observações</dt><dd>{entry.snapshot.notes || "Nenhuma"}</dd></div><div><dt>Link de avaliação</dt><dd>{entry.snapshot.targetUrl || "Sem destino"}</dd></div></dl></details></article>)}</div>}</section>
        <section className="crm-reset-section"><div><h3>Redefinir placa</h3><p>Libere para outro estabelecimento, mantendo o QR Code.</p></div><button className="button secondary" ref={resetRef} onClick={() => { setActionError(""); setConfirmReset(true); }} disabled={Boolean(busy)}><RotateCcw size={14} />Redefinir</button></section>
      </div>
      <footer className="crm-drawer-footer"><ShieldCheck size={13} />Cadastro protegido no seu painel.</footer>
    </div>
    {confirmReset && <div className="crm-confirm-overlay"><div className="crm-confirm-dialog" ref={confirmRef} role="alertdialog" aria-modal="true" aria-labelledby="crm-reset-title" aria-describedby="crm-reset-description"><span className="crm-reset-icon"><RotateCcw size={25} /></span><h2 id="crm-reset-title">Liberar {label.toLocaleLowerCase("pt-BR")}?</h2><p id="crm-reset-description">O cadastro e as contagens atuais serão arquivados. A placa volta a ficar disponível, com campos vazios para o próximo estabelecimento. O número e o QR Code permanecem os mesmos.</p><div className="crm-reset-assurance"><History size={17} /><span>Você poderá restaurar o cadastro anterior pelo histórico.</span></div>{actionError && <div className="crm-feedback error" role="alert">{actionError}</div>}<div className="crm-confirm-actions"><button className="button secondary" ref={cancelResetRef} onClick={() => setConfirmReset(false)} disabled={Boolean(busy)}>Cancelar</button><button className="button crm-danger-button" onClick={() => void resetPlate()} disabled={Boolean(busy)}>{busy === "reset" ? <LoaderCircle size={16} className="spin" /> : <RotateCcw size={16} />}{busy === "reset" ? "Redefinindo…" : "Redefinir e liberar placa"}</button></div></div></div>}
  </div>;
}
