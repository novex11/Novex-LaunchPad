"use client";

import { useCallback, useRef, useState } from "react";
import {
  CloudArrowUp,
  Image as ImageIcon,
  Link as LinkIcon,
  SpinnerGap,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { LAUNCH_IMAGE_UPLOAD } from "@compose/config";
import { uploadLaunchpadImage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Tab = "upload" | "url";
type Variant = "banner" | "logo";

interface ImageUploaderProps {
  value: string;
  onChange: (url: string) => void;
  /** banner = wide cover · logo = square avatar */
  variant?: Variant;
  className?: string;
}

const VARIANT_COPY: Record<
  Variant,
  { drop: string; browse: string; previewAlt: string; hint: string }
> = {
  banner: {
    drop: "Drop banner here",
    browse: "Choose banner",
    previewAlt: "Banner preview",
    hint: "Wide cover · recommended 1200×400",
  },
  logo: {
    drop: "Drop logo here",
    browse: "Choose logo",
    previewAlt: "Logo preview",
    hint: "Square avatar · recommended 512×512",
  },
};

const ACCEPT_LIST = LAUNCH_IMAGE_UPLOAD.accept.split(",");

function resolveMime(file: File): string {
  if (file.type && ACCEPT_LIST.includes(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };
  return ext ? (map[ext] ?? "") : "";
}

/**
 * Upload from disk (Redis-backed) or paste an external URL.
 * Must NOT be wrapped in a <label> — contains nested buttons.
 */
export function ImageUploader({
  value,
  onChange,
  variant = "banner",
  className,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");

  const copy = VARIANT_COPY[variant];
  const hasPreview = value.trim().length > 0;
  const isLogo = variant === "logo";

  const uploadFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      const mime = resolveMime(file);
      if (!mime) {
        setUploadError(`Use ${LAUNCH_IMAGE_UPLOAD.acceptLabel} only`);
        return;
      }
      if (file.size > LAUNCH_IMAGE_UPLOAD.maxBytes) {
        setUploadError(`File too large — max ${LAUNCH_IMAGE_UPLOAD.maxBytesLabel}`);
        return;
      }
      setUploading(true);
      try {
        const { imageUrl } = await uploadLaunchpadImage(file);
        onChange(imageUrl);
        setTab("upload");
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onChange],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  const applyUrl = () => {
    setUploadError(null);
    const trimmed = urlDraft.trim();
    if (!trimmed) {
      setUploadError("Paste an image URL");
      return;
    }
    try {
      const u = new URL(trimmed);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        setUploadError("URL must start with http:// or https://");
        return;
      }
      onChange(trimmed);
    } catch {
      setUploadError("Invalid URL");
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Tab switcher — always visible */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-border bg-surface-muted p-0.5">
          {(
            [
              ["upload", "Upload", CloudArrowUp],
              ["url", "Paste URL", LinkIcon],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                tab === id
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon size={14} weight={tab === id ? "fill" : "regular"} />
              {label}
            </button>
          ))}
        </div>
        {tab === "upload" && !uploading && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => inputRef.current?.click()}
          >
            <CloudArrowUp size={14} />
            {copy.browse}
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={LAUNCH_IMAGE_UPLOAD.accept}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadFile(file);
          e.target.value = "";
        }}
      />

      {tab === "upload" ? (
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed px-4 py-6 text-center transition-all",
            isLogo ? "aspect-square max-w-[11rem]" : "min-h-[10rem] w-full",
            dragOver
              ? "border-accent bg-accent-subtle ring-2 ring-accent/30"
              : hasPreview
                ? "border-accent/50 bg-surface ring-1 ring-accent/20"
                : "border-accent/30 bg-accent-subtle/30 hover:border-accent hover:bg-accent-subtle/50",
            uploading && "pointer-events-none opacity-70",
          )}
        >
          {hasPreview && !uploading ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                // Keyed by URL so a failed earlier URL's hidden style does not stick to the next one.
                key={value.trim()}
                src={value.trim()}
                alt={copy.previewAlt}
                className={cn(
                  "absolute inset-0 h-full w-full",
                  isLogo ? "object-contain p-3" : "object-cover",
                )}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
              <div className="relative z-10 flex flex-col items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                  <CloudArrowUp size={14} />
                  Replace
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange("");
                    setUploadError(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-destructive/90 px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  <Trash size={12} />
                  Remove
                </button>
              </div>
            </>
          ) : uploading ? (
            <>
              <SpinnerGap size={28} className="animate-spin text-accent-strong" />
              <p className="text-sm font-medium">Uploading…</p>
            </>
          ) : (
            <>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-sm">
                <CloudArrowUp size={24} weight="duotone" />
              </span>
              <p className="text-sm font-semibold">{copy.drop}</p>
              <p className="text-xs text-muted-foreground">
                drag & drop or click{" "}
                <span className="font-medium text-accent-strong">Browse</span>
              </p>
              <p className="font-mono text-[10px] text-muted-foreground/80">
                {LAUNCH_IMAGE_UPLOAD.acceptLabel} · max{" "}
                {LAUNCH_IMAGE_UPLOAD.maxBytesLabel}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <LinkIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="url"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyUrl()}
              placeholder="https://…"
              className="h-11 w-full rounded-xl border border-border bg-surface-muted pl-9 pr-4 text-sm outline-none transition-all placeholder:text-muted-foreground/50 focus:border-accent focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-subtle)]"
            />
          </div>
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={applyUrl}>
            Use this URL
          </Button>
          {hasPreview && (
            <div
              className={cn(
                "overflow-hidden rounded-xl border border-border-subtle",
                isLogo ? "mx-auto aspect-square max-w-[11rem]" : "",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value.trim()}
                alt={copy.previewAlt}
                className={cn(
                  "w-full",
                  isLogo ? "aspect-square object-contain p-2" : "h-28 object-cover",
                )}
              />
            </div>
          )}
        </div>
      )}

      {uploadError && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <WarningCircle size={14} />
          {uploadError}
        </p>
      )}

      {!hasPreview && !uploadError && tab === "upload" && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ImageIcon size={12} />
          {copy.hint}
        </p>
      )}
    </div>
  );
}
