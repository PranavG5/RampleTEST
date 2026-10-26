"use client";

import { useEffect, useRef, useState, type VideoHTMLAttributes } from "react";
import { api } from "@/lib/api";
import type { Run } from "@/lib/types";
import { cacheVideo, cachedVideoUrl } from "@/lib/videoCache";

type Props = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  run: Run;
  videoRef?: (el: HTMLVideoElement | null) => void;
};

async function signedUrl(runId: string): Promise<string> {
  return (await api<{ url: string }>(`/api/runs/${runId}/video`)).url;
}

// Plays a run's video from the best source available:
// 1. this browser's cache, 2. a short-lived signed URL from Storage,
// 3. the provider's own URL while the copy into Storage isn't done yet.
export default function RunVideo({ run, videoRef, onPlay, onError, ...rest }: Props) {
  const stored = run.archiveStatus === "stored" && !!run.videoPath;
  const [src, setSrc] = useState<string | undefined>(stored ? undefined : run.providerVideoUrl);
  const source = useRef<"cache" | "signed" | "provider">("provider");
  const refreshed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    refreshed.current = false;
    if (!stored) {
      source.current = "provider";
      setSrc(run.providerVideoUrl);
      return;
    }
    (async () => {
      objectUrl = await cachedVideoUrl(run.id);
      if (cancelled) return;
      if (objectUrl) {
        source.current = "cache";
        setSrc(objectUrl);
        return;
      }
      try {
        const url = await signedUrl(run.id);
        if (cancelled) return;
        source.current = "signed";
        setSrc(url);
      } catch {
        if (cancelled) return;
        source.current = "provider";
        setSrc(run.providerVideoUrl);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [run.id, stored, run.providerVideoUrl]);

  return (
    <video
      {...rest}
      ref={videoRef}
      src={src}
      onPlay={(e) => {
        // First play from Storage: keep a copy in this browser for next time.
        if (source.current === "signed" && src) void cacheVideo(run.id, src);
        onPlay?.(e);
      }}
      onError={(e) => {
        // Signed URLs expire after 10 minutes; get a fresh one once.
        if (source.current === "signed" && !refreshed.current) {
          refreshed.current = true;
          const at = e.currentTarget.currentTime;
          const el = e.currentTarget;
          signedUrl(run.id)
            .then((url) => {
              setSrc(url);
              el.addEventListener("loadedmetadata", () => { el.currentTime = at; }, { once: true });
            })
            .catch(() => {});
        }
        onError?.(e);
      }}
    />
  );
}
