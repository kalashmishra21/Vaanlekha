"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, AudioLines, Camera, FileText, ImagePlus, Info, Mic, Paperclip, RotateCcw, ShieldCheck, Square, X, Plus, History, Pencil, Trash2 } from "lucide-react";
import { z } from "zod";
import { assistantResponseSchema, type AssistantResponse } from "@/lib/business/assistant-response";
import { pendingClarificationSchema, type recentTurnSchema } from "@/lib/ai/types/tool-call";
import type { ShoppingDraft } from "@/lib/assistant/shopping-list";
import { isImageUploadWithinLimit, MAX_ATTACHMENT_SOURCE_BYTES, MAX_IMAGE_UPLOAD_BYTES } from "@/lib/assistant/attachment-limits";
import { microphoneErrorMessage, startVoiceRecording, type VoiceRecording } from "@/lib/ai/capture";
import { browserSpeechFactory, browserSpeechErrorMessage, startBrowserSpeechRecognition, type BrowserSpeechSession } from "@/lib/ai/browser-speech";
import { VoiceSubmissionGate, type VoiceState } from "@/features/assistant/voice-states";
import { VoiceStateIndicator } from "./voice-state-indicator";
import { ShoppingListResult } from "./shopping-list-result";
import { PendingProductPriceCard } from "./pending-product-price-card";
import { useLocale } from "@/components/layout/locale-provider";

type AttachmentPreview = { name: string; kind: "image" | "pdf"; url: string };
type Message = { id: number; persistedId?: string; role: "user" | "assistant"; text: string; attachment?: AttachmentPreview; result?: AssistantResponse; failed?: boolean };
type ProviderMode = "mock" | "gnani";
type ReasonerMode = "mock" | "gemini";
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
  const { locale, t } = useLocale();
  const recording = useRef<{ sessionId: number; source: VoiceRecording } | null>(null);
  const browserRecording = useRef<{ sessionId: number; source: BrowserSpeechSession } | null>(null);
  const permissionAbort = useRef<AbortController | null>(null);
  const transcriptionAbort = useRef<AbortController | null>(null);
  const voiceSessionCounter = useRef(0);
  const activeVoiceSessionId = useRef<number | null>(null);
  const voiceSubmissionGate = useRef(new VoiceSubmissionGate());
  const voiceStarting = useRef(false);
  const voiceTranscribing = useRef(false);
  const promptInFlight = useRef(false);
  const forceBrowserFallback = useRef(false);
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
  const [voiceLanguage, setVoiceLanguage] = useState<"hi-IN" | "en-IN">(locale === "hi" ? "hi-IN" : "en-IN");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [browserSpeechAvailable, setBrowserSpeechAvailable] = useState(false);
  const [offerBrowserFallback, setOfferBrowserFallback] = useState(false);
  const [speechUrl, setSpeechUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [workingOn, setWorkingOn] = useState<"request" | "attachment" | "voice">("request");
  const [lastPrompt, setLastPrompt] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [action, setAction] = useState<AssistantResponse | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setBrowserSpeechAvailable(Boolean(browserSpeechFactory())));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const syncVoiceLanguage = (event: Event) => {
      const nextLocale = (event as CustomEvent<string>).detail;
      setVoiceLanguage(nextLocale === "hi" ? "hi-IN" : "en-IN");
    };
    window.addEventListener("vaanlekha-language-changed", syncVoiceLanguage);
    return () => window.removeEventListener("vaanlekha-language-changed", syncVoiceLanguage);
  }, []);

  function pendingLabel() {
    if (!pending) return "";
    if (locale === "hi") {
      switch (pending.kind) {
        case "open-account-amount": return `${pending.customer} के खाते में शुरुआती रकम लिखें।`;
        case "product-create-price": return `${pending.product} के ${pending.openingStock} ${pending.unit} की बेचने की कीमत रुपये में लिखें।`;
        case "product-create-confirm": return `${pending.product} के ${pending.openingStock} ${pending.unit}, हर एक ₹${pending.sellingPrice} पर जोड़ें? अभी कुछ सेव नहीं हुआ। हाँ या रद्द लिखें।`;
        case "product-create-unit": return `${pending.product} के ${pending.openingStock} जोड़ने के लिए इकाई लिखें।`;
        case "product-action-choice": return `क्या ${pending.product} नया सामान है या पहले से मौजूद?`;
        case "product-existing-confirm": return `${pending.product} के मौजूदा स्टॉक में ${pending.delta} जोड़ने की पुष्टि करें।`;
        case "khata-create-confirm": return `${pending.customer} के उधार खाते में ₹${pending.amountRupees} शुरुआती रकम जोड़ें?`;
        case "khata-currency-confirm": return `${pending.customer} के ₹${pending.amountRupees} की पुष्टि करें। हिसाब रुपये में दर्ज होगा।`;
        case "customer-name": return "ग्राहक का नाम लिखें।";
        case "supplier-name": return "सप्लायर का नाम लिखें।";
        case "order-supplier": return "इस ऑर्डर के लिए सेव किया हुआ सप्लायर चुनें।";
        case "order-transition-confirm": return `${pending.orderLabel} का ऑर्डर ${pending.action} करें? अभी स्थिति ${pending.currentStatus} है।`;
        case "order-transition-select": return "ऑर्डर को ID या सप्लायर के नाम से चुनें।";
        case "order-status-select": return "स्थिति जानने के लिए ऑर्डर चुनें।";
        case "customer-select": return `${pending.query} के सही ग्राहक का कोड चुनें।`;
        case "repayment-amount": return `${pending.customer} का बकाया ₹${pending.outstanding} है। इसी सीमा तक भुगतान राशि लिखें।`;
      }
    }
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
      case "order-transition-select": return "Choose the exact purchase order number.";
      case "order-status-select": return "Choose the exact order whose status you want.";
      case "customer-select": return `Choose which ${pending.query} this entry belongs to.`;
      case "repayment-amount": return `${pending.customer} owes ₹${pending.outstanding}; enter a repayment up to that amount.`;
    }
  }

  function pendingPlaceholder() {
    if (!pending) return t("Ask about stock, khata or a shopping list…");
    if (locale === "hi") {
      switch (pending.kind) {
        case "open-account-amount": return "जैसे: १०० रुपये";
        case "product-create-price": return `${pending.unit} की कीमत रुपये में`;
        case "product-create-confirm": return "जोड़ने के लिए हाँ लिखें, या रद्द करें";
        case "product-create-unit": return "इकाई लिखें, जैसे पैकेट";
        case "product-action-choice": return "नया या पहले से मौजूद लिखें";
        case "product-existing-confirm": case "khata-create-confirm": case "order-transition-confirm": return "हाँ लिखें या रद्द करें";
        case "khata-currency-confirm": return "रुपये की पुष्टि करें या रद्द करें";
        case "customer-name": return "ग्राहक का नाम";
        case "supplier-name": return "सप्लायर का नाम";
        case "order-supplier": return "सेव सप्लायर का नाम";
        case "order-transition-select": return "ऑर्डर का नंबर या सप्लायर का नाम";
        case "order-status-select": return "ऑर्डर नंबर चुनें";
        case "customer-select": return "ग्राहक कार्ड से चुनें";
        case "repayment-amount": return "रुपये में भुगतान राशि";
      }
    }
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
      case "order-status-select": return "Choose an order number";
      case "customer-select": return "Choose a customer card";
      case "repayment-amount": return "Repayment amount in rupees";
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
    permissionAbort.current?.abort();
    transcriptionAbort.current?.abort();
    void recording.current?.source.cancel();
    browserRecording.current?.source.cancel();
    player.current?.pause();
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function loadThread(id: string) {
    const response = await fetch(`/api/assistant/conversations?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(t("This conversation could not be loaded."));
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
    if (!response.ok) throw new Error(t("Conversation history is unavailable. Store actions are paused."));
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
      if (!created.ok) throw new Error(t("Conversation could not be created. Store actions are paused."));
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
    throw new Error(t(response.status === 401 ? "Sign in again to continue." : safeError.success
      ? safeError.data.error : "The result could not be verified. Check store records before retrying."));
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
      audio.onended = () => setVoiceState(turn.state === "failed" ? "error" : "completed");
      await audio.play().catch(() => setVoiceNotice("Tap the audio player to hear the reply."));
    } else {
      if (turn.speechUnavailable) setVoiceNotice("Spoken reply is unavailable. The store result is shown in text.");
      setVoiceState(turn.state === "failed" ? "error" : "completed");
    }
  }

  async function processPrompt(text: string, speak: boolean, retry = false, fromVoice = false) {
    if (promptInFlight.current || (!fromVoice && (voiceStarting.current || voiceTranscribing.current || recording.current || browserRecording.current))) return;
    if (connected && (!conversationId || historyError)) { setHistoryError("Choose an available conversation before sending a store request."); return; }
    promptInFlight.current = true;
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
      promptInFlight.current = false;
      setBusy(false);
    }
  }

  async function runPrompt(rawText: string, sampleVoice = false, retry = false) {
    const text = rawText.trim();
    if (!text || busy || promptInFlight.current || voiceStarting.current || voiceTranscribing.current || recording.current || browserRecording.current) return;
    if (sampleVoice) {
      setVoiceState("processing_audio");
      await pause(350);
      setVoiceState("transcribing");
      await pause(350);
    }
    await processPrompt(text, false, retry);
  }

  async function submitPendingProductPrice(price: number) {
    if (!Number.isFinite(price) || price <= 0 || price > 999999999 || busy || promptInFlight.current) return;
    // Submit through the same server-owned pending action as a typed reply.
    // The server validates the saved context and idempotency key before creating stock.
    await processPrompt(`₹${price}`, false);
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
    const question = input.trim();
    addMessage({ role: "user", text: question || "Check this shopping list", attachment: selected.preview });
    setInput("");
    let pdfTicket: string | null = null;
    let uploadedPdfName: string | null = null;
    try {
      setVoiceState("reasoning");
      const { prepareShoppingAttachment } = await import("@/lib/assistant/read-attachment");
      const prepared = await prepareShoppingAttachment(selected.file);
      const fallbackImages = isImageUploadWithinLimit(prepared.images) ? prepared.images : [];
      if (!prepared.pdf && !fallbackImages.length) throw new Error("Choose a supported image under 4 MB.");
      const form = new FormData();
      form.set("question", question);
      if (conversationId) form.set("conversationId", conversationId);
      fallbackImages.forEach((image) => form.append("images", image));
      if (prepared.pdf) {
        if (!conversationId) throw new Error("Open a saved conversation before checking a PDF.");
        const start = await fetch("/api/assistant/attachment-upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ size: prepared.pdf.size, conversationId }),
        });
        const startBody: unknown = await start.json().catch(() => null);
        if (!start.ok) throw new Error(errorSchema.safeParse(startBody).success ? errorSchema.parse(startBody).error : "PDF upload could not be started.");
        const session = z.object({ ticket: z.string().min(1), chunkSize: z.literal(1_048_576) }).parse(startBody);
        pdfTicket = session.ticket;
        for (let offset = 0; offset < prepared.pdf.size; offset += session.chunkSize) {
          const end = Math.min(prepared.pdf.size, offset + session.chunkSize);
          const chunkResponse = await fetch("/api/assistant/attachment-upload/chunk", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.ticket}`, "X-Upload-Offset": String(offset), "Content-Type": "application/octet-stream" },
            body: prepared.pdf.slice(offset, end),
          });
          const chunkBody: unknown = await chunkResponse.json().catch(() => null);
          if (!chunkResponse.ok) throw new Error(errorSchema.safeParse(chunkBody).success ? errorSchema.parse(chunkBody).error : "PDF upload failed. Start again.");
          const received = z.object({ nextOffset: z.number().int().positive(), fileName: z.string().regex(/^files\/[A-Za-z0-9_-]+$/).optional() }).parse(chunkBody);
          if (received.nextOffset !== end) throw new Error("PDF upload did not finish in order. Start again.");
          if (end === prepared.pdf.size) {
            if (!received.fileName) throw new Error("Gemini did not finish the PDF upload. Start again.");
            uploadedPdfName = received.fileName;
          }
        }
        form.set("pdfTicket", session.ticket);
        form.set("pdfFileName", uploadedPdfName ?? "");
      }
      const response = await fetch("/api/assistant/attachment", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: form });
      await showTurn(await readTurn(response));
      if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("dukaansaathi-assistant"); channel.postMessage({ thread: conversationId }); channel.close(); }
    } catch (reason) {
      if (pdfTicket && uploadedPdfName) {
        await fetch("/api/assistant/attachment-upload", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket: pdfTicket, fileName: uploadedPdfName }),
        }).catch(() => undefined);
      }
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
      const items = draft.items.map((item) => {
        if (item.quantity === undefined || item.quantity === null || !item.productId) throw new Error("A list quantity or inventory match is unclear. Check the list again before recording a sale.");
        return { productId: z.uuid().parse(item.productId), quantity: item.quantity };
      });
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
    const isPdf = file.type === "application/pdf" || (!file.type && /\.pdf$/iu.test(file.name));
    const fileLimit = isPdf ? MAX_ATTACHMENT_SOURCE_BYTES : MAX_IMAGE_UPLOAD_BYTES;
    const imageExtension = /\.(?:jpe?g|png|webp|heic|heif)$/iu.test(file.name);
    const supportedType = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"].includes(file.type)
      || (!file.type && (imageExtension || isPdf));
    if (file.size > fileLimit || file.size === 0 || !supportedType) {
      setVoiceNotice(t("Choose an image under 4 MB or a PDF under 5 MB."));
      return;
    }
    if (attachment) URL.revokeObjectURL(attachment.preview.url);
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    setAttachment({ file, preview: { name: file.name, kind: isPdf ? "pdf" : "image", url } });
    setVoiceNotice("");
  }

  function clearRecordingTimer() {
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
  }

  async function stopRecording(expectedSessionId?: number) {
    const current = recording.current;
    if (!current || (expectedSessionId !== undefined && current.sessionId !== expectedSessionId)
      || !voiceSubmissionGate.current.claim(current.sessionId)) return;
    recording.current = null;
    clearRecordingTimer();
    voiceTranscribing.current = true;
    setVoiceState("processing_audio");
    setBusy(true);
    const controller = new AbortController();
    transcriptionAbort.current = controller;
    try {
      const bytes = await current.source.stop();
      if (controller.signal.aborted) throw new DOMException("Transcription was cancelled.", "AbortError");
      const form = new FormData();
      form.set("audio", new File([new Uint8Array(bytes)], "request.wav", { type: "audio/wav" }));
      form.set("language", voiceLanguage);
      setVoiceState("transcribing");
      const response = await fetch("/api/voice/transcribe", { method: "POST", body: form, signal: controller.signal });
      const raw: unknown = await response.json();
      const parsed = transcriptSchema.safeParse(raw);
      if (!response.ok) {
        const safeError = errorSchema.safeParse(raw);
        const retryAfter = response.headers.get("Retry-After");
        const wait = response.status === 429 && retryAfter ? ` Wait ${retryAfter} second(s) before trying again.` : "";
        throw new Error(`${safeError.success ? safeError.data.error : "Transcription failed. No store action was taken."}${wait}`);
      }
      if (!parsed.success) throw new Error("Transcription failed. No store action was taken; please try again.");
      setVoiceNotice("");
      transcriptionAbort.current = null;
      await processPrompt(parsed.data.text, true, false, true);
    } catch (reason) {
      const cancelled = controller.signal.aborted || reason instanceof Error && reason.name === "AbortError";
      if (activeVoiceSessionId.current === current.sessionId) {
        setVoiceState(cancelled ? "cancelled" : "error");
        setVoiceNotice(cancelled ? "The recording was cancelled. No store action was sent."
          : reason instanceof Error ? reason.message : "The recording could not be processed.");
        if (!cancelled && browserSpeechAvailable) setOfferBrowserFallback(true);
      }
    } finally {
      transcriptionAbort.current = null;
      if (activeVoiceSessionId.current === current.sessionId) {
        voiceTranscribing.current = false;
        setBusy(false);
      }
    }
  }

  function startBrowserFallback() {
    const factory = browserSpeechFactory();
    if (!factory) {
      setVoiceState("unsupported");
      setVoiceNotice(browserSpeechErrorMessage("unsupported"));
      return;
    }
    setVoiceState("requesting_permission");
    setVoiceNotice("Using browser speech recognition. Your browser may process this audio.");
    setOfferBrowserFallback(false);
    const sessionId = ++voiceSessionCounter.current;
    activeVoiceSessionId.current = sessionId;
    let source: BrowserSpeechSession;
    try { source = startBrowserSpeechRecognition(factory, voiceLanguage, (transcript) => {
      if (activeVoiceSessionId.current !== sessionId) return;
      if (!voiceSubmissionGate.current.claim(sessionId)) return;
      browserRecording.current = null;
      clearRecordingTimer();
      voiceTranscribing.current = true;
      setVoiceNotice("Recognized transcript received. Vaani is checking it before any store action.");
      void processPrompt(transcript, true, false, true).finally(() => {
        if (activeVoiceSessionId.current === sessionId) {
          voiceTranscribing.current = false;
          setBusy(false);
        }
      });
    }, (message) => {
      if (activeVoiceSessionId.current !== sessionId) return;
      if (!voiceSubmissionGate.current.claim(sessionId)) return;
      browserRecording.current = null;
      clearRecordingTimer();
      setVoiceState(message.includes("cancelled") ? "cancelled" : "error");
      setVoiceNotice(message);
    }, () => {
      if (activeVoiceSessionId.current === sessionId) setVoiceState("recording");
    }); } catch {
      activeVoiceSessionId.current = null;
      setVoiceState("error");
      setVoiceNotice(browserSpeechErrorMessage("unknown"));
      return;
    }
    browserRecording.current = { sessionId, source };
    recordingTimer.current = setTimeout(() => {
      if (browserRecording.current?.sessionId !== sessionId) return;
      voiceTranscribing.current = true;
      setVoiceState("transcribing");
      source.stop();
    }, 15_000);
  }

  function stopBrowserRecording(expectedSessionId?: number) {
    const current = browserRecording.current;
    if (!current || (expectedSessionId !== undefined && current.sessionId !== expectedSessionId)) return;
    voiceTranscribing.current = true;
    setVoiceState("transcribing");
    clearRecordingTimer();
    current.source.stop();
  }

  function cancelVoice() {
    clearRecordingTimer();
    if (permissionAbort.current) {
      permissionAbort.current.abort();
      permissionAbort.current = null;
    }
    if (recording.current) {
      const current = recording.current;
      recording.current = null;
      void current.source.cancel();
    }
    if (browserRecording.current) {
      browserRecording.current.source.cancel();
      browserRecording.current = null;
    }
    transcriptionAbort.current?.abort();
    activeVoiceSessionId.current = null;
    voiceStarting.current = false;
    voiceTranscribing.current = false;
    setBusy(false);
    setVoiceState("cancelled");
    setVoiceNotice("The recording was cancelled. No store action was sent.");
  }

  async function toggleVoice(useBrowser = false) {
    if (providerMode === "mock") { await runPrompt(examples[0], true); return; }
    if (voiceState === "requesting_permission") { cancelVoice(); return; }
    if (recording.current) { await stopRecording(recording.current.sessionId); return; }
    if (browserRecording.current) { stopBrowserRecording(browserRecording.current.sessionId); return; }
    if (busy || promptInFlight.current || voiceStarting.current || voiceTranscribing.current) return;
    setVoiceNotice("");
    if (useBrowser || forceBrowserFallback.current || !voiceAvailable) {
      forceBrowserFallback.current = false;
      if (!browserSpeechAvailable) {
        setVoiceState("unsupported");
        setVoiceNotice(browserSpeechErrorMessage("unsupported"));
        return;
      }
      setVoiceState("requesting_permission");
      startBrowserFallback();
      return;
    }

    voiceStarting.current = true;
    const controller = new AbortController();
    permissionAbort.current = controller;
    setVoiceState("requesting_permission");
    setVoiceNotice("Allow microphone access. Recording will not start until permission is granted.");
    try {
      const source = await startVoiceRecording(controller.signal);
      if (controller.signal.aborted) { await source.cancel(); return; }
      const sessionId = ++voiceSessionCounter.current;
      activeVoiceSessionId.current = sessionId;
      recording.current = { sessionId, source };
      setVoiceState("recording");
      setVoiceNotice("Recording. Tap Stop to process this request or Cancel to discard it.");
      recordingTimer.current = setTimeout(() => void stopRecording(sessionId), 12_000);
    } catch (reason) {
      const cancelled = controller.signal.aborted || reason instanceof Error && reason.name === "AbortError";
      if (activeVoiceSessionId.current === null || !cancelled) {
        setVoiceState(cancelled ? "cancelled" : "error");
        setVoiceNotice(cancelled ? "Microphone setup was cancelled. No recording was sent." : microphoneErrorMessage(reason));
        if (!cancelled && browserSpeechAvailable) setOfferBrowserFallback(true);
      }
    } finally {
      voiceStarting.current = false;
      if (permissionAbort.current === controller) permissionAbort.current = null;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attachment) void processAttachment();
    else void runPrompt(input);
  }

  const realVoice = providerMode === "gnani";
  const realReasoning = reasonerMode !== "mock";
  const voiceCaptureActive = voiceState === "requesting_permission" || voiceState === "recording";
  const voiceProcessingActive = voiceState === "processing_audio" || voiceState === "transcribing";
  const voiceInputLocked = voiceCaptureActive || voiceProcessingActive;
  const canUseVoice = providerMode === "mock" || voiceAvailable || browserSpeechAvailable;
  return <div className="assistant-page assistant-copilot">
    <header className="assistant-heading"><div><h1>{t("Ask Vaani")}<span>.</span></h1><p>{t("Run your store in your own words. Speak, type, or check a shopping list.")}</p></div><span className="assistant-mode-badge"><span /> {t(connected ? "STORE CONNECTED" : "PREVIEW MODE")} · {t(realReasoning ? reasonerMode === "gemini" ? "GEMINI + OPENROUTER FALLBACK" : "OPENROUTER + LOCAL PARSER" : "MOCK REASONING")} · {t(realVoice ? "GNANI VOICE" : "SAMPLE VOICE")}</span>{!expanded && <button className="assistant-drawer-close" type="button" onClick={onClose} aria-label={t("Close Vaani assistant")}><X size={19} /></button>}</header>
    <div className="assistant-conversation-toolbar"><button type="button" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen} aria-controls="assistant-thread-history"><History size={17} /> {t("History")} <span>{conversations.length}</span></button><button type="button" onClick={() => void startConversation()} disabled={busy || !connected}><Plus size={17} /> {t("New chat")}</button><span>{conversationId ? conversations.find((item) => item.id === conversationId)?.title ?? t("Conversation") : historyLoading ? t("Loading history…") : t("History unavailable")}</span></div>
    {historyError && <p className="assistant-history-error" role="alert">{t(historyError)}</p>}
    {historyOpen && <div className="assistant-thread-history" id="assistant-thread-history" aria-label={t("Conversation history")}>
      {conversations.map((thread) => <div className="assistant-thread-row" key={thread.id} data-active={thread.id === conversationId}>
        {editingId === thread.id ? <form onSubmit={(event) => { event.preventDefault(); void renameConversation(thread.id); }}><input aria-label={t("Conversation title")} value={editingTitle} maxLength={80} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setEditingId(null); }} autoFocus /><button type="submit">{t("Save")}</button></form>
          : <button type="button" className="assistant-thread-select" onClick={() => void changeConversation(thread.id)} disabled={busy} aria-current={thread.id === conversationId ? "true" : undefined}>{thread.title}</button>}
        <button type="button" aria-label={`${t("Rename")} ${thread.title}`} onClick={() => { setEditingId(thread.id); setEditingTitle(thread.title); }}><Pencil size={15} /></button>
        <button type="button" aria-label={`${t("Delete")} ${thread.title}`} onClick={() => void deleteConversation(thread.id)}><Trash2 size={15} /></button>
      </div>)}
    </div>}
    <div className="assistant-grid">
      <section className="conversation-panel" aria-label={t("Assistant conversation")}>
        <div className="conversation-head"><div><span className="conversation-head-mark"><AudioLines size={20} strokeWidth={1.5} aria-hidden="true" /></span><div><strong>{t("Store conversation")}</strong><span>{t(connected ? "Answers from your shop records" : "Connect a shop to act")}</span></div></div><span>{t(connected ? "SAVED TO YOUR SHOP" : "PREVIEW SESSION")}</span></div>
        <div className="conversation-feed" aria-live="polite">
          {messages.length === 0 && <div className="assistant-welcome"><div className="assistant-welcome-mark"><AudioLines size={27} strokeWidth={1.4} aria-hidden="true" /></div><h2>{t("What needs doing")}<br /><em>{t("in your shop?")}</em></h2><p>{t(connected ? "Ask a question, update stock, or turn a list into a checked draft. Store changes appear only after they are saved." : "Connect your shop to check real stock, khata, sales and orders.")}</p><button className="assistant-speak-primary" type="button" onClick={() => void toggleVoice()} disabled={busy || (realVoice && !voiceAvailable)}><Mic size={19} aria-hidden="true" /> {t(realVoice ? "Speak to Vaani" : "Try a sample voice request")}</button></div>}
          {messages.map((message, index) => <article ref={index === messages.length - 1 ? latestMessage : undefined} key={message.id} className={`conversation-entry ${message.role}`} data-state={message.failed ? "failed" : message.result?.state}><span className="conversation-speaker">{t(message.role === "user" ? "YOU" : "VAANI")}</span><div className="conversation-body">{(message.result || message.failed) && <span className="conversation-outcome">{t(message.failed ? "Needs attention" : message.result?.state === "confirmed" ? "Store confirmed" : message.result?.state === "draft" ? "For review" : message.result?.state === "preview" ? "Document summary" : message.result?.state === "unsupported" ? "Try another request" : "Awaiting detail")}</span>}<p>{message.role === "assistant" && message.failed ? t(message.text) : message.text}</p>
            {message.result && !message.result.shoppingList && message.result.state !== "unsupported" && <div className={`conversation-result ${message.result.state}`}><span>{t(message.result.state === "confirmed" ? "VERIFIED STORE RESULT" : message.result.state === "draft" ? "DRAFT FOR REVIEW" : message.result.state === "preview" ? "DOCUMENT SUMMARY" : message.result.state === "clarify" ? "WAITING FOR YOU" : "STORE RESULT")}</span><strong>{message.result.title}</strong><small>{message.result.detail}</small></div>}
            {index === messages.length - 1 && pending?.kind === "product-create-price" && message.role === "assistant" && message.result?.pending?.kind === "product-create-price" && <PendingProductPriceCard
              product={pending.product}
              unit={pending.unit}
              openingStock={pending.openingStock}
              busy={busy}
              onSubmit={(price) => void submitPendingProductPrice(price)}
              label={t("Selling price per")}
              actionLabel={t("Create & Add Stock")}
            />}
            {index === messages.length - 1 && message.role === "assistant" && pending?.kind === "customer-select" && <div className="assistant-choice-cards" role="group" aria-label={t("Select the correct customer")}>
              {pending.candidates.map((customer) => <button key={customer.id} type="button" onClick={() => void runPrompt(customer.customerCode)} disabled={busy}>
                <strong>{customer.customerCode}</strong><span>{customer.maskedPhone ?? t("No verified phone")}</span>
              </button>)}
            </div>}
            {index === messages.length - 1 && message.role === "assistant" && (pending?.kind === "order-transition-select" || pending?.kind === "order-status-select") && <div className="assistant-choice-cards order-choice-cards" role="group" aria-label={t("Select the purchase order")}>
              {pending.candidates.map((order) => <button key={order.id} type="button" onClick={() => void runPrompt(order.orderNumber)} disabled={busy}>
                <strong>{order.orderNumber}</strong><span>{order.supplier} · {new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata" }).format(new Date(order.orderDate))} · {t(order.status)}</span>
                <small>{order.items.join(", ")}</small>
              </button>)}
            </div>}
            {message.attachment && <div className="conversation-attachment">{message.attachment.kind === "image" ? <Image unoptimized src={message.attachment.url} alt={`Preview of ${message.attachment.name}`} width={64} height={64} /> : <FileText size={26} aria-hidden="true" />}<span>{message.attachment.name}</span></div>}
            {message.result?.shoppingList && <ShoppingListResult draft={message.result.shoppingList} busy={busy} inactive={inactiveDrafts.includes(message.id)} onConfirm={(draft, payment) => void confirmSale(draft, payment, message.id)} />}
            {message.result?.state === "clarify" && <span className="clarification-hint">{t("Waiting for your reply · nothing has changed yet")}</span>}
          </div></article>)}
          {messages.length === 0 && <div className="assistant-starters"><span>{t("OR START WITH A REQUEST")}</span><div>{examples.map((example) => <button key={example} type="button" onClick={() => void runPrompt(example)} disabled={busy}>{t(example)}<ArrowUp size={14} aria-hidden="true" /></button>)}</div></div>}
          {busy && <div className="conversation-processing" role="status"><span className="processing-dot" /> {t(voiceState === "processing_audio" ? "Preparing voice recording" : voiceState === "transcribing" ? "Transcribing speech" : workingOn === "attachment" ? "Reading your list; nothing has been changed" : "Checking request and store")}</div>}
        </div>
        <div className="conversation-bottom">
          {pending && <div className="pending-clarification" role="status"><ShieldCheck size={17} aria-hidden="true" /><span>{pendingLabel()} {t("Nothing has changed yet.")}</span><button type="button" onClick={() => void runPrompt("cancel")} disabled={busy} aria-label={t("Cancel the pending store request")}><X size={16} aria-hidden="true" /></button></div>}
          {attachment && <div className="composer-attachment">{attachment.preview.kind === "image" ? <Image unoptimized src={attachment.preview.url} alt={`${t("Preview of")} ${attachment.preview.name}`} width={48} height={48} /> : <FileText size={24} aria-hidden="true" />}<span><strong>{attachment.preview.name}</strong><small>{t("Draft check only · no stock change")}</small></span><button type="button" onClick={() => { URL.revokeObjectURL(attachment.preview.url); setAttachment(null); }} aria-label={t("Remove attachment")}><X size={17} aria-hidden="true" /></button></div>}
          {retryable && lastPrompt && <button className="assistant-retry" type="button" onClick={() => void runPrompt(lastPrompt, false, true)} disabled={busy}><RotateCcw size={15} aria-hidden="true" /> {t("Retry safe request")}</button>}
          <form className="assistant-composer" onSubmit={submit}><label htmlFor="assistant-input" className="sr-only">{t("Ask Vaani")}</label><input id="assistant-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={pendingPlaceholder()} maxLength={500} disabled={busy || voiceInputLocked} />
            <div className="assistant-attachment-control" ref={attachmentMenu}>
              <button ref={attachmentTrigger} type="button" className="assistant-attach" onClick={() => setAttachmentMenuOpen((value) => !value)} disabled={busy || voiceInputLocked} aria-label={t("Add attachment")} aria-expanded={attachmentMenuOpen} aria-controls="assistant-attachment-menu"><Paperclip size={20} aria-hidden="true" /></button>
              {attachmentMenuOpen && <div id="assistant-attachment-menu" className="assistant-attachment-menu">
                <strong>{t("Add a shopping list")}</strong>
                <button type="button" onClick={() => { setAttachmentMenuOpen(false); fileInput.current?.click(); }}><ImagePlus size={18} aria-hidden="true" /> {t("Upload photo")}</button>
                <button type="button" onClick={() => { setAttachmentMenuOpen(false); pdfInput.current?.click(); }}><FileText size={18} aria-hidden="true" /> {t("Upload PDF/document")}</button>
                <button type="button" onClick={() => { setAttachmentMenuOpen(false); cameraInput.current?.click(); }}><Camera size={18} aria-hidden="true" /> {t("Take photo")}</button>
                <details className="attachment-privacy"><summary><Info size={16} aria-hidden="true" /> {t("Attachments & privacy")}</summary><p>{t("Images up to 4 MB; PDFs up to 5 MB. Vaanlekha does not save files to your shop. Gemini analyzes attachments; PDFs are deleted after processing and expire at the provider within 48 hours if interrupted. OpenRouter receives attachment images only when Gemini fails and fallback is configured. Lists remain drafts until you confirm a sale.")}</p></details>
              </div>}
            </div>
            <label className="assistant-language-control"><span className="sr-only">{t("Voice language")}</span><select aria-label={t("Voice language")} value={voiceLanguage} onChange={(event) => setVoiceLanguage(event.target.value as typeof voiceLanguage)} disabled={busy || voiceInputLocked}><option value="hi-IN">हिंदी / Hinglish</option><option value="en-IN">English / Hinglish</option></select></label>
            <button className="assistant-mic" type="button" disabled={busy || !canUseVoice} aria-label={t(providerMode === "mock" ? "Play sample voice flow" : voiceState === "requesting_permission" ? "Cancel microphone permission request" : voiceState === "recording" ? "Stop recording" : "Start recording")} onClick={() => void toggleVoice()}>{voiceState === "recording" ? <Square size={17} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}<span>{t(providerMode === "mock" ? "Sample" : voiceState === "requesting_permission" ? "Cancel" : voiceState === "recording" ? "Stop" : "Speak")}</span></button>
            {(voiceCaptureActive || voiceProcessingActive) && <button className="assistant-voice-cancel" type="button" onClick={cancelVoice} aria-label={t("Cancel voice recording")}><X size={18} aria-hidden="true" /></button>}
            <button className="assistant-send" type="submit" disabled={busy || historyLoading || Boolean(historyError) || (connected && !conversationId) || voiceInputLocked || (!input.trim() && !attachment)} aria-label={t("Send message")}><ArrowUp size={19} aria-hidden="true" /></button></form>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" className="sr-only" tabIndex={-1} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
          <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
          <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" className="sr-only" tabIndex={-1} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
          {voiceNotice && <p className="composer-voice-notice" role="status">{t(voiceNotice)}</p>}
          {realVoice && !canUseVoice && <p className="composer-voice-notice" role="status">{t("Microphone is unavailable here. Add the server-side Gnani key or use a supported browser speech service; typing is always available.")}</p>}
          {offerBrowserFallback && browserSpeechAvailable && <button className="assistant-browser-voice-fallback" type="button" disabled={busy} onClick={() => void toggleVoice(true)}>{t("Use browser speech recognition")}</button>}
          {speechUrl && <audio controls src={speechUrl} aria-label={t("Spoken assistant reply")} className="assistant-audio" />}
        </div>
      </section>
      {(action || voiceState !== "idle") && <aside className="assistant-context" aria-label={t("Action context")}><div className="assistant-context-top"><span>{t("TRUSTED ACTION")}</span><ShieldCheck size={19} strokeWidth={1.5} aria-hidden="true" /></div><VoiceStateIndicator state={voiceState} realVoice={realVoice} realReasoning={realReasoning} connected={connected} reasonerMode={reasonerMode} />
        <div className="action-surface"><p className="action-eyebrow">{t("LATEST RESULT")}</p>{action ? <><h2>{action.title}</h2><span className="action-intent">{t(action.intent)}</span><p className="action-detail">{action.detail}</p><div className="action-warning"><ShieldCheck size={17} aria-hidden="true" /><span>{t(action.state === "confirmed" ? "Confirmed by your store database." : action.state === "draft" ? "Draft only. Review and confirm to record a sale." : action.state === "clarify" ? "Waiting for your answer. No change saved." : "No successful change was confirmed.")}</span></div></> : <><h2>{t("Your next action starts here.")}</h2><p>{t("Vaani will show the intent, store result and any decision that needs your confirmation.")}</p></>}</div>
        <p className="assistant-context-note">{t(realReasoning ? "AI" : "Mock AI")} {t("interprets your request. Your shop records decide the answer. Vaani confirms a change only when it is saved.")}</p>
      </aside>}
    </div>
  </div>;
}
