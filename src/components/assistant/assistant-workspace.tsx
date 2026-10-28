"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, AudioLines, Camera, FileText, ImagePlus, Info, Mic, Paperclip, RotateCcw, ShieldCheck, Square, X, Plus, History, Pencil, Trash2 } from "lucide-react";
import { z } from "zod";
import { assistantResponseSchema, type AssistantResponse } from "@/lib/business/assistant-response";
import { pendingClarificationSchema, type recentTurnSchema } from "@/lib/ai/types/tool-call";
import type { ShoppingDraft } from "@/lib/assistant/shopping-list";
import { startVoiceRecording, type VoiceRecording } from "@/lib/ai/capture";
import type { VoiceState } from "@/features/assistant/voice-states";
import { VoiceStateIndicator } from "./voice-state-indicator";
import { ShoppingListResult } from "./shopping-list-result";

type AttachmentPreview = { name: string; kind: "image" | "pdf"; url: string };
type Message = { id: number; persistedId?: string; role: "user" | "assistant"; text: string; attachment?: AttachmentPreview; result?: AssistantResponse; failed?: boolean };
type ProviderMode = "mock" | "gnani";
type ReasonerMode = "mock" | "openrouter" | "gemini";
type RecentTurn = z.infer<typeof recentTurnSchema>;
type ConversationSummary = { id: string; title: string; updated_at: string };
const threadListSchema = z.object({ conversations: z.array(z.object({ id: z.uuid(), title: z.string(), updated_at: z.string() })) });
const threadSchema = z.object({ id: z.uuid(), title: z.string(), pending: pendingClarificationSchema.nullable(), messages: z.array(z.object({
  id: z.uuid(), role: z.enum(["user", "assistant"]), text: z.string(), result: assistantResponseSchema.nullable(),
  request_key: z.uuid(), created_at: z.string(),
})) });

const examples = [
  "Maggi ke 20 packet add kar do",
  "Sharma ji ka kitna udhaar hai?",
  "Shopping list: Maggi 2, Parle-G 3",
  "Aaj ki sale batao",
];
const transcriptSchema = z.object({ text: z.string().trim().min(1), language: z.string().optional() });
const errorSchema = z.object({ error: z.string().min(1).max(250) });
const pause = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

export function AssistantWorkspace({ connected, providerMode, reasonerMode, voiceAvailable, expanded = true, onClose }: {
  connected: boolean; providerMode: ProviderMode; reasonerMode: ReasonerMode; voiceAvailable: boolean;
  expanded?: boolean; onClose?: () => void;
}) {
  const router = useRouter();
  const recording = useRef<VoiceRecording | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pdfInput = useRef<HTMLInputElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const attachmentTrigger = useRef<HTMLButtonElement | null>(null);
  const attachmentMenu = useRef<HTMLDivElement | null>(null);
  const objectUrls = useRef<string[]>([]);
  const latestMessage = useRef<HTMLElement | null>(null);
  const nextId = useRef(1);
  const promptRequest = useRef<{ text: string; key: string } | null>(null);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<{ file: File; preview: AttachmentPreview } | null>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<z.infer<typeof pendingClarificationSchema> | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(connected);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const activeThread = useRef<string | null>(null);
  const initialLoad = useRef<Promise<void> | null>(null);
  const [inactiveDrafts, setInactiveDrafts] = useState<number[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceLanguage, setVoiceLanguage] = useState<"hi-IN" | "en-IN">("hi-IN");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [speechUrl, setSpeechUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [workingOn, setWorkingOn] = useState<"request" | "attachment" | "voice">("request");
  const [lastPrompt, setLastPrompt] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [action, setAction] = useState<AssistantResponse | null>(null);

  function pendingLabel() {
    if (!pending) return "";
    switch (pending.kind) {
      case "open-account-amount": return `Opening ${pending.customer}'s khata · enter the opening amount.`;
      case "product-create-price": return `Adding ${pending.openingStock} ${pending.unit}(s) of ${pending.product} · enter its selling price in rupees.`;
      case "product-create-confirm": return `Review ${pending.openingStock} ${pending.unit}(s) of ${pending.product} at ₹${pending.sellingPrice} each. Nothing has been saved. Reply yes or cancel.`;
      case "product-create-unit": return `Adding ${pending.openingStock} of ${pending.product} · enter its unit.`;
      case "product-action-choice": return `Is ${pending.product} a new product or existing stock?`;
      case "product-existing-confirm": return `Confirm adding ${pending.delta} to existing ${pending.product} stock.`;
      case "khata-create-confirm": return `Confirm opening ${pending.customer}'s khata with ₹${pending.amountRupees}.`;
      case "khata-currency-confirm": return `Confirm ₹${pending.amountRupees} for ${pending.customer}; khata is recorded in INR.`;
      case "customer-name": return "Enter the customer's name.";
      case "supplier-name": return "Enter the supplier's name.";
      case "order-supplier": return "Choose a saved supplier for this purchase-order draft.";
      case "order-transition-confirm": return `Confirm ${pending.action} for ${pending.orderLabel} (currently ${pending.currentStatus}).`;
      case "order-transition-select": return "Choose one purchase order by ID or supplier name.";
    }
  }

  function pendingPlaceholder() {
    if (!pending) return "Ask about stock, khata or a shopping list…";
    switch (pending.kind) {
      case "open-account-amount": return "e.g. 100 rupaye";
      case "product-create-price": return `Price in rupees per ${pending.unit}`;
      case "product-create-confirm": return "Reply yes to create, or cancel";
      case "product-create-unit": return "Unit, e.g. packet";
      case "product-action-choice": return "Reply new or existing";
      case "product-existing-confirm":
      case "khata-create-confirm":
      case "order-transition-confirm": return "Reply yes or cancel";
      case "khata-currency-confirm": return "Confirm INR or cancel";
      case "customer-name": return "Customer name";
      case "supplier-name": return "Supplier name";
      case "order-supplier": return "Saved supplier name";
      case "order-transition-select": return "Order ID or supplier name";
    }
  }

  useEffect(() => {
    if (messages.length > 0) latestMessage.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [messages.length]);

  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") { setAttachmentMenuOpen(false); attachmentTrigger.current?.focus(); }
      if (event instanceof MouseEvent && !attachmentMenu.current?.contains(event.target as Node)) setAttachmentMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [attachmentMenuOpen]);

  useEffect(() => () => {
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    void recording.current?.cancel();
    player.current?.pause();
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function loadThread(id: string) {
    const response = await fetch(`/api/assistant/conversations?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("This conversation could not be loaded.");
    const thread = threadSchema.parse(await response.json());
    activeThread.current = thread.id;
    setConversationId(thread.id);
    setMessages(thread.messages.map((message, index) => ({ id: index + 1, persistedId: message.id, role: message.role, text: message.text,
      result: message.result ?? undefined, failed: message.result?.state === "failed" })));
    nextId.current = thread.messages.length + 1;
    setPending(thread.pending);
    const lastResult = [...thread.messages].reverse().find((message) => message.result)?.result ?? null;
    setAction(lastResult);
    const usedDrafts = new Set(thread.messages.flatMap((message) => message.result?.sourceDraftId ? [message.result.sourceDraftId] : []));
    setInactiveDrafts(thread.messages.flatMap((message, index) => message.result?.state === "draft" && usedDrafts.has(message.id) ? [index + 1] : []));
    setRetryable(false);
    try { localStorage.setItem("dukaansaathi-assistant-thread", id); } catch { /* Session still works. */ }
  }

  async function refreshConversations(preferred?: string) {
    const response = await fetch("/api/assistant/conversations", { cache: "no-store" });
    if (!response.ok) throw new Error("Conversation history is unavailable. Store actions are paused.");
    const list = threadListSchema.parse(await response.json()).conversations;
    setConversations(list);
    let id = preferred && list.some((item) => item.id === preferred) ? preferred : null;
    if (!id) {
      let saved: string | null = null;
      try { saved = localStorage.getItem("dukaansaathi-assistant-thread"); } catch { /* Use latest. */ }
      id = saved && list.some((item) => item.id === saved) ? saved : list[0]?.id ?? null;
    }
    if (!id) {
      const created = await fetch("/api/assistant/conversations", { method: "POST" });
      if (!created.ok) throw new Error("Conversation could not be created. Store actions are paused.");
      id = z.object({ id: z.uuid() }).parse(await created.json()).id;
      setConversations([{ id, title: "New conversation", updated_at: new Date().toISOString() }]);
    }
    await loadThread(id);
  }

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    // React may replay this effect in development. Reuse the same request so a
    // fresh shop gets exactly one first conversation.
    initialLoad.current ??= refreshConversations();
    const initialize = async () => {
      try { await initialLoad.current; if (!cancelled) setHistoryError(""); }
      catch (error) { if (!cancelled) setHistoryError(error instanceof Error ? error.message : "Conversation history is unavailable."); }
      finally { if (!cancelled) setHistoryLoading(false); }
    };
    void initialize();
    return () => { cancelled = true; };
    // The shared workspace is mounted once for the authenticated layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    const sync = () => {
      if (document.visibilityState !== "visible" || busy || !activeThread.current) return;
      void refreshConversations(activeThread.current).catch(() => setHistoryError("Conversation sync failed. Refresh before sending another action."));
    };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("dukaansaathi-assistant") : null;
    channel?.addEventListener("message", sync);
    window.addEventListener("focus", sync);
    return () => { channel?.close(); window.removeEventListener("focus", sync); };
    // Refresh uses the current thread reference and does not need to restart for every message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, busy]);

  async function startConversation() {
    if (busy) return;
    setBusy(true);
    setHistoryError("");
    try {
      const response = await fetch("/api/assistant/conversations", { method: "POST" });
      if (!response.ok) throw new Error("A new conversation could not be created.");
      const id = z.object({ id: z.uuid() }).parse(await response.json()).id;
      await refreshConversations(id);
      setHistoryOpen(false);
    } catch (error) { setHistoryError(error instanceof Error ? error.message : "A new conversation could not be created."); }
    finally { setBusy(false); }
  }

  async function changeConversation(id: string) {
    if (busy || id === conversationId) return;
    try { await loadThread(id); setHistoryOpen(false); setHistoryError(""); }
    catch { setHistoryError("That conversation could not be loaded."); }
  }

  async function renameConversation(id: string) {
    const title = editingTitle.trim();
    if (!title) return;
    const response = await fetch("/api/assistant/conversations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title }) });
    if (!response.ok) { setHistoryError("Conversation could not be renamed."); return; }
    setConversations((current) => current.map((item) => item.id === id ? { ...item, title } : item));
    setEditingId(null);
  }

  async function deleteConversation(id: string) {
    if (busy || !window.confirm("Delete this conversation and its messages? Store records will remain unchanged.")) return;
    const response = await fetch("/api/assistant/conversations", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) { setHistoryError("Conversation could not be deleted."); return; }
    try { await refreshConversations(id === conversationId ? undefined : conversationId ?? undefined); }
    catch { setHistoryError("Conversation list could not be refreshed."); }
  }

  function addMessage(message: Omit<Message, "id">): number {
    const id = nextId.current++;
    setMessages((current) => [...current, { id, ...message }]);
    return id;
  }

  function recentTurns(): RecentTurn[] {
    return messages.slice(-6).map((message) => ({ role: message.role, text: message.text.slice(0, 500) }));
  }

  async function readTurn(response: Response): Promise<AssistantResponse> {
    const raw: unknown = await response.json();
    const parsed = assistantResponseSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const safeError = errorSchema.safeParse(raw);
    throw new Error(response.status === 401 ? "Sign in again to continue." : safeError.success
      ? safeError.data.error : "The result could not be verified. Check store records before retrying.");
  }

  async function showTurn(turn: AssistantResponse) {
    setAction(turn);
    setPending(turn.pending ?? null);
    addMessage({ role: "assistant", text: turn.reply, result: turn, persistedId: turn.messageId, failed: turn.state === "failed" });
    if (turn.state === "confirmed") router.refresh();
    if (turn.speech) {
      const url = `data:${turn.speech.mimeType};base64,${turn.speech.data}`;
      setSpeechUrl(url);
      setVoiceState("speaking");
      const audio = new Audio(url);
      player.current = audio;
      audio.onended = () => setVoiceState(turn.state === "failed" ? "error" : "idle");
      await audio.play().catch(() => setVoiceNotice("Tap the audio player to hear the reply."));
    } else {
      if (turn.speechUnavailable) setVoiceNotice("Spoken reply is unavailable. The store result is shown in text.");
      setVoiceState(turn.state === "failed" ? "error" : "idle");
    }
  }

  async function processPrompt(text: string, speak: boolean, retry = false) {
    if (connected && (!conversationId || historyError)) { setHistoryError("Choose an available conversation before sending a store request."); return; }
    setBusy(true);
    setWorkingOn(speak ? "voice" : "request");
    setLastPrompt(text);
    setRetryable(false);
    setInput("");
    setAction(null);
    setSpeechUrl("");
    setVoiceNotice("");
    player.current?.pause();
    const recent = recentTurns();
    const key = retry && promptRequest.current?.text === text ? promptRequest.current.key : crypto.randomUUID();
    promptRequest.current = { text, key };
    addMessage({ role: "user", text });
    try {
      setVoiceState("reasoning");
      const response = await fetch("/api/assistant/turn", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ text, speak, recent, pending, conversationId: conversationId ?? undefined }),
      });
      const turn = await readTurn(response);
      promptRequest.current = null;
      setVoiceState("executing");
      await showTurn(turn);
      if (connected) {
        setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, updated_at: new Date().toISOString(), title: item.title === "New conversation" ? text.slice(0, 80) : item.title } : item));
        if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("dukaansaathi-assistant"); channel.postMessage({ thread: conversationId }); channel.close(); }
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The request could not be verified. Check store records before retrying.";
      setVoiceState("error");
      setRetryable(/nothing was changed|no list or sale was created/i.test(message));
      addMessage({ role: "assistant", text: message, failed: true });
    } finally {
      setBusy(false);
    }
  }

  async function runPrompt(rawText: string, sampleVoice = false, retry = false) {
    const text = rawText.trim();
    if (!text || busy || voiceState === "listening") return;
    if (sampleVoice) {
      setVoiceState("listening");
      await pause(350);
      setVoiceState("transcribing");
      await pause(350);
    }
    await processPrompt(text, false, retry);
  }

  async function processAttachment() {
    if (!attachment || busy || (connected && !conversationId)) return;
    setBusy(true);
    setWorkingOn("attachment");
    setAction(null);
    setVoiceNotice("");
    setRetryable(false);
    const selected = attachment;
    setAttachment(null);
    addMessage({ role: "user", text: input.trim() || `Check this shopping list: ${selected.file.name}`, attachment: selected.preview });
    setInput("");
    try {
      setVoiceState("reasoning");
      const { prepareShoppingAttachment } = await import("@/lib/assistant/read-attachment");
      const prepared = await prepareShoppingAttachment(selected.file);
      const form = new FormData();
      form.set("extractedText", prepared.extractedText);
      if (conversationId) form.set("conversationId", conversationId);
      prepared.images.forEach((image) => form.append("images", image));
      const response = await fetch("/api/assistant/attachment", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: form });
      await showTurn(await readTurn(response));
      if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("dukaansaathi-assistant"); channel.postMessage({ thread: conversationId }); channel.close(); }
    } catch (reason) {
      setVoiceState("error");
      addMessage({ role: "assistant", text: reason instanceof Error ? reason.message : "The attachment could not be checked. No stock was changed.", failed: true });
    } finally {
      setBusy(false);
    }
  }

  async function confirmSale(draft: ShoppingDraft, paymentMethod: "cash" | "upi" | "card", draftMessageId: number) {
    if (busy || !draft.canConfirm || inactiveDrafts.includes(draftMessageId) || (connected && !conversationId)) return;
    const savedDraftId = messages.find((message) => message.id === draftMessageId)?.persistedId;
    if (!savedDraftId) { setHistoryError("This draft was not saved. Check the list again before recording a sale."); return; }
    setBusy(true);
    setAction(null);
    setWorkingOn("request");
    addMessage({ role: "user", text: `Confirm and record this basket · ${paymentMethod.toUpperCase()}` });
    try {
      const items = draft.items.map((item) => ({ productId: z.uuid().parse(item.productId), quantity: item.quantity }));
      const response = await fetch("/api/assistant/confirm-sale", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": savedDraftId },
        body: JSON.stringify({ confirmed: true, items, paymentMethod, conversationId: conversationId ?? undefined, draftMessageId: savedDraftId }),
      });
      const turn = await readTurn(response);
      if (turn.state === "confirmed") {
        setInactiveDrafts((current) => current.includes(draftMessageId) ? current : [...current, draftMessageId]);
      }
      await showTurn(turn);
      if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("dukaansaathi-assistant"); channel.postMessage({ thread: conversationId }); channel.close(); }
    } catch (reason) {
      setVoiceState("error");
      addMessage({ role: "assistant", text: reason instanceof Error ? reason.message : "Sale confirmation was not verified. Check Sales before trying again.", failed: true });
    } finally {
      setBusy(false);
    }
  }

  function chooseFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000 || file.size === 0 || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
      setVoiceNotice("Choose a JPG, PNG, WebP or PDF file under 5 MB.");
      return;
    }
    if (attachment) URL.revokeObjectURL(attachment.preview.url);
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    setAttachment({ file, preview: { name: file.name, kind: file.type === "application/pdf" ? "pdf" : "image", url } });
    setVoiceNotice("");
  }

  async function stopRecording() {
    const current = recording.current;
    if (!current) return;
    recording.current = null;
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    setVoiceState("transcribing");
    setBusy(true);
    try {
      const bytes = await current.stop();
      const form = new FormData();
      form.set("audio", new File([new Uint8Array(bytes)], "request.wav", { type: "audio/wav" }));
      form.set("language", voiceLanguage);
      const response = await fetch("/api/voice/transcribe", { method: "POST", body: form });
      const raw: unknown = await response.json();
      const parsed = transcriptSchema.safeParse(raw);
      if (!response.ok) {
        const safeError = errorSchema.safeParse(raw);
        const retryAfter = response.headers.get("Retry-After");
        const wait = response.status === 429 && retryAfter ? ` Wait ${retryAfter} second(s) before trying again.` : "";
        throw new Error(`${safeError.success ? safeError.data.error : "Transcription failed. No store action was taken."}${wait}`);
      }
      if (!parsed.success) throw new Error("Transcription failed. No store action was taken; please try again.");
      await processPrompt(parsed.data.text, true);
    } catch (reason) {
      setVoiceState("error");
      setVoiceNotice(reason instanceof Error ? reason.message : "The recording could not be processed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVoice() {
    if (providerMode === "mock") { await runPrompt(examples[0], true); return; }
    if (recording.current) { await stopRecording(); return; }
    if (busy || !voiceAvailable) return;
    setVoiceNotice("");
    try {
      recording.current = await startVoiceRecording();
      setVoiceState("listening");
      recordingTimer.current = setTimeout(() => void stopRecording(), 12_000);
    } catch {
      setVoiceState("error");
      setVoiceNotice("Microphone access was unavailable. Check browser permission and try again.");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attachment) void processAttachment();
    else void runPrompt(input);
  }

  const realVoice = providerMode === "gnani";
  const realReasoning = reasonerMode !== "mock";
  return <div className="assistant-page assistant-copilot">
    <header className="assistant-heading"><div><h1>Ask Vaani<span>.</span></h1><p>Run your store in your own words. Speak, type, or check a shopping list.</p></div><span className="assistant-mode-badge"><span /> {connected ? "STORE CONNECTED" : "PREVIEW MODE"} · {realReasoning ? reasonerMode === "gemini" ? "GEMINI + OPENROUTER FALLBACK" : "OPENROUTER + LOCAL PARSER" : "MOCK REASONING"} · {realVoice ? "GNANI VOICE" : "SAMPLE VOICE"}</span>{!expanded && <button className="assistant-drawer-close" type="button" onClick={onClose} aria-label="Close Vaani assistant"><X size={19} /></button>}</header>
    <div className="assistant-conversation-toolbar"><button type="button" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen} aria-controls="assistant-thread-history"><History size={17} /> History <span>{conversations.length}</span></button><button type="button" onClick={() => void startConversation()} disabled={busy || !connected}><Plus size={17} /> New chat</button><span>{conversationId ? conversations.find((item) => item.id === conversationId)?.title ?? "Conversation" : historyLoading ? "Loading history…" : "History unavailable"}</span></div>
    {historyError && <p className="assistant-history-error" role="alert">{historyError}</p>}
    {historyOpen && <div className="assistant-thread-history" id="assistant-thread-history" aria-label="Conversation history">
      {conversations.map((thread) => <div className="assistant-thread-row" key={thread.id} data-active={thread.id === conversationId}>
        {editingId === thread.id ? <form onSubmit={(event) => { event.preventDefault(); void renameConversation(thread.id); }}><input aria-label="Conversation title" value={editingTitle} maxLength={80} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditingId(null); }} autoFocus /><button type="submit">Save</button></form>
          : <button type="button" className="assistant-thread-select" onClick={() => void changeConversation(thread.id)} disabled={busy} aria-current={thread.id === conversationId ? "true" : undefined}>{thread.title}</button>}
        <button type="button" aria-label={`Rename ${thread.title}`} onClick={() => { setEditingId(thread.id); setEditingTitle(thread.title); }}><Pencil size={15} /></button>
        <button type="button" aria-label={`Delete ${thread.title}`} onClick={() => void deleteConversation(thread.id)}><Trash2 size={15} /></button>
      </div>)}
    </div>}
    <div className="assistant-grid">
      <section className="conversation-panel" aria-label="Assistant conversation">
        <div className="conversation-head"><div><span className="conversation-head-mark"><AudioLines size={20} strokeWidth={1.5} aria-hidden="true" /></span><div><strong>Store conversation</strong><span>{connected ? "Answers from your shop records" : "Connect a shop to act"}</span></div></div><span>{connected ? "SAVED TO YOUR SHOP" : "PREVIEW SESSION"}</span></div>
        <div className="conversation-feed" aria-live="polite">
          {messages.length === 0 && <div className="assistant-welcome"><div className="assistant-welcome-mark"><AudioLines size={27} strokeWidth={1.4} aria-hidden="true" /></div><h2>What needs doing<br /><em>in your shop?</em></h2><p>{connected ? "Ask a question, update stock, or turn a list into a checked draft. Store changes appear only after they are saved." : "Connect your shop to check real stock, khata, sales and orders."}</p><button className="assistant-speak-primary" type="button" onClick={() => void toggleVoice()} disabled={busy || (realVoice && !voiceAvailable)}><Mic size={19} aria-hidden="true" /> {realVoice ? "Speak to Vaani" : "Try a sample voice request"}</button></div>}
          {messages.map((message, index) => <article ref={index === messages.length - 1 ? latestMessage : undefined} key={message.id} className={`conversation-entry ${message.role}`} data-state={message.failed ? "failed" : message.result?.state}><span className="conversation-speaker">{message.role === "user" ? "YOU" : "VAANI"}</span><div className="conversation-body">{(message.result || message.failed) && <span className="conversation-outcome">{message.failed ? "Needs attention" : message.result?.state === "confirmed" ? "Store confirmed" : message.result?.state === "draft" ? "For review" : message.result?.state === "unsupported" ? "Try another request" : "Awaiting detail"}</span>}<p>{message.text}</p>
            {message.result && !message.result.shoppingList && message.result.state !== "unsupported" && <div className={`conversation-result ${message.result.state}`}><span>{message.result.state === "confirmed" ? "VERIFIED STORE RESULT" : message.result.state === "draft" ? "DRAFT FOR REVIEW" : message.result.state === "clarify" ? "WAITING FOR YOU" : "STORE RESULT"}</span><strong>{message.result.title}</strong><small>{message.result.detail}</small></div>}
            {message.attachment && <div className="conversation-attachment">{message.attachment.kind === "image" ? <Image unoptimized src={message.attachment.url} alt={`Preview of ${message.attachment.name}`} width={64} height={64} /> : <FileText size={26} aria-hidden="true" />}<span>{message.attachment.name}</span></div>}
            {message.result?.shoppingList && <ShoppingListResult draft={message.result.shoppingList} busy={busy} inactive={inactiveDrafts.includes(message.id)} onConfirm={(draft, payment) => void confirmSale(draft, payment, message.id)} />}
            {message.result?.state === "clarify" && <span className="clarification-hint">Waiting for your reply · nothing has changed yet</span>}
          </div></article>)}
          {messages.length === 0 && <div className="assistant-starters"><span>OR START WITH A REQUEST</span><div>{examples.map((example) => <button key={example} type="button" onClick={() => void runPrompt(example)} disabled={busy}>{example}<ArrowUp size={14} aria-hidden="true" /></button>)}</div></div>}
          {busy && <div className="conversation-processing" role="status"><span className="processing-dot" /> {voiceState === "transcribing" ? "Transcribing with Prisma" : workingOn === "attachment" ? "Reading your list; nothing has been changed" : "Checking request and store"}</div>}
        </div>
        <div className="conversation-bottom">
          {pending && <div className="pending-clarification" role="status"><ShieldCheck size={17} aria-hidden="true" /><span>{pendingLabel()} Nothing has changed yet.</span><button type="button" onClick={() => void runPrompt("cancel")} disabled={busy} aria-label="Cancel the pending store request"><X size={16} aria-hidden="true" /></button></div>}
          {attachment && <div className="composer-attachment">{attachment.preview.kind === "image" ? <Image unoptimized src={attachment.preview.url} alt={`Preview of ${attachment.preview.name}`} width={48} height={48} /> : <FileText size={24} aria-hidden="true" />}<span><strong>{attachment.preview.name}</strong><small>Draft check only · no stock change</small></span><button type="button" onClick={() => { URL.revokeObjectURL(attachment.preview.url); setAttachment(null); }} aria-label="Remove attachment"><X size={17} aria-hidden="true" /></button></div>}
          {retryable && lastPrompt && <button className="assistant-retry" type="button" onClick={() => void runPrompt(lastPrompt, false, true)} disabled={busy}><RotateCcw size={15} aria-hidden="true" /> Retry safe request</button>}
          <form className="assistant-composer" onSubmit={submit}><label htmlFor="assistant-input" className="sr-only">Ask Vaani</label><input id="assistant-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={pendingPlaceholder()} maxLength={500} disabled={busy || voiceState === "listening"} />
            <div className="assistant-attachment-control" ref={attachmentMenu}>
              <button ref={attachmentTrigger} type="button" className="assistant-attach" onClick={() => setAttachmentMenuOpen((value) => !value)} disabled={busy || voiceState === "listening"} aria-label="Add attachment" aria-expanded={attachmentMenuOpen} aria-controls="assistant-attachment-menu"><Paperclip size={20} aria-hidden="true" /></button>
              {attachmentMenuOpen && <div id="assistant-attachment-menu" className="assistant-attachment-menu">
                <strong>Add a shopping list</strong>
                <button type="button" onClick={() => { setAttachmentMenuOpen(false); fileInput.current?.click(); }}><ImagePlus size={18} aria-hidden="true" /> Upload photo</button>
                <button type="button" onClick={() => { setAttachmentMenuOpen(false); pdfInput.current?.click(); }}><FileText size={18} aria-hidden="true" /> Upload PDF/document</button>
                <button type="button" onClick={() => { setAttachmentMenuOpen(false); cameraInput.current?.click(); }}><Camera size={18} aria-hidden="true" /> Take photo</button>
                <details className="attachment-privacy"><summary><Info size={16} aria-hidden="true" /> Attachments &amp; privacy</summary><p>JPG, PNG, WebP or PDF, up to 5 MB. Files are not saved by Vaanlekha. Images go to the vision provider. Lists remain drafts until you confirm a sale.</p></details>
              </div>}
            </div>
            <label className="assistant-language-control"><span className="sr-only">Voice language</span><select aria-label="Voice language" value={voiceLanguage} onChange={(event) => setVoiceLanguage(event.target.value as typeof voiceLanguage)} disabled={busy || voiceState === "listening"}><option value="hi-IN">हिंदी</option><option value="en-IN">EN</option></select></label>
            <button className="assistant-mic" type="button" disabled={busy || (realVoice && !voiceAvailable)} aria-label={realVoice ? voiceState === "listening" ? "Stop recording" : "Start recording" : "Play sample voice flow"} onClick={() => void toggleVoice()}>{realVoice && voiceState === "listening" ? <Square size={17} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}<span>{realVoice ? voiceState === "listening" ? "Stop" : "Speak" : "Sample"}</span></button>
            <button className="assistant-send" type="submit" disabled={busy || historyLoading || Boolean(historyError) || (connected && !conversationId) || voiceState === "listening" || (!input.trim() && !attachment)} aria-label="Send message"><ArrowUp size={19} aria-hidden="true" /></button></form>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
          <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
          <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" tabIndex={-1} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
          {voiceNotice && <p className="composer-voice-notice" role="status">{voiceNotice}</p>}
          {speechUrl && <audio controls src={speechUrl} aria-label="Spoken assistant reply" className="assistant-audio" />}
        </div>
      </section>
      {(action || voiceState !== "idle") && <aside className="assistant-context" aria-label="Action context"><div className="assistant-context-top"><span>TRUSTED ACTION</span><ShieldCheck size={19} strokeWidth={1.5} aria-hidden="true" /></div><VoiceStateIndicator state={voiceState} realVoice={realVoice} realReasoning={realReasoning} connected={connected} reasonerMode={reasonerMode} />
        <div className="action-surface"><p className="action-eyebrow">LATEST RESULT</p>{action ? <><h2>{action.title}</h2><span className="action-intent">{action.intent}</span><p className="action-detail">{action.detail}</p><div className="action-warning"><ShieldCheck size={17} aria-hidden="true" /><span>{action.state === "confirmed" ? "Confirmed by your store database." : action.state === "draft" ? "Draft only. Review and confirm to record a sale." : action.state === "clarify" ? "Waiting for your answer. No change saved." : "No successful change was confirmed."}</span></div></> : <><h2>Your next action starts here.</h2><p>Vaani will show the intent, store result and any decision that needs your confirmation.</p></>}</div>
        <p className="assistant-context-note">{realReasoning ? "AI" : "Mock AI"} interprets your request. Your shop records decide the answer. Vaani confirms a change only when it is saved.</p>
      </aside>}
    </div>
  </div>;
}
