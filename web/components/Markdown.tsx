"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="grid gap-3 text-[16.5px] leading-[1.6] [&_strong]:font-medium [&_strong]:text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="hairline grid border-y border-line">{children}</ul>,
          ol: ({ children }) => <ol className="hairline grid border-y border-line">{children}</ol>,
          li: ({ children }) => <li className="py-2.5 text-[15px] leading-normal text-ink/85">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-1 underline-offset-4">
              {children}
            </a>
          ),
          code: ({ children }) => <code className="rounded bg-bubble px-1.5 py-0.5 font-mono text-[13px]">{children}</code>,
          table: ({ children }) => <table className="w-full text-left text-[14px]">{children}</table>,
          th: ({ children }) => <th className="label border-b border-line py-2 pr-4 font-normal">{children}</th>,
          td: ({ children }) => <td className="border-b border-line py-2 pr-4">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
      {streaming && <span className="-mt-2 inline-block h-[1.1em] w-[2px] animate-[caret_1s_steps(1)_infinite] bg-accent align-middle" />}
    </div>
  );
}
