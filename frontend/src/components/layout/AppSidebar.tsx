"use client";

import Image from "next/image";
import {
  LayoutGrid,
  MonitorPlay,
  FileText,
  ClipboardList,
  PieChart,
  Settings,
  Sparkles,
  ChevronsRight,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Home", icon: LayoutGrid, active: false },
  { label: "My Classroom", icon: MonitorPlay, active: false },
  { label: "Assignments", icon: FileText, active: false },
  { label: "Exams", icon: ClipboardList, active: true },
  { label: "My Library", icon: PieChart, active: false },
] as const;

const BRICOLAGE = "[font-family:var(--font-bricolage)]";
const NAV_ICON = "h-5 w-5 shrink-0 group-data-[collapsible=icon]:size-4";

export function AppSidebar() {
  const { toggleSidebar } = useSidebar();

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarContent className="gap-10 overflow-visible px-6 pt-6 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2.5 group-data-[collapsible=icon]:gap-8">
        <div className="flex w-full items-center justify-between group-data-[collapsible=icon]:justify-center">
          <div className="flex items-center gap-2">
            <Image
              src="/veda-icon.png"
              alt="VedaAI"
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-xl"
            />
            <span
              className={cn(
                BRICOLAGE,
                "text-[28px] font-bold tracking-[-0.06em] text-nav-active group-data-[collapsible=icon]:hidden"
              )}
            >
              VedaAI
            </span>
          </div>
          <SidebarTrigger className="text-nav-muted group-data-[collapsible=icon]:hidden" />
        </div>

        <button
          type="button"
          className="flex h-10.5 w-full items-center justify-center gap-2.5 rounded-full bg-[#272727] px-4 text-white shadow-[0px_16px_48px_rgba(255,255,255,0.12),0px_32px_48px_rgba(255,255,255,0.2),inset_0px_-1px_3.5px_rgba(177,177,177,0.6),inset_0px_0px_34.5px_rgba(255,255,255,0.25)] group-data-[collapsible=icon]:h-11 group-data-[collapsible=icon]:w-11 group-data-[collapsible=icon]:shrink-0 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:border-2 group-data-[collapsible=icon]:border-brand-orange group-data-[collapsible=icon]:px-0"
        >
          <Sparkles className="h-4.5 w-4.5 shrink-0" />
          <span className="[font-family:var(--font-inter)] text-base font-medium tracking-[-0.04em] group-data-[collapsible=icon]:hidden">
            AI Teacher&apos;s Toolkit
          </span>
        </button>

        <SidebarMenu className="gap-2 group-data-[collapsible=icon]:items-center">
          {NAV_ITEMS.map(({ label, icon: Icon, active }) => (
            <SidebarMenuItem key={label}>
              <SidebarMenuButton
                isActive={active}
                tooltip={label}
                className={cn(
                  BRICOLAGE,
                  "h-9.5 gap-2 rounded-lg px-3 py-2 text-base tracking-[-0.04em]",
                  active
                    ? "bg-nav-surface font-medium text-nav-active hover:bg-nav-surface"
                    : "font-normal text-nav-muted hover:bg-nav-surface/60 hover:text-nav-active"
                )}
              >
                <Icon className={NAV_ICON} />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="gap-2 px-6 pb-6 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2.5">
        <SidebarMenu className="group-data-[collapsible=icon]:items-center">
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              className={cn(BRICOLAGE, "h-9.5 gap-2 rounded-lg px-3 py-2 text-base font-normal tracking-[-0.04em] text-nav-muted hover:bg-nav-surface/60 hover:text-nav-active")}
            >
              <Settings className={NAV_ICON} />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="flex items-center gap-2 rounded-2xl bg-nav-surface p-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2">
          <Avatar className="h-10 w-10 shrink-0 rounded-xl group-data-[collapsible=icon]:h-11 group-data-[collapsible=icon]:w-11">
            <AvatarFallback className="rounded-xl bg-nav-active text-white">MS</AvatarFallback>
          </Avatar>
          <div className={cn(BRICOLAGE, "min-w-0 group-data-[collapsible=icon]:hidden")}>
            <p
              className="truncate text-base font-bold tracking-[-0.04em] text-nav-active"
              title="Matrubhaban School & College"
            >
              Matrubhaban School &amp; College
            </p>
            <p className="truncate text-sm tracking-[-0.04em] text-[#5e5e5e]">Cuttack, Odisha</p>
          </div>
        </div>

        <button
          type="button"
          aria-label="Expand sidebar"
          onClick={toggleSidebar}
          className="hidden h-9 w-9 items-center justify-center text-[#2b2b2b] group-data-[collapsible=icon]:flex"
        >
          <ChevronsRight className="h-5 w-5" />
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
