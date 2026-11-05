import Link from "next/link";
import { Clock3, Home, Settings } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/dashboard", label: "Clock", icon: Clock3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom,0px)] text-ink backdrop-blur-sm md:hidden">
      <div className="grid grid-cols-3 gap-2 px-4 py-2">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={label}
            href={href}
            className="flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-medium text-ink-secondary transition hover:bg-surface-secondary hover:text-ink"
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
