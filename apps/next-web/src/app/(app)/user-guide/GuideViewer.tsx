'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function GuideViewer({ markdown }: { markdown: string }) {
  return (
    <article className="markdown-body max-w-3xl space-y-4 text-sm text-foreground/90">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-8 mb-3 text-2xl font-bold tracking-tight" {...p} />,
          h2: (p) => <h2 className="mt-8 mb-2 border-b border-border pb-1 text-xl font-semibold" {...p} />,
          h3: (p) => <h3 className="mt-6 mb-2 text-base font-semibold" {...p} />,
          p:  (p) => <p className="leading-relaxed" {...p} />,
          ul: (p) => <ul className="list-disc ps-6 space-y-1" {...p} />,
          ol: (p) => <ol className="list-decimal ps-6 space-y-1" {...p} />,
          li: (p) => <li className="leading-relaxed" {...p} />,
          a:  ({ href, ...rest }) => (
            <a
              href={href}
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="text-primary underline underline-offset-2 hover:opacity-80"
              {...rest}
            />
          ),
          code: ({ className, children, ...rest }) => {
            // Block code arrives wrapped in <pre> with a className like
            // `language-foo`; inline code has no className.
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            return <code className={className} {...rest}>{children}</code>;
          },
          pre: (p) => (
            <pre
              className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs font-mono"
              {...p}
            />
          ),
          blockquote: (p) => (
            <blockquote
              className="border-l-4 border-primary/40 bg-muted/30 px-3 py-2 italic text-muted-foreground"
              {...p}
            />
          ),
          hr: () => <hr className="my-8 border-border" />,
          table: (p) => (
            <div className="my-3 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground" {...p} />,
          th: (p) => <th className="px-3 py-2 text-start font-medium" {...p} />,
          td: (p) => <td className="border-t border-border px-3 py-2 align-top" {...p} />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
