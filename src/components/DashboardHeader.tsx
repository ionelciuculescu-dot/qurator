"use client";

import { RotateCcw } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";

export type DashboardHeaderProps = {
  onNewChat: () => void;
  /** Fișier din `public/` (ex. `/logo.svg`, `/logo.png`). Dacă lipsește sau e invalid, se folosește wordmark-ul. */
  logoSrc?: string;
};

export function DashboardHeader({ onNewChat, logoSrc = "/logo.png" }: DashboardHeaderProps) {
  const [logoFailed, setLogoFailed] = useState(false);

  const onLogoError = useCallback(() => {
    setLogoFailed(true);
  }, []);

  return (
    <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center border-b border-neutral-100 bg-white/70 backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {!logoFailed ? (
            <div className="flex shrink-0 items-center">
              <Image
                src={logoSrc}
                alt="Qurator.expert"
                width={200}
                height={48}
                className="h-7 w-auto max-h-7 max-w-[min(200px,55vw)] object-contain object-left"
                unoptimized={logoSrc.endsWith(".svg")}
                priority
                onError={onLogoError}
              />
            </div>
          ) : (
            <span className="truncate text-[15px] font-bold tracking-tight text-neutral-900">Qurator.expert</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2" title="Consilierul AI este conectat la catalog">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.65)]" />
            </span>
            <span className="text-[12px] font-medium tracking-wide text-neutral-500">Agent activ</span>
          </div>

          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-neutral-200/90 bg-white/60 px-2.5 py-1.5 text-[13px] font-medium text-neutral-600 transition hover:border-neutral-300 hover:bg-white hover:text-neutral-900 sm:px-3"
            aria-label="Chat nou — șterge conversația și vitrina"
          >
            <RotateCcw className="size-4 shrink-0 text-neutral-500" strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">New Chat</span>
          </button>
        </div>
      </div>
    </header>
  );
}
