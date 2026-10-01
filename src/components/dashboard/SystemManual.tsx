import { BookOpen, CheckCircle2 } from "lucide-react";

export function SystemManual({ role }: { role: string }) {
  const isCleaner = role.toLowerCase() === "cleaner" || role.toLowerCase() === "housekeeper";
  const common = isCleaner ? [
    { title: "Review your submissions", text: "Use Recent submissions and its date filters to find completed work, review approval status, and open task details." },
    { title: "Use task notes", text: "Add useful room or service notes when starting or editing a task. If an entry needs an administrative correction, contact your Manager." },
    { title: "Monitor updates", text: "Shift and task updates refresh in the dashboard. Finish an active task before clocking out." },
    { title: "Use role-appropriate access", text: "Your account can manage your own shift and task workflow. Property, staff, payroll, and approval controls are handled by management." },
  ] : [
    { title: "Review the overview", text: "Use Overview for property coverage, completed work, approvals, and labor-cost indicators. Cost figures include recorded task overrides." },
    { title: "Use filters before acting", text: "In Work Logs, choose a property first to narrow Cleaner and Service options. Date, status, approval, and sort filters apply to the complete result set, not only the visible page." },
    { title: "Keep records auditable", text: "Inspect work details before approvals or rejections. Administrative interventions require a reason and are written to the audit trail." },
    { title: "Monitor updates", text: "Work-log, shift, property, and service catalog changes refresh across open management dashboards." },
  ];
  const roleGuidance: Record<string, { title: string; text: string }[]> = {
    admin: [
      { title: "Manage the portfolio", text: "Admin can inspect all properties and manage property assignments, service pricing, payroll tasks, and active operations." },
      { title: "Manage approvals", text: "Admin can perform manager- or owner-level work-log approvals and can intervene in active shifts/tasks. Record a clear reason for each intervention." },
    ],
    manager: [
      { title: "Manage assigned properties", text: "Property lists, cleaners, work logs, and operational data are limited to properties assigned to your Manager account." },
      { title: "Review manager approvals", text: "Approve or reject completed work assigned to your manager responsibility snapshot. Locked payroll records are available in Financials & Payroll." },
    ],
    owner: [
      { title: "Review owned properties", text: "Property lists, staff options, and reporting are limited to properties assigned to your Owner account." },
      { title: "Review owner approvals", text: "Approve or reject completed work assigned to your owner responsibility snapshot. Use Audit & Compliance to inspect historical assignments and interventions." },
    ],
    cleaner: [
      { title: "Record a shift and task", text: "Start your shift, select an assigned property/service, record completed rooms, then finish the task and shift when work ends." },
      { title: "Keep task details accurate", text: "Record room numbers and useful notes. Contact your Manager if a task or shift needs an administrative correction." },
    ],
    housekeeper: [
      { title: "Record a shift and task", text: "Start your shift, select an assigned property/service, record completed rooms, then finish the task and shift when work ends." },
      { title: "Keep task details accurate", text: "Record room numbers and useful notes. Contact your Manager if a task or shift needs an administrative correction." },
    ],
  };
  const sections = [...(roleGuidance[role.toLowerCase()] ?? roleGuidance.manager), ...common];
  return <div className="grid gap-3 md:grid-cols-2">
    {sections.map((section, index) => <article key={section.title} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">{index < 2 ? <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> : <BookOpen aria-hidden="true" className="h-4 w-4" />}</span><div><h3 className="font-semibold text-slate-950">{section.title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{section.text}</p></div></div>
    </article>)}
  </div>;
}
