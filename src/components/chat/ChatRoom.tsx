"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Image as ImageIcon,
  Check,
  CheckCheck,
  BookmarkPlus,
  Sparkles,
  Camera,
  Reply,
  X,
  ChevronDown,
  Trash2,
  AlertCircle,
  Loader2,
  Info,
} from "lucide-react";
import { format } from "date-fns";
import { VoiceRecorder } from "./VoiceRecorder";
import { VoiceNotePlayer } from "./VoiceNotePlayer";
import { CameraModal } from "@/components/common/CameraModal";
import { ChatMediaModal } from "./ChatMediaModal";
import { DeleteMessageModal } from "./DeleteMessageModal";

export interface ChatMessageItem {
  id: string;
  senderId: string;
  contentType: "TEXT" | "IMAGE" | "VIDEO" | "VOICE_NOTE";
  text?: string | null;
  contentUrl?: string | null;
  durationSec?: number | null;
  createdAt: string | Date;
  readAt?: string | Date | null;
  replyToId?: string | null;
  replyTo?: {
    id: string;
    text?: string | null;
    contentType: string;
    senderName: string;
  } | null;
  sender: {
    id: string;
    displayName: string;
    nickname?: string | null;
  };
  reactions: Array<{
    id: string;
    emoji: string;
    userId: string;
  }>;
  /** Client-only: delivery state for optimistically rendered messages. */
  localStatus?: "sending" | "sent" | "failed";
  /** Client-only: blob URL used while a media/voice message is still uploading. */
  localPreviewUrl?: string;
}

type ToastVariant = "error" | "info" | "success";

interface ChatToast {
  id: string;
  message: string;
  variant: ToastVariant;
}

type PendingPayload =
  | { kind: "text"; text: string; replyToId?: string | null }
  | {
      kind: "media";
      source: File | Blob;
      fileName: string;
      contentType: "IMAGE" | "VIDEO" | "VOICE_NOTE";
      durationSec?: number;
      replyToId?: string | null;
      previewUrl: string;
    };

interface ChatRoomProps {
  initialMessages: ChatMessageItem[];
  currentUserId: string;
  partnerName: string;
}

const QUICK_EMOJIS = ["❤️", "🥺", "😂", "🔥", "🫂", "✨"];

function areMessagesDifferent(prev: ChatMessageItem[], next: ChatMessageItem[]): boolean {
  if (prev.length !== next.length) return true;
  if (prev.length === 0) return false;
  if (prev[prev.length - 1].id !== next[next.length - 1].id) return true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].id !== next[i].id) return true;
    if (prev[i].readAt !== next[i].readAt) return true;
    if (prev[i].localStatus !== next[i].localStatus) return true;
    if ((prev[i].reactions?.length || 0) !== (next[i].reactions?.length || 0)) return true;
  }
  return false;
}

/**
 * Swap an optimistic (local) message for its server counterpart without
 * disturbing layout order. If a poll already pulled the server message in,
 * the local copy is simply dropped to avoid a duplicate.
 */
function replaceLocalMessage(
  messages: ChatMessageItem[],
  localId: string,
  serverMessage: ChatMessageItem
): ChatMessageItem[] {
  const alreadyPresent = messages.some((m) => m.id === serverMessage.id);
  const result: ChatMessageItem[] = [];
  for (const m of messages) {
    if (m.id === localId) {
      if (!alreadyPresent) result.push({ ...serverMessage, localStatus: "sent" });
      continue;
    }
    result.push(m);
  }
  return result;
}

function createLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatRoom({ initialMessages, currentUserId, partnerName }: ChatRoomProps) {
  const [messages, setMessages] = useState<ChatMessageItem[]>(initialMessages);
  const [text, setText] = useState("");
  const [activeReactionMessageId, setActiveReactionMessageId] = useState<string | null>(null);
  const [savedToGalleryId, setSavedToGalleryId] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessageItem | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [activeMediaModalMessage, setActiveMediaModalMessage] = useState<ChatMessageItem | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<ChatMessageItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [hasUnseenNewMessage, setHasUnseenNewMessage] = useState(false);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [toasts, setToasts] = useState<ChatToast[]>([]);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const isAtBottomRef = useRef(true);
  const isInitialScrollDone = useRef(false);
  const lastTypingSentRef = useRef<number>(0);
  const partnerTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingPayloadsRef = useRef<Map<string, PendingPayload>>(new Map());
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const showToast = useCallback((message: string, variant: ToastVariant = "error") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  // Release any blob URLs still held by optimistic messages on unmount.
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const revokePreview = useCallback((url?: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  }, []);

  const buildReplyPreview = useCallback(
    (snapshot: ChatMessageItem | null): ChatMessageItem["replyTo"] => {
      if (!snapshot) return null;
      return {
        id: snapshot.id,
        text: snapshot.text,
        contentType: snapshot.contentType,
        senderName:
          snapshot.senderId === currentUserId
            ? "You"
            : snapshot.sender.nickname || snapshot.sender.displayName || partnerName,
      };
    },
    [currentUserId, partnerName]
  );

  const markLocalFailed = useCallback(
    (localId: string, message: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === localId ? { ...m, localStatus: "failed" } : m))
      );
      showToast(message, "error");
    },
    [showToast]
  );

  const sendTypingHeartbeat = useCallback((isTyping: boolean) => {
    const now = Date.now();
    if (isTyping) {
      if (now - lastTypingSentRef.current > 2200) {
        lastTypingSentRef.current = now;
        fetch("/api/messages/typing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isTyping: true }),
        }).catch(() => {});
      }
    } else {
      lastTypingSentRef.current = 0;
      fetch("/api/messages/typing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isTyping: false }),
      }).catch(() => {});
    }
  }, []);

  const checkIfAtBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const threshold = 60;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
  }, []);

  const handleScroll = () => {
    const atBottom = checkIfAtBottom();
    isAtBottomRef.current = atBottom;
    setShowScrollBottomBtn(!atBottom);
    if (atBottom) {
      setHasUnseenNewMessage(false);
    }
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollContainerRef.current;
    if (container) {
      if (behavior === "auto" || behavior === "instant") {
        container.scrollTop = container.scrollHeight;
      } else {
        container.scrollTo({
          top: container.scrollHeight,
          behavior,
        });
      }
    }
    messagesEndRef.current?.scrollIntoView({
      behavior: behavior === "auto" ? ("instant" as ScrollBehavior) : behavior,
      block: "end",
    });
    isAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
    setHasUnseenNewMessage(false);
  }, []);

  // Reliable initial scroll to bottom: fires across microtasks/frames to account for layout & hydration
  useEffect(() => {
    if (messages.length === 0) return;

    const scrollIfAtBottom = () => {
      if (isAtBottomRef.current) {
        scrollToBottom("auto");
      }
    };

    // Immediate
    scrollIfAtBottom();

    // After initial paint
    const rafId = requestAnimationFrame(scrollIfAtBottom);

    // Staggered checks to account for fonts, styles and initial images
    const t1 = setTimeout(scrollIfAtBottom, 60);
    const t2 = setTimeout(scrollIfAtBottom, 180);
    const t3 = setTimeout(scrollIfAtBottom, 350);
    const t4 = setTimeout(() => {
      scrollIfAtBottom();
      isInitialScrollDone.current = true;
    }, 650);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []); // Run once on mount

  // Periodic poll for live messages & partner typing indicator
  useEffect(() => {
    async function syncMessages() {
      try {
        const res = await fetch("/api/messages");
        if (res.ok) {
          const data = await res.json();
          const incoming: ChatMessageItem[] = data.messages;
          const typingNow = Boolean(data.isPartnerTyping);

          setIsPartnerTyping((prev) => {
            if (!prev && typingNow && isAtBottomRef.current) {
              setTimeout(() => scrollToBottom("smooth"), 50);
            }
            return typingNow;
          });

          // Local auto-expiration fallback if poll drops
          if (partnerTypingTimeoutRef.current) clearTimeout(partnerTypingTimeoutRef.current);
          if (typingNow) {
            partnerTypingTimeoutRef.current = setTimeout(() => {
              setIsPartnerTyping(false);
            }, 5000);
          }

          setMessages((prev) => {
            // Keep optimistic messages the server doesn't know about yet so
            // they don't flash away every poll while sending/retrying.
            const serverIds = new Set(incoming.map((m) => m.id));
            const preservedLocal = prev.filter(
              (m) =>
                (m.localStatus === "sending" || m.localStatus === "failed") &&
                !serverIds.has(m.id)
            );
            const merged =
              preservedLocal.length > 0 ? [...incoming, ...preservedLocal] : incoming;

            if (!areMessagesDifferent(prev, merged)) {
              return prev;
            }

            const hadNewIncoming =
              merged.length > prev.length &&
              merged[merged.length - 1]?.senderId !== currentUserId;

            if (isAtBottomRef.current) {
              setTimeout(() => scrollToBottom("smooth"), 50);
            } else if (hadNewIncoming) {
              setHasUnseenNewMessage(true);
            }

            return merged;
          });
        }
      } catch (err) {}
    }

    const interval = setInterval(syncMessages, 2800);
    return () => {
      clearInterval(interval);
      if (partnerTypingTimeoutRef.current) clearTimeout(partnerTypingTimeoutRef.current);
    };
  }, [currentUserId, scrollToBottom]);

  const scrollToMessage = (messageId: string) => {
    const targetElement = document.getElementById(`msg-${messageId}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(messageId);
      setTimeout(() => {
        setHighlightedMessageId((curr) => (curr === messageId ? null : curr));
      }, 2000);
    }
  };

  const startReply = (msg: ChatMessageItem) => {
    setReplyingTo(msg);
    setActiveReactionMessageId(null);
    setTimeout(() => {
      textInputRef.current?.focus();
    }, 50);
  };

  async function postTextMessage(localId: string, textValue: string, replyToId?: string | null) {
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: "TEXT",
          text: textValue,
          replyToId: replyToId || undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to send message");
      const { message } = await res.json();
      setMessages((prev) => replaceLocalMessage(prev, localId, message));
      pendingPayloadsRef.current.delete(localId);
    } catch (err) {
      console.error("Send text error:", err);
      markLocalFailed(localId, "Couldn't send your message. Tap to retry.");
    }
  }

  async function handleSendText(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;

    // Instantly clear typing indicator when message is submitted
    sendTypingHeartbeat(false);

    const currentText = text.trim();
    const replyingToSnapshot = replyingTo;
    setText("");
    setReplyingTo(null);

    // Optimistic message – rendered immediately, confirmed in the background
    const localId = createLocalId();
    const optimisticMsg: ChatMessageItem = {
      id: localId,
      senderId: currentUserId,
      contentType: "TEXT",
      text: currentText,
      replyToId: replyingToSnapshot?.id || null,
      replyTo: buildReplyPreview(replyingToSnapshot),
      createdAt: new Date(),
      sender: { id: currentUserId, displayName: "You" },
      reactions: [],
      localStatus: "sending",
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(() => scrollToBottom("smooth"), 50);

    pendingPayloadsRef.current.set(localId, {
      kind: "text",
      text: currentText,
      replyToId: replyingToSnapshot?.id || null,
    });

    await postTextMessage(localId, currentText, replyingToSnapshot?.id || null);
  }

  async function uploadAndPostMedia(
    localId: string,
    payload: Extract<PendingPayload, { kind: "media" }>
  ) {
    try {
      const formData = new FormData();
      formData.append("file", payload.source, payload.fileName);
      formData.append(
        "bucket",
        payload.contentType === "VOICE_NOTE" ? "voice-notes" : "memories"
      );

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url } = await uploadRes.json();

      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: payload.contentType,
          contentUrl: url,
          durationSec: payload.durationSec,
          replyToId: payload.replyToId || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      const { message } = await res.json();

      setMessages((prev) => replaceLocalMessage(prev, localId, message));
      revokePreview(payload.previewUrl);
      pendingPayloadsRef.current.delete(localId);
    } catch (err) {
      console.error("Chat media send error:", err);
      markLocalFailed(
        localId,
        payload.contentType === "VOICE_NOTE"
          ? "Couldn't send your voice note. Tap to retry."
          : "Couldn't send your media. Tap to retry."
      );
    }
  }

  function sendMedia(params: {
    file?: File;
    blob?: Blob;
    fileName?: string;
    contentType: "IMAGE" | "VIDEO" | "VOICE_NOTE";
    durationSec?: number;
  }) {
    const source = params.file ?? params.blob;
    if (!source) return;

    const replyingToSnapshot = replyingTo;
    setReplyingTo(null);

    // Show the local file instantly, then swap for the hosted URL.
    const previewUrl = URL.createObjectURL(source);
    objectUrlsRef.current.add(previewUrl);

    let fileName = params.fileName;
    if (!fileName) {
      const ext = source.type.includes("ogg")
        ? ".ogg"
        : source.type.includes("mp4")
        ? ".m4a"
        : ".webm";
      fileName = `voice-note-${Date.now()}${ext}`;
    }

    const localId = createLocalId();
    const optimisticMsg: ChatMessageItem = {
      id: localId,
      senderId: currentUserId,
      contentType: params.contentType,
      contentUrl: previewUrl,
      localPreviewUrl: previewUrl,
      durationSec: params.durationSec ?? null,
      replyToId: replyingToSnapshot?.id || null,
      replyTo: buildReplyPreview(replyingToSnapshot),
      createdAt: new Date(),
      sender: { id: currentUserId, displayName: "You" },
      reactions: [],
      localStatus: "sending",
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(() => scrollToBottom("smooth"), 50);

    const payload: Extract<PendingPayload, { kind: "media" }> = {
      kind: "media",
      source,
      fileName,
      contentType: params.contentType,
      durationSec: params.durationSec,
      replyToId: replyingToSnapshot?.id || null,
      previewUrl,
    };
    pendingPayloadsRef.current.set(localId, payload);

    void uploadAndPostMedia(localId, payload);
  }

  async function retryMessage(msg: ChatMessageItem) {
    const payload = pendingPayloadsRef.current.get(msg.id);
    if (!payload) {
      showToast("This message can't be retried. Please send it again.", "error");
      return;
    }

    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, localStatus: "sending" } : m))
    );

    if (payload.kind === "text") {
      await postTextMessage(msg.id, payload.text, payload.replyToId || null);
    } else {
      await uploadAndPostMedia(msg.id, payload);
    }
  }

  function uploadMediaFile(file: File) {
    sendMedia({
      file,
      fileName: file.name,
      contentType: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
    });
  }

  function handleSendVoiceNote(blob: Blob, durationSec: number) {
    sendMedia({ blob, contentType: "VOICE_NOTE", durationSec });
  }

  function handleMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMediaFile(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleToggleReaction(messageId: string, emoji: string) {
    setActiveReactionMessageId(null);
    try {
      // Optimistic update
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const exists = m.reactions.find((r) => r.userId === currentUserId && r.emoji === emoji);
          const newReactions = exists
            ? m.reactions.filter((r) => r.id !== exists.id)
            : [...m.reactions, { id: `react-${Date.now()}`, emoji, userId: currentUserId }];
          return { ...m, reactions: newReactions };
        })
      );

      await fetch("/api/messages/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, emoji }),
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function handleSaveToGallery(msg: ChatMessageItem) {
    if (!msg.contentUrl) return;
    try {
      setSavedToGalleryId(msg.id);
      await fetch("/api/messages/save-to-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: msg.contentUrl,
          mediaType: msg.contentType === "VIDEO" ? "VIDEO" : "IMAGE",
          caption: "Saved from chat 💛",
        }),
      });

      setTimeout(() => setSavedToGalleryId(null), 2500);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteMessage(msg: ChatMessageItem) {
    // Optimistic messages never reached the server – just drop them locally.
    if (msg.localStatus === "sending" || msg.localStatus === "failed") {
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      revokePreview(msg.localPreviewUrl);
      pendingPayloadsRef.current.delete(msg.id);
      if (replyingTo?.id === msg.id) setReplyingTo(null);
      if (activeMediaModalMessage?.id === msg.id) setActiveMediaModalMessage(null);
      setMessageToDelete(null);
      return;
    }

    setIsDeleting(true);
    const previousMessages = messages;

    // Optimistic removal from UI
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    if (replyingTo?.id === msg.id) {
      setReplyingTo(null);
    }
    if (activeMediaModalMessage?.id === msg.id) {
      setActiveMediaModalMessage(null);
    }

    try {
      const res = await fetch(`/api/messages/${msg.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        // Fallback to query parameter endpoint
        const fallbackRes = await fetch(`/api/messages?id=${msg.id}`, {
          method: "DELETE",
        });
        if (!fallbackRes.ok) {
          throw new Error("Failed to delete message");
        }
      }

      setMessageToDelete(null);
    } catch (err) {
      console.error("Delete message error:", err);
      // Revert optimistic deletion on failure
      setMessages(previousMessages);
      alert("Could not delete message. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0E0D13] relative">
      {/* Messages Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 md:px-8 py-6 space-y-3.5 no-scrollbar max-w-3xl lg:max-w-4xl mx-auto w-full"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#171520] border border-[#292536] flex items-center justify-center text-[#E26D54] mb-3 shadow-sm">
              <Sparkles className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-semibold text-[#F6F3EE]">This is your private chat</h4>
            <p className="text-xs text-[#9992A8] max-w-xs mt-1 leading-relaxed">
              Only you and {partnerName} are here. Send a sweet note, a voice clip, or a photo.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderId === currentUserId;
            const hasReactions = msg.reactions && msg.reactions.length > 0;
            const isHighlighted = highlightedMessageId === msg.id;

            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={`relative flex flex-col ${isMe ? "items-end" : "items-start"} transition-all duration-300`}
              >
                <div
                  className={`relative group flex items-center gap-1.5 max-w-[85%] sm:max-w-[75%] ${
                    isMe ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  {/* Bubble Container */}
                  <div
                    onClick={() =>
                      setActiveReactionMessageId(
                        activeReactionMessageId === msg.id ? null : msg.id
                      )
                    }
                    className={`relative w-full px-4 py-2.5 shadow-sm cursor-pointer transition-all active:scale-[0.99] ${
                      isMe
                        ? "bg-[#E26D54] text-white bubble-sent font-normal"
                        : "bg-[#1A1824] border border-[#292536] text-[#F6F3EE] bubble-received"
                    } ${
                      isHighlighted
                        ? "ring-2 ring-[#E26D54] ring-offset-2 ring-offset-[#0E0D13] scale-[1.02]"
                        : ""
                    }`}
                  >
                    {/* Reply Quote Preview if message is replying to another */}
                    {msg.replyTo && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          scrollToMessage(msg.replyTo!.id);
                        }}
                        className={`w-full text-left mb-2 px-2.5 py-1.5 rounded-lg border-l-2 text-xs transition-opacity hover:opacity-90 block ${
                          isMe
                            ? "bg-black/20 border-white/80 text-white"
                            : "bg-[#14121A] border-[#E26D54] text-[#F6F3EE]"
                        }`}
                      >
                        <div
                          className={`flex items-center gap-1 text-[10px] font-semibold ${
                            isMe ? "text-white/90" : "text-[#E26D54]"
                          }`}
                        >
                          <Reply className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{msg.replyTo.senderName}</span>
                        </div>
                        <p className="text-[11px] truncate opacity-80 mt-0.5">
                          {msg.replyTo.contentType === "TEXT"
                            ? msg.replyTo.text
                            : msg.replyTo.contentType === "IMAGE"
                            ? "📷 Photo"
                            : msg.replyTo.contentType === "VIDEO"
                            ? "🎥 Video"
                            : "🎙️ Voice note"}
                        </p>
                      </button>
                    )}

                    {/* TEXT Message */}
                    {msg.contentType === "TEXT" && (
                      <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {msg.text}
                      </p>
                    )}

                    {/* VOICE NOTE */}
                    {msg.contentType === "VOICE_NOTE" && msg.contentUrl && (
                      <VoiceNotePlayer
                        audioUrl={msg.contentUrl}
                        durationSec={msg.durationSec}
                        isSentByMe={isMe}
                        onError={(message) => showToast(message, "error")}
                      />
                    )}

                    {/* IMAGE / VIDEO Message */}
                    {(msg.contentType === "IMAGE" || msg.contentType === "VIDEO") &&
                      msg.contentUrl && (
                        <div className="flex flex-col gap-2">
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMediaModalMessage(msg);
                            }}
                            className="relative rounded-xl overflow-hidden max-h-72 bg-black/20 cursor-pointer group"
                            title="Click to view full image"
                          >
                            {msg.contentType === "IMAGE" ? (
                              <img
                                src={msg.contentUrl}
                                alt="Chat media"
                                className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                onLoad={() => {
                                  if (isAtBottomRef.current) {
                                    scrollToBottom("auto");
                                  }
                                }}
                              />
                            ) : (
                              <video
                                src={msg.contentUrl}
                                controls
                                className="w-full h-full object-cover max-h-72"
                                onLoadedMetadata={() => {
                                  if (isAtBottomRef.current) {
                                    scrollToBottom("auto");
                                  }
                                }}
                              />
                            )}
                          </div>

                          {/* 1-tap "Save to gallery" action button */}
                          {(!msg.localStatus || msg.localStatus === "sent") && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSaveToGallery(msg);
                              }}
                              className={`text-[10px] py-1 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                                isMe
                                  ? "bg-black/20 text-white/90 hover:bg-black/30"
                                  : "bg-white/[0.06] text-[#E5B268] hover:bg-white/10"
                              }`}
                            >
                              <BookmarkPlus className="w-3 h-3" />
                              <span>
                                {savedToGalleryId === msg.id
                                  ? "Saved to Memories! 💛"
                                  : "Save to gallery"}
                              </span>
                            </button>
                          )}
                        </div>
                      )}

                    {/* Timestamp & Read Status */}
                    <div
                      className={`flex items-center justify-end gap-1 mt-1 text-[9px] ${
                        isMe ? "text-white/75" : "text-[#9992A8]"
                      }`}
                    >
                      <span>{format(new Date(msg.createdAt), "h:mm a")}</span>
                      {isMe && (
                        <span>
                          {msg.localStatus === "sending" ? (
                            <Loader2 className="w-3 h-3 text-white/80 animate-spin" />
                          ) : msg.localStatus === "failed" ? (
                            <AlertCircle className="w-3 h-3 text-amber-200" />
                          ) : msg.readAt ? (
                            <CheckCheck className="w-3 h-3 text-white" />
                          ) : (
                            <Check className="w-3 h-3 text-white/75" />
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Desktop Quick Actions on Hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0 hidden sm:flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startReply(msg);
                      }}
                      className="p-1.5 rounded-full hover:bg-white/10 text-[#9992A8] hover:text-[#F6F3EE] transition-colors"
                      title="Reply"
                    >
                      <Reply className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveReactionMessageId(null);
                        setMessageToDelete(msg);
                      }}
                      className="p-1.5 rounded-full hover:bg-rose-500/15 text-[#9992A8] hover:text-rose-400 transition-colors"
                      title="Delete message"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Failed-to-send retry affordance */}
                {isMe && msg.localStatus === "failed" && (
                  <button
                    type="button"
                    onClick={() => retryMessage(msg)}
                    className="flex items-center gap-1 mt-1 text-[10px] font-medium text-amber-300 hover:text-amber-200 transition-colors"
                    title="Retry sending"
                  >
                    <AlertCircle className="w-3 h-3" />
                    <span>Not sent · Tap to retry</span>
                  </button>
                )}

                {/* Emoji Reaction Bar + Reply & Delete Actions (Popup on tap) */}
                {activeReactionMessageId === msg.id && (
                  <div className="flex items-center gap-1 p-1 bg-[#14121A] border border-[#292536] rounded-full shadow-2xl mt-1.5 z-20 animate-in fade-in zoom-in-95">
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleReaction(msg.id, emoji);
                        }}
                        className="text-base p-1 hover:scale-125 transition-transform"
                      >
                        {emoji}
                      </button>
                    ))}
                    <div className="w-[1px] h-4 bg-[#292536] mx-0.5" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startReply(msg);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-[#F6F3EE] hover:bg-[#221F2D] hover:text-[#E26D54] transition-colors"
                      title="Reply to message"
                    >
                      <Reply className="w-3.5 h-3.5" />
                      <span>Reply</span>
                    </button>
                    <div className="w-[1px] h-4 bg-[#292536] mx-0.5" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveReactionMessageId(null);
                        setMessageToDelete(msg);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-rose-400 hover:bg-rose-500/15 hover:text-rose-300 transition-colors"
                      title="Delete message"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                )}

                {/* Displayed reactions badge */}
                {hasReactions && (
                  <div
                    className={`flex items-center gap-0.5 -mt-2 z-10 px-2 py-0.5 rounded-full bg-[#14121A] border border-[#292536] shadow-sm text-[10px] ${
                      isMe ? "mr-1" : "ml-1"
                    }`}
                  >
                    {Array.from(new Set(msg.reactions.map((r) => r.emoji))).map((emoji) => (
                      <span key={emoji}>{emoji}</span>
                    ))}
                    {msg.reactions.length > 1 && (
                      <span className="text-[#9992A8] font-mono text-[9px] ml-0.5">
                        {msg.reactions.length}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        {/* Partner is typing bubble indicator */}
        {isPartnerTyping && (
          <div className="flex items-center gap-2 mb-2 animate-in fade-in duration-200">
            <div className="px-3.5 py-2 rounded-2xl rounded-bl-sm bg-[#1A1824] border border-[#292536] text-[#9992A8] flex items-center gap-2 shadow-sm">
              <span className="text-xs font-medium text-[#F6F3EE]/80">
                {partnerName} is typing
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#E26D54] animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#E26D54] animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#E26D54] animate-bounce" />
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Jump to Latest Button */}
      {showScrollBottomBtn && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-24 right-5 md:right-8 z-30 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#1A1824]/95 border border-[#292536] text-[#F6F3EE] shadow-2xl hover:bg-[#242031] transition-all backdrop-blur-md text-xs font-medium group"
        >
          <ChevronDown className="w-4 h-4 text-[#E26D54] group-hover:translate-y-0.5 transition-transform" />
          {hasUnseenNewMessage ? (
            <span className="text-[#E26D54] font-semibold flex items-center gap-1.5">
              New message
              <span className="w-2 h-2 rounded-full bg-[#E26D54] animate-pulse" />
            </span>
          ) : (
            <span>Latest</span>
          )}
        </button>
      )}

      {/* Subtle toast stack for send failures / playback errors */}
      {toasts.length > 0 && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 w-[90%] max-w-sm pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 ${
                t.variant === "error"
                  ? "bg-[#2A1A1A]/95 border-rose-500/30 text-rose-100"
                  : t.variant === "success"
                  ? "bg-[#17231A]/95 border-emerald-500/30 text-emerald-100"
                  : "bg-[#1A1824]/95 border-[#292536] text-[#F6F3EE]"
              }`}
            >
              {t.variant === "error" ? (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Info className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input Bar Area */}
      <div className="p-3.5 md:py-4 bg-[#14121A]/95 border-t border-[#242031] backdrop-blur-md">
        {/* Replying banner preview */}
        {replyingTo && (
          <div className="max-w-3xl lg:max-w-4xl mx-auto w-full mb-2">
            <div className="flex items-center justify-between px-3 py-2 bg-[#1A1824] border border-[#292536] rounded-xl text-xs text-[#9992A8] animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center gap-2 overflow-hidden mr-2">
                <div className="w-1 h-7 bg-[#E26D54] rounded-full shrink-0" />
                <div className="truncate">
                  <div className="flex items-center gap-1">
                    <Reply className="w-3 h-3 text-[#E26D54]" />
                    <span className="font-semibold text-[#E26D54]">
                      Replying to{" "}
                      {replyingTo.senderId === currentUserId
                        ? "yourself"
                        : replyingTo.sender.nickname ||
                          replyingTo.sender.displayName ||
                          partnerName}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-[#C4BFD0] mt-0.5">
                    {replyingTo.contentType === "TEXT"
                      ? replyingTo.text
                      : replyingTo.contentType === "IMAGE"
                      ? "📷 Photo"
                      : replyingTo.contentType === "VIDEO"
                      ? "🎥 Video"
                      : "🎙️ Voice note"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-[#9992A8] hover:text-[#F6F3EE] transition-colors shrink-0"
                title="Cancel reply"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Subtle partner typing notice if user is scrolled up */}
        {isPartnerTyping && showScrollBottomBtn && (
          <div className="max-w-3xl lg:max-w-4xl mx-auto w-full mb-2 px-1 flex items-center gap-1.5 text-[11px] text-[#E26D54] font-medium animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[#E26D54]" />
            <span>{partnerName} is typing...</span>
          </div>
        )}

        <form
          onSubmit={handleSendText}
          className="max-w-3xl lg:max-w-4xl mx-auto w-full flex items-center gap-2"
        >
          {/* Camera snap button */}
          <button
            type="button"
            onClick={() => setIsCameraOpen(true)}
            className="p-2.5 rounded-xl bg-[#1A1824] hover:bg-[#221F2D] text-[#E26D54] hover:text-[#D05E46] border border-white/[0.05] transition-colors shrink-0 group"
            title="Take Photo"
          >
            <Camera className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>

          {/* Media upload button from gallery */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl bg-[#1A1824] hover:bg-[#221F2D] text-[#9992A8] hover:text-[#F6F3EE] border border-white/[0.05] transition-colors shrink-0 group"
            title="Attach Photo or Video from Gallery"
          >
            <ImageIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleMediaUpload}
            accept="image/*,video/*"
            className="hidden"
          />

          {/* Voice recorder button */}
          <VoiceRecorder onRecorded={handleSendVoiceNote} />

          {/* Text Input */}
          <input
            ref={textInputRef}
            type="text"
            placeholder={
              replyingTo
                ? `Replying to ${
                    replyingTo.senderId === currentUserId
                      ? "yourself"
                      : replyingTo.sender.nickname ||
                        replyingTo.sender.displayName ||
                        partnerName
                  }...`
                : `Message ${partnerName}...`
            }
            value={text}
            onChange={(e) => {
              const val = e.target.value;
              setText(val);
              if (val.trim()) {
                sendTypingHeartbeat(true);
              } else {
                sendTypingHeartbeat(false);
              }
            }}
            onBlur={() => {
              sendTypingHeartbeat(false);
            }}
            className="flex-1 bg-[#1A1824] border border-[#292536] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-[#F6F3EE] placeholder-[#9992A8]/60 focus:outline-none focus:border-[#E26D54]"
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={!text.trim()}
            className="p-2.5 rounded-xl bg-[#E26D54] hover:bg-[#D05E46] text-[#0E0D13] disabled:opacity-30 transition-all shrink-0 font-bold"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>

      {/* Live Camera Modal */}
      <CameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={uploadMediaFile}
        title={`Take Photo for ${partnerName}`}
      />

      {/* Fullscreen WhatsApp-style Media Lightbox */}
      <ChatMediaModal
        message={activeMediaModalMessage}
        onClose={() => setActiveMediaModalMessage(null)}
        onSaveToGallery={handleSaveToGallery}
        onDelete={(msg) => {
          setMessageToDelete(msg);
        }}
        isSaved={Boolean(activeMediaModalMessage && savedToGalleryId === activeMediaModalMessage.id)}
      />

      {/* Delete Confirmation Modal */}
      <DeleteMessageModal
        isOpen={Boolean(messageToDelete)}
        message={messageToDelete}
        currentUserId={currentUserId}
        partnerName={partnerName}
        onClose={() => {
          if (!isDeleting) setMessageToDelete(null);
        }}
        onConfirm={handleDeleteMessage}
        isDeleting={isDeleting}
      />
    </div>
  );
}
