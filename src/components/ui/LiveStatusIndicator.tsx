type Props = {
  isClockedIn: boolean;
  className?: string;
  showLabel?: boolean;
};

export function LiveStatusIndicator({ isClockedIn, className = "", showLabel = true }: Props) {
  const label = isClockedIn ? "Clocked in" : "Clocked out";

  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-flex items-center gap-2 ${isClockedIn ? "text-emerald-700" : "text-slate-500"} ${className}`}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        {isClockedIn && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
            isClockedIn ? "bg-emerald-500" : "bg-slate-400 opacity-50"
          }`}
        />
      </span>
      {showLabel && <span>{label}</span>}
    </span>
  );
}
