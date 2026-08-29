export function LoadingState({ message }: { message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative local SVG, no optimization needed */}
      <img src="/loader.svg" alt="" width={129} height={135} className="h-[135px] w-[129px] animate-pulse" />
      <p className="text-lg font-bold">Extracting…</p>
      <p className="text-sm text-muted-foreground">{message ?? "This may take a while"}</p>
    </div>
  );
}
