"use client";

import { ArrowUp, Camera, Mic, Plus, Square } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import clsx from "clsx";

export type ComposerHandle = { focus: () => void; fill: (text: string) => void };

type Props = {
  placeholder: string;
  onSend: (text: string) => void;
  onStop?: () => void;
  busy?: boolean;
  large?: boolean;
  compact?: boolean;
};

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ placeholder, onSend, onStop, busy, large, compact }, ref) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    fill: (value: string) => {
      setText(value);
      requestAnimationFrame(() => {
        resize();
        area.current?.focus();
      });
    },
  }));

  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText("");
    requestAnimationFrame(resize);
  };

  const ready = text.trim().length > 0 && !busy;

  return (
    <div
      className={clsx(
        "group relative border border-line bg-raise transition-[border-color,box-shadow] duration-300",
        compact ? "flex items-end gap-2 rounded-[16px] py-2 pr-2 pl-4" : "rounded-[22px] px-5 pt-4 pb-3",
        "shadow-[0_1px_0_rgba(0,0,0,.02),0_12px_32px_-18px_rgba(0,0,0,.18)]",
        "focus-within:border-edge focus-within:shadow-[0_0_0_4px_var(--accent-soft),0_18px_40px_-20px_rgba(0,0,0,.25)]",
      )}
    >
      <textarea
        ref={area}
        value={text}
        rows={large ? 2 : 1}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          resize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        className={clsx(
          "block w-full resize-none bg-transparent leading-[1.45] font-light text-ink outline-none placeholder:text-mute",
          compact ? "min-h-[24px] py-1 text-[15px]" : "text-[17px]",
          !compact && (large ? "min-h-[52px]" : "min-h-[26px]"),
        )}
      />
      <div className={clsx("flex items-center gap-1 text-ink", !compact && "mt-1.5")}>
        {!compact && (
          <>
            <IconButton title="Attach (coming soon)">
              <Plus className="size-[18px]" strokeWidth={1.5} />
            </IconButton>
            <IconButton title="Photo of belongings (coming soon)">
              <Camera className="size-[18px]" strokeWidth={1.5} />
            </IconButton>
            <span className="flex-1" />
            <IconButton title="Dictate (coming soon)">
              <Mic className="size-[18px]" strokeWidth={1.5} />
            </IconButton>
          </>
        )}
        {busy ? (
          <button
            onClick={onStop}
            title="Stop"
            className="ml-1.5 grid size-[34px] place-items-center rounded-[11px] bg-ink text-paper transition-transform active:scale-95"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!ready}
            title="Send (Enter)"
            className={clsx(
              "ml-1.5 grid size-[34px] place-items-center rounded-[11px] bg-accent text-white transition-all duration-200 active:scale-95",
              ready ? "opacity-100 shadow-[0_6px_16px_-6px_var(--accent)]" : "opacity-35",
            )}
          >
            <ArrowUp className="size-[18px]" strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
});

function IconButton({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} className="rounded-[9px] p-2 text-ink/80 transition-colors hover:bg-line hover:text-ink">
      {children}
    </button>
  );
}
