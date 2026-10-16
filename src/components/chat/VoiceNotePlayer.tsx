"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Loader2, AlertCircle } from "lucide-react";

interface VoiceNotePlayerProps {
  audioUrl: string;
  durationSec?: number | null;
  isSentByMe: boolean;
  onError?: (message: string) => void;
}

export function VoiceNotePlayer({
  audioUrl,
  durationSec,
  isSentByMe,
  onError,
}: VoiceNotePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number>(durationSec || 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const describeError = useCallback(() => {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return offline
      ? "Voice note couldn't play — you appear to be offline."
      : "Couldn't play this voice note. Check your connection and tap to retry.";
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setAudioDuration(Math.round(audio.duration));
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };

    const handleWaiting = () => {
      setIsLoading(true);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    const handleStalled = () => {
      setIsLoading(true);
    };

    const handleError = () => {
      setIsLoading(false);
      setIsPlaying(false);
      setHasError(true);
      onErrorRef.current?.(describeError());
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("stalled", handleStalled);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("stalled", handleStalled);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
    };
  }, [describeError]);

  // Reset transient state if the source URL changes (e.g. local preview -> hosted URL)
  useEffect(() => {
    setHasError(false);
    setIsLoading(false);
    setIsPlaying(false);
    setCurrentTime(0);
  }, [audioUrl]);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;

    // Retry after an error: force the browser to re-fetch the source
    if (hasError) {
      setHasError(false);
      try {
        audio.load();
      } catch {
        // ignore – play() below will surface any real failure
      }
    }

    if (isPlaying) {
      audio.pause();
      return;
    }

    try {
      setIsLoading(true);
      if (audio.ended || audio.currentTime >= (audio.duration || audioDuration || 1) - 0.1) {
        audio.currentTime = 0;
      }
      await audio.play();
    } catch (err) {
      console.error("Audio play error:", err);
      setIsPlaying(false);
      setIsLoading(false);
      setHasError(true);
      onErrorRef.current?.(describeError());
    }
  }

  function handleSeek(index: number, totalBars: number) {
    const audio = audioRef.current;
    if (!audio || hasError) return;

    const effectiveDuration = audio.duration || audioDuration || 1;
    const targetTime = (index / totalBars) * effectiveDuration;
    audio.currentTime = targetTime;
    setCurrentTime(targetTime);
    if (!isPlaying) {
      setIsLoading(true);
      audio.play().catch(() => {
        setIsLoading(false);
      });
    }
  }

  const effectiveDur = audioDuration || durationSec || 0;
  const progressPercent = effectiveDur > 0 ? (currentTime / effectiveDur) * 100 : 0;

  const formatSec = (s: number) => {
    const total = Math.max(0, Math.round(s));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const waveformBars = [40, 75, 95, 50, 80, 100, 65, 90, 45, 80, 85, 60, 95, 70, 50];

  return (
    <div className="flex items-center gap-2.5 py-1 min-w-[200px] select-none">
      <audio ref={audioRef} src={audioUrl} preload="auto" />

      <button
        type="button"
        onClick={togglePlay}
        aria-label={hasError ? "Retry voice note" : isPlaying ? "Pause voice note" : "Play voice note"}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shrink-0 ${
          isSentByMe
            ? "bg-white/20 text-white hover:bg-white/30"
            : "bg-[#FF8965] text-[#211E36] hover:bg-[#F2734C]"
        } ${hasError ? "ring-1 ring-amber-300/60" : ""}`}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : hasError ? (
          <AlertCircle className="w-4 h-4" />
        ) : isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      {/* Waveform representation with click-to-seek */}
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-0.5 h-4 cursor-pointer py-1">
          {waveformBars.map((h, i) => {
            const barProgress = (i / waveformBars.length) * 100;
            const isFilled = progressPercent >= barProgress;
            return (
              <div
                key={i}
                onClick={() => handleSeek(i, waveformBars.length)}
                style={{ height: `${h}%` }}
                className={`flex-1 rounded-full transition-all hover:scale-y-125 ${
                  isFilled
                    ? isSentByMe
                      ? "bg-white"
                      : "bg-[#FF8965]"
                    : isSentByMe
                    ? "bg-white/30"
                    : "bg-[#9C93B8]/40"
                }`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[9px] opacity-75">
          {hasError ? (
            <span className={isSentByMe ? "text-white/90" : "text-amber-300"}>
              Couldn&apos;t play · Tap to retry
            </span>
          ) : isLoading ? (
            <span>{isPlaying ? formatSec(currentTime) : "Loading…"}</span>
          ) : (
            <span>{isPlaying ? formatSec(currentTime) : "Voice Note"}</span>
          )}
          <span>{formatSec(effectiveDur)}</span>
        </div>
      </div>
    </div>
  );
}
