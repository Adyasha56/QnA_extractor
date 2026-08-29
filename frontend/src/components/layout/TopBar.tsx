"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, HelpCircle, Bell, Sparkles, ChevronDown, Menu } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const BRICOLAGE = "[font-family:var(--font-bricolage)]";

export function TopBar({ breadcrumb }: { breadcrumb: string }) {
  const router = useRouter();
  const { toggleSidebar } = useSidebar();

  return (
    <header className="mx-3 mt-3 flex h-14 shrink-0 items-center gap-2.5 rounded-2xl bg-white/75 pl-3 pr-4 backdrop-blur-sm md:pl-6 md:pr-2">
      {/* Mobile: bare back arrow + wordmark, no breadcrumb/help/AI — the
          sidebar (and its "Exams" nav item) lives off-canvas below md, so
          the wordmark carries the branding the sidebar would otherwise show. */}
      <div className="flex w-full items-center justify-between md:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="flex h-6 w-6 items-center justify-center text-[#1d1b20]"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <span className={cn(BRICOLAGE, "text-xl font-bold tracking-[-0.06em] text-[#303030]")}>VedaAI</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f6f6] text-[#303030]"
          >
            <Bell className="h-6 w-6" />
            <span className="absolute right-2 top-0.5 h-2 w-2 rounded-full bg-brand-orange" />
          </button>
          <Avatar className="h-8 w-8">
            <AvatarFallback>AN</AvatarFallback>
          </Avatar>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Open menu"
            className="flex h-6 w-6 items-center justify-center text-[#1d1b20]"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div className="hidden items-center gap-3 md:flex">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#303030] shadow-sm hover:bg-white/80"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
      </div>

      <div className="hidden flex-1 items-center gap-2 text-[#a9a9a9] md:flex">
        <ClipboardList className="h-5 w-5 shrink-0" />
        <span className={cn(BRICOLAGE, "text-base font-semibold tracking-[-0.04em]")}>{breadcrumb}</span>
      </div>

      <div className="hidden items-center gap-2.5 md:flex">
        <button
          type="button"
          aria-label="Help"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f6f6] text-[#303030] hover:bg-[#eeeeee]"
        >
          <HelpCircle className="h-6 w-6" />
        </button>
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f6f6] text-[#303030] hover:bg-[#eeeeee]"
        >
          <Bell className="h-6 w-6" />
          <span className="absolute right-2 top-0.5 h-2 w-2 rounded-full bg-brand-orange" />
        </button>
        <button
          type="button"
          aria-label="AI"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#2b2b2b] shadow-[inset_0px_0px_4px_rgba(255,255,255,0.4)] hover:bg-white/80"
        >
          <Sparkles className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2 hover:bg-black/3">
          <Avatar className="h-8 w-8">
            <AvatarFallback>AN</AvatarFallback>
          </Avatar>
          <span className={cn(BRICOLAGE, "hidden text-base font-semibold tracking-[-0.04em] text-[#303030] sm:inline")}>
            Adyasha Nanda
          </span>
          <ChevronDown className="hidden h-5 w-5 text-[#303030] sm:inline" />
        </div>
      </div>
    </header>
  );
}
