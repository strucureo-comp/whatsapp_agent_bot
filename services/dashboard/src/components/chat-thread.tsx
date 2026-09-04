"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowDown,
  Send,
  Paperclip,
  Mic,
  MicOff,
  Play,
  Pause,
  FileText,
  Image as ImageIcon,
  MapPin,
  CheckCheck,
  Check,
  Clock,
  Volume2,
  X,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { Conversation, Message, Ticket } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentToggle } from "@/components/agent-toggle";
import { ContactDrawer } from "@/components/contact-drawer";
import { ResolveEscalationButton } from "@/components/resolve-button";
import { ContactTagBadge } from "@/components/status-badge";

interface ChatThreadProps {
  conversation: Conversation;
  initialMessages: Message[];
  chatTickets: Ticket[];
}

export function ChatThread({
  conversation,
  initialMessages,
  chatTickets,
}: ChatThreadProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadBelow, setUnreadBelow] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recordTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Sync initialMessages when conversation or SSR props change
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "end",
      });
    }
  }, []);

  // Initial scroll on mount or conversation switch
  useEffect(() => {
    scrollToBottom(false);
  }, [conversation.id, scrollToBottom]);

  // Handle scroll detection
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 60;
    setIsAtBottom(atBottom);
    if (atBottom) {
      setUnreadBelow(0);
    }
  };

  // Background poll for new messages every 4 seconds
  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/conversations/${conversation.id}/messages`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.messages)) {
          setMessages((current) => {
            // Check if there are changes or new messages
            if (data.messages.length !== current.length) {
              return data.messages;
            }
            return current;
          });
        }
      } catch {
        // quiet background refresh
      }
    }, 3500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversation.id]);

  // Auto scroll down if user was already at bottom when new messages arrive
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom(true);
    } else {
      setUnreadBelow((prev) => prev + 1);
    }
  }, [messages.length, isAtBottom, scrollToBottom]);

  // Send message
  async function handleSend(textToSend?: string) {
    const text = (textToSend ?? inputText).trim();
    if (!text || sending) return;

    setSending(true);
    setInputText("");
    setShowAttachMenu(false);

    // Optimistic message
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      conversation_id: conversation.id,
      wa_message_id: null,
      role: "assistant",
      content: text,
      usage_json: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(() => scrollToBottom(true), 50);

    try {
      const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${res.status}`);
      }

      const data = await res.json();
      if (data.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? data.message : m))
        );
      }
      router.refresh();
    } catch (err) {
      console.error("Failed to send message:", err);
      // Mark failed or notify
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, content: `${m.content} (Failed to send)` } : m
        )
      );
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  // Voice recording simulation / actual MediaRecorder
  async function startRecording() {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recorder.start();
      }
      setIsRecording(true);
      setRecordDuration(0);
      recordTimerRef.current = setInterval(() => {
        setRecordDuration((s) => s + 1);
      }, 1000);
    } catch (err) {
      console.warn("Microphone access denied or unavailable, using voice note mock:", err);
      setIsRecording(true);
      setRecordDuration(0);
      recordTimerRef.current = setInterval(() => {
        setRecordDuration((s) => s + 1);
      }, 1000);
    }
  }

  function stopAndSendRecording() {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    const duration = recordDuration;
    setIsRecording(false);
    setRecordDuration(0);
    const secs = duration < 10 ? `0${duration}` : `${duration}`;
    handleSend(`[voice message: 0:${secs}]`);
  }

  function cancelRecording() {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    setIsRecording(false);
    setRecordDuration(0);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#efeae2] relative">
      {/* ── Chat Header ──────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-white px-3.5 py-2.5 shadow-sm z-10">
        <Button asChild variant="ghost" size="icon" className="md:hidden">
          <Link href="/conversations">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="relative">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow-sm">
            {conversation.customer_number.slice(0, 2)}
          </span>
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-green-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">
              {conversation.customer_name || conversation.customer_number}
            </span>
            <ContactTagBadge tag={conversation.contact_tag} />
          </div>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {conversation.customer_number} · {conversation.tenant_name} · {messages.length} msgs
            {conversation.is_test ? " · test" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <AgentToggle conversationId={conversation.id} status={conversation.status} compact />
          <ContactDrawer conversation={conversation} tickets={chatTickets} />
          {conversation.status === "escalated" ? (
            <ResolveEscalationButton conversationId={conversation.id} />
          ) : null}
        </div>
      </div>

      {/* ── Messages Scroll Container ─────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 scroll-smooth"
        style={{
          backgroundImage: `radial-gradient(rgba(0,0,0,0.04) 1px, transparent 0)`,
          backgroundSize: "24px 24px",
        }}
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="rounded-full bg-white/80 p-3 text-muted-foreground shadow-sm">
              <Sparkles className="h-6 w-6 text-emerald-600" />
            </span>
            <p className="mt-2 text-sm font-medium text-zinc-700">No messages yet</p>
            <p className="text-xs text-zinc-500">Send a message below to start the chat.</p>
          </div>
        ) : (
          messages.map((m) => {
            const isMine = m.role === "assistant";
            return (
              <div
                key={m.id}
                className={cn("flex w-full group", isMine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "relative max-w-[85%] sm:max-w-[72%] rounded-2xl px-3.5 py-2 text-sm shadow-sm transition-all",
                    isMine
                      ? "rounded-tr-none bg-[#d9fdd3] text-zinc-900"
                      : "rounded-tl-none bg-white text-zinc-900 border border-zinc-100"
                  )}
                >
                  {/* Bubble Content Body */}
                  <MessageBubbleContent content={m.content} isMine={isMine} />

                  {/* Timestamp & Delivery Status */}
                  <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-zinc-500 select-none">
                    <span>
                      {m.created_at
                        ? new Date(m.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                    {isMine && (
                      <span className="text-emerald-700">
                        {m.id.startsWith("temp-") ? (
                          <Clock className="h-3 w-3 animate-spin text-zinc-400" />
                        ) : (
                          <CheckCheck className="h-3.5 w-3.5 text-blue-500 inline" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* ── Floating Scroll-to-Bottom Button ───────────────────── */}
      {!isAtBottom && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-20 right-6 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-700 shadow-md border hover:bg-zinc-50 transition-transform active:scale-95"
          title="Scroll to bottom"
        >
          <ArrowDown className="h-4 w-4" />
          {unreadBelow > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">
              {unreadBelow}
            </span>
          )}
        </button>
      )}

      {/* ── Status Hint ──────────────────────────────────────── */}
      <div className="border-t bg-white/70 backdrop-blur-xs px-4 py-1 text-center text-[11px] text-muted-foreground select-none">
        {conversation.status === "active" ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            AI Bot replies automatically · Operators can jump in anytime
          </span>
        ) : conversation.status === "human_handling" ? (
          <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Human mode active — send replies below or from your phone
          </span>
        ) : (
          <span className="text-red-600 font-medium">
            Escalated conversation — resolve above when handling is complete
          </span>
        )}
      </div>

      {/* ── Voice Recording In-Progress Bar ────────────────────── */}
      {isRecording && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-red-50 px-4 py-3 text-red-800 animate-pulse">
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 rounded-full bg-red-600 animate-ping" />
            <Mic className="h-4 w-4 text-red-600" />
            <span className="text-sm font-semibold">Recording voice note...</span>
            <span className="font-mono text-sm font-bold ml-2">
              0:{recordDuration < 10 ? `0${recordDuration}` : recordDuration}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={cancelRecording}
              variant="ghost"
              size="sm"
              className="text-red-700 hover:bg-red-100 h-8 px-2.5 text-xs"
            >
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button
              onClick={stopAndSendRecording}
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white h-8 px-3 text-xs shadow-xs"
            >
              <Send className="h-3.5 w-3.5 mr-1" /> Send Voice Note
            </Button>
          </div>
        </div>
      )}

      {/* ── Message Input Bar ─────────────────────────────────── */}
      {!isRecording && (
        <div className="shrink-0 border-t bg-white p-2.5 sm:px-4 sm:py-3 shadow-md">
          {showAttachMenu && (
            <div className="mb-2 flex flex-wrap gap-2 p-2 rounded-xl bg-zinc-50 border border-zinc-200 animate-in fade-in slide-in-from-bottom-2 duration-150">
              <button
                type="button"
                onClick={() => {
                  const url = prompt("Enter image URL to share (https://...):");
                  if (url?.trim()) {
                    handleSend(`[image: ${url.trim()}]`);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 shadow-xs"
              >
                <ImageIcon className="h-3.5 w-3.5 text-purple-600" />
                Photo / Image
              </button>
              <button
                type="button"
                onClick={() => {
                  const doc = prompt("Enter document title or URL (e.g., Quotation.pdf):");
                  if (doc?.trim()) {
                    handleSend(`[document: ${doc.trim()}]`);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 shadow-xs"
              >
                <FileText className="h-3.5 w-3.5 text-blue-600" />
                Document
              </button>
              <button
                type="button"
                onClick={() => {
                  const loc = prompt("Enter location address or label:");
                  if (loc?.trim()) {
                    handleSend(`[location: ${loc.trim()}]`);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 shadow-xs"
              >
                <MapPin className="h-3.5 w-3.5 text-red-600" />
                Location
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSend(`[voice message: 0:24]`);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 shadow-xs"
              >
                <Volume2 className="h-3.5 w-3.5 text-emerald-600" />
                Voice Note
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => setShowAttachMenu((prev) => !prev)}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 transition-colors",
                showAttachMenu && "bg-zinc-100 text-zinc-900"
              )}
              title="Attach media, document, voice note"
            >
              <Paperclip className="h-5 w-5" />
            </button>

            {/* Auto-growing Textarea */}
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type a message (Enter to send, Shift+Enter for newline)..."
                rows={1}
                className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-sm focus:bg-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 max-h-32 min-h-[38px]"
                disabled={sending}
              />
            </div>

            {/* Voice Note Button */}
            <button
              type="button"
              onClick={startRecording}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
              title="Record voice note"
            >
              <Mic className="h-5 w-5" />
            </button>

            {/* Send Button */}
            <Button
              onClick={() => handleSend()}
              disabled={!inputText.trim() || sending}
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-component: Formatted WhatsApp Bubble Content
// ─────────────────────────────────────────────────────────────
function MessageBubbleContent({ content, isMine }: { content: string; isMine: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);

  // 1. Voice Note / Audio Message
  if (
    content.startsWith("[voice message") ||
    content.startsWith("[audio message") ||
    content.includes(".ogg") ||
    content.includes(".mp3")
  ) {
    const label = content.replace(/^\[|\]$/g, "");
    return (
      <div className="flex items-center gap-3 py-1 min-w-[200px] sm:min-w-[240px]">
        <button
          type="button"
          onClick={() => {
            setIsPlaying((p) => !p);
            if (!isPlaying) {
              setPlaybackProgress(0);
              const interval = setInterval(() => {
                setPlaybackProgress((prev) => {
                  if (prev >= 100) {
                    clearInterval(interval);
                    setIsPlaying(false);
                    return 0;
                  }
                  return prev + 10;
                });
              }, 300);
            }
          }}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-xs transition-transform active:scale-90",
            isMine ? "bg-emerald-600 hover:bg-emerald-700" : "bg-emerald-600 hover:bg-emerald-700"
          )}
        >
          {isPlaying ? <Pause className="h-4 w-4 fill-white" /> : <Play className="h-4 w-4 fill-white ml-0.5" />}
        </button>

        {/* Waveform Visualization */}
        <div className="flex-1 flex flex-col justify-center gap-1">
          <div className="flex items-center gap-1 h-6">
            {[40, 70, 90, 45, 80, 100, 60, 30, 85, 95, 55, 75, 40, 90, 65, 35].map((h, i) => {
              const active = (i / 16) * 100 <= playbackProgress;
              return (
                <div
                  key={i}
                  className={cn(
                    "w-1 rounded-full transition-all duration-150",
                    active ? "bg-emerald-600" : "bg-zinc-300"
                  )}
                  style={{ height: `${Math.max(20, h * 0.24)}px` }}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
            <span>{isPlaying ? `0:0${Math.floor(playbackProgress / 10)}` : "0:18"}</span>
            <span className="flex items-center gap-1 text-[10px] text-emerald-700 font-sans font-medium">
              <Mic className="h-3 w-3" /> Voice Note
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 2. Document Message
  if (content.startsWith("[document")) {
    const docName = content.replace(/^\[document:?\s*|\]$/g, "") || "Document attachment";
    return (
      <div className="flex items-center gap-3 p-2 rounded-xl bg-black/5 my-1 min-w-[200px]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-zinc-800">{docName}</p>
          <span className="text-[10px] font-medium text-blue-700 uppercase tracking-wider">
            PDF Document
          </span>
        </div>
      </div>
    );
  }

  // 3. Image Message
  if (content.startsWith("[image") || content.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i)) {
    const urlMatch = content.match(/https?:\/\/[^\s\]]+/);
    const imageUrl = urlMatch ? urlMatch[0] : null;
    const caption = content.replace(/^\[image:?\s*|\]$/g, "").replace(/https?:\/\/[^\s\]]+/, "").trim();

    return (
      <div className="space-y-1.5 my-1">
        {imageUrl ? (
          <div className="overflow-hidden rounded-xl border border-black/10 max-h-64 bg-zinc-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="WhatsApp media attachment" className="w-full object-cover max-h-60" />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-purple-50 text-purple-900 border border-purple-200">
            <ImageIcon className="h-5 w-5 text-purple-600" />
            <div className="text-xs">
              <span className="font-semibold block">Photo / Media Attachment</span>
              <span className="text-purple-700">{content.replace(/^\[|\]$/g, "")}</span>
            </div>
          </div>
        )}
        {caption ? <p className="text-sm">{caption}</p> : null}
      </div>
    );
  }

  // 4. Location Message
  if (content.startsWith("[location")) {
    const locText = content.replace(/^\[location:?\s*|\]$/g, "") || "Location shared";
    return (
      <div className="flex items-center gap-3 p-2.5 rounded-xl bg-red-50 text-red-900 border border-red-200 my-1">
        <MapPin className="h-5 w-5 text-red-600 shrink-0" />
        <div className="text-xs min-w-0 flex-1">
          <span className="font-semibold block">Shared Location</span>
          <span className="truncate block text-red-700">{locText}</span>
        </div>
      </div>
    );
  }

  // 5. Default Text with Linkification & Markdown styles
  return (
    <div className="whitespace-pre-wrap leading-relaxed break-words font-sans text-sm">
      {content}
    </div>
  );
}
