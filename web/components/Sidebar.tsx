"use client";

import { BarChart3, Check, ChevronsUpDown, Columns3, LayoutGrid, Moon, PanelLeft, Plus, Sun } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { Mark } from "./Mark";
import { ORDER, PERSONAS, type Persona, type PersonaId } from "@/lib/personas";
import type { Bay } from "@/lib/types";

export type CaseSummary = { id: string; title: string; bay?: number };

type Props = {
  bays: Bay[];
  boardError?: string;
  cases: CaseSummary[];
  activeCaseId: string | null;
  theme: "light" | "dark";
  persona: Persona;
  onPersona: (id: PersonaId) => void;
  onNew: () => void;
  onBay: (bay: Bay) => void;
  onCase: (id: string) => void;
  onPrompt: (text: string) => void;
  onTheme: () => void;
  onCollapse: () => void;
};

export function Sidebar({ bays, boardError, cases, activeCaseId, theme, persona, onPersona, onNew, onBay, onCase, onPrompt, onTheme, onCollapse }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeBay = cases.find((c) => c.id === activeCaseId)?.bay;
  const recent = cases.filter((c) => c.bay === undefined || !bays.some((b) => b.bay === c.bay)).slice(0, 8);

  return (
    <aside className="flex min-h-0 flex-col border-r border-line bg-side transition-colors duration-400">
      <div className="flex items-center justify-between py-[18px] pr-4 pl-5">
        <div className="flex items-center gap-2.5 font-serif text-[26px] leading-none tracking-[-.01em]">
          <Mark className="size-[22px]" />
          Healthline
        </div>
        <button onClick={onCollapse} title="Collapse sidebar" className="rounded-lg p-[7px] text-mute hover:bg-line hover:text-ink">
          <PanelLeft className="size-[18px]" strokeWidth={1.5} />
        </button>
      </div>

      <nav className="grid gap-px px-2.5 py-1">
        <NavButton onClick={onNew} className="mb-1.5 bg-line" icon={<Plus className="size-[18px]" strokeWidth={1.5} />}>
          New case
          <kbd className="ml-auto font-mono text-[10px] tracking-[.06em] text-mute">⌘K</kbd>
        </NavButton>
        <NavButton onClick={() => onPrompt("Who is on the ER board right now?")} icon={<LayoutGrid className="size-[18px]" strokeWidth={1.5} />}>
          ER board
          <span className="ml-auto rounded-full border border-edge px-[7px] py-1 font-mono text-[10px] leading-none tracking-[.06em] text-mute uppercase">
            {bays.length || "–"}
          </span>
        </NavButton>
        <NavButton
          onClick={() => onPrompt("Chart ER visits per month in Cleveland in 2024")}
          icon={<BarChart3 className="size-[18px]" strokeWidth={1.5} />}
        >
          Population
        </NavButton>
        <Link href="/team" className="flex items-center gap-3 rounded-[9px] px-2.5 py-[9px] text-[15px] font-normal hover:bg-line">
          <Columns3 className="size-[18px]" strokeWidth={1.5} />
          Team view
          <span className="ml-auto font-mono text-[10px] tracking-[.06em] text-mute uppercase">3 personas</span>
        </Link>
      </nav>

      <div className="label flex items-center gap-1.5 px-5 pt-5 pb-1.5">
        <span className="size-1.5 animate-[pulse-dot_2s_infinite] rounded-full bg-accent" />
        Now
      </div>
      <div className="grid min-h-0 gap-px overflow-y-auto px-2.5">
        {boardError && <div className="px-2.5 py-2 text-[12.5px] text-accent">Board unavailable</div>}
        {bays.map((b) => (
          <button
            key={b.bay}
            onClick={() => onBay(b)}
            className={clsx(
              "grid grid-cols-[auto_1fr] items-baseline gap-x-2 rounded-[9px] px-2.5 py-2 text-left text-[14px] font-light hover:bg-line",
              activeBay === b.bay && "bg-raise shadow-[inset_0_0_0_1px_var(--line)] hover:bg-raise",
            )}
          >
            <span className={clsx("inline-block size-1.5 -translate-y-px rounded-full", b.acuity <= 2 ? "bg-accent" : "bg-edge")} />
            <span className="truncate">
              Bay {b.bay} <span className="text-mute">· {b.patient_id ? b.chief_complaint.toLowerCase() : "unidentified"}</span>
            </span>
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <>
          <div className="label px-5 pt-5 pb-1.5">Recent</div>
          <div className="grid min-h-0 gap-px overflow-y-auto px-2.5">
            {recent.map((c) => (
              <button
                key={c.id}
                onClick={() => onCase(c.id)}
                className={clsx(
                  "truncate rounded-[9px] px-2.5 py-2 text-left text-[14px] font-light hover:bg-line",
                  c.id === activeCaseId && "bg-raise shadow-[inset_0_0_0_1px_var(--line)]",
                )}
              >
                {c.title}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex-1" />
      <div className="relative flex items-center gap-2 border-t border-line py-2.5 pr-3.5 pl-2.5">
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-2.5 bottom-full left-2.5 z-20 mb-1.5 grid gap-px rounded-[12px] border border-line bg-raise p-1.5 shadow-[0_18px_40px_-20px_rgba(0,0,0,.35)]">
              <div className="label px-2.5 pt-1.5 pb-1">Use Healthline as</div>
              {ORDER.map((id) => {
                const p = PERSONAS[id];
                return (
                  <button
                    key={id}
                    onClick={() => {
                      onPersona(id);
                      setMenuOpen(false);
                    }}
                    className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left hover:bg-line"
                  >
                    <Avatar initials={p.initials} />
                    <span className="text-[14px] leading-tight font-normal">
                      {p.role}
                      <span className="block text-[12px] font-light text-mute">{p.name}</span>
                    </span>
                    {id === persona.id && <Check className="ml-auto size-4 text-accent" strokeWidth={1.8} />}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title="Switch persona"
          className={clsx("flex min-w-0 flex-1 items-center gap-2.5 rounded-[9px] px-2 py-1 text-left hover:bg-line", menuOpen && "bg-line")}
        >
          <Avatar initials={persona.initials} />
          <span className="min-w-0 text-[14px] leading-tight font-normal">
            <span className="block truncate">{persona.name}</span>
            <span className="block truncate text-[12px] font-light text-mute">{persona.where}</span>
          </span>
          <ChevronsUpDown className="ml-auto size-4 flex-none text-mute" strokeWidth={1.5} />
        </button>
        <button onClick={onTheme} title="Dark / light (d)" className="flex-none rounded-lg p-1.5 text-mute hover:bg-line hover:text-ink">
          {theme === "dark" ? <Sun className="size-[18px]" strokeWidth={1.5} /> : <Moon className="size-[18px]" strokeWidth={1.5} />}
        </button>
      </div>
    </aside>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="grid size-[30px] flex-none place-items-center rounded-full border border-edge font-mono text-[11px] tracking-[.04em]">{initials}</span>
  );
}

function NavButton({ children, icon, onClick, className }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <button onClick={onClick} className={clsx("flex items-center gap-3 rounded-[9px] px-2.5 py-[9px] text-[15px] font-normal hover:bg-line", className)}>
      {icon}
      {children}
    </button>
  );
}
