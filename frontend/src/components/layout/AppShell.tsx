import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";

export function AppShell({
  breadcrumb,
  children,
  showBottomGlow = false,
}: {
  breadcrumb: string;
  children: React.ReactNode;
  showBottomGlow?: boolean;
}) {
  return (
    <SidebarProvider
      className="bg-muted/40"
      style={
        {
          "--sidebar-width": "304px",
          "--sidebar-width-icon": "70px",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-transparent">
        <TopBar breadcrumb={breadcrumb} />
        <main className="bg-dot-grid relative min-h-0 flex-1 overflow-hidden bg-muted/40">
          {showBottomGlow && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-72 bg-[radial-gradient(ellipse_70%_100%_at_50%_100%,rgba(23,23,23,0.4)_0%,rgba(23,23,23,0)_70%)]"
            />
          )}
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
