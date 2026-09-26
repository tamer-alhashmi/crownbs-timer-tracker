import Link from "next/link";
import { BarChart3, Clock3, Hotel, Settings, Users } from "lucide-react";

const links = [
  { href: "/admin", label: "Overview", icon: BarChart3 },
  { href: "/admin", label: "Users", icon: Users },
  { href: "/admin", label: "Time Logs", icon: Clock3 },
  { href: "/admin", label: "Hotels", icon: Hotel },
  { href: "/settings", label: "User settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="hidden min-h-screen w-72 border-r border-slate-200 bg-slate-950 text-slate-100 lg:flex lg:flex-col">
      <div className="border-b border-slate-800 px-6 py-5">
        <h2 className="text-xl font-bold">Hotel Time Tracker</h2>
        <p className="mt-1 text-sm text-slate-400">Admin console</p>
      </div>

      <nav className="flex-1 px-4 py-6">
        <ul className="space-y-2">
          {links.map(({ href, label, icon: Icon }) => (
            <li key={label}>
              <Link
                href={href}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
