import type { WikiArticle, WikiSection } from "../lib/types";

interface ArticleContentProps {
  article: WikiArticle;
}

function SectionHeading({ level, id, title }: { level: number; id: string; title: string }) {
  if (level <= 2) return <h2 id={id}>{title}</h2>;
  if (level === 3) return <h3 id={id}>{title}</h3>;
  if (level === 4) return <h4 id={id}>{title}</h4>;
  return <h4 id={id}>{title}</h4>;
}

function SectionBlock({ section, depth = 0 }: { section: WikiSection; depth?: number }) {
  return (
    <div id={section.id}>
      <SectionHeading level={section.level} id={section.id} title={section.title} />
      {section.html && (
        <div
          className="article-content"
          dangerouslySetInnerHTML={{ __html: section.html }}
        />
      )}
      {section.subsections.map((sub) => (
        <SectionBlock key={sub.id} section={sub} depth={depth + 1} />
      ))}
    </div>
  );
}

export function ArticleContent({ article }: ArticleContentProps) {
  const skipSections = new Set(["See also", "Notes", "Citations", "References", "Bibliography", "External links", "Further reading"]);

  return (
    <div className="article-content">
      {article.sections
        .filter((s) => !skipSections.has(s.title) || s.title === "See also")
        .map((section) => (
          <SectionBlock key={section.id} section={section} />
        ))}

      {article.footnotes.length > 0 && (
        <div className="mt-16 pt-10 border-t border-border">
          <h3 className="font-sans text-[11px] uppercase tracking-[0.15em] text-ink-faint font-semibold mb-6">
            References
          </h3>
          <ol className="space-y-2 text-[12px] font-serif text-ink-muted leading-relaxed">
            {article.footnotes.slice(0, 30).map((fn, i) => (
              <li key={fn.id || i} id={fn.id} className="pl-5 -indent-5">
                <span className="font-sans text-accent font-medium text-[11px]">{i + 1}.</span>{" "}
                {fn.text.length > 280 ? fn.text.slice(0, 280) + "..." : fn.text}
              </li>
            ))}
          </ol>
          {article.footnotes.length > 30 && (
            <p className="text-ink-faint text-[11px] font-sans mt-4 italic">
              {article.footnotes.length - 30} more references available in the References sidebar tab
            </p>
          )}
        </div>
      )}

      <div className="mt-16 pt-8 border-t border-border text-center">
        <AsteriskMarkSection />
        <p className="text-ink-faint text-[11px] font-sans mt-4">
          Content sourced from Wikipedia and available under{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-dark transition-colors"
          >
            CC BY-SA 4.0
          </a>
        </p>
      </div>
    </div>
  );
}

function AsteriskMarkSection() {
  return (
    <div className="mb-2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 95.76 95.28"
        width="24"
        height="24"
        className="text-accent/30 mx-auto"
      >
        <path
          fill="currentColor"
          d="M56.08,34.45c1.86-.84,3.59-1.99,5.44-2.88,3.31-1.57,14.18-6.07,17.6-7.27,1.85-.65,7.87.04,9.6.93,1.22.63,1.65,1.29,1.39,2.65-1.12,5.93-12.76,11.86-17.86,14.17-3.24,1.46-6.7,2.56-9.86,4.21l4.62,3.32c5.21,3.05,11.08,11.97,15.79,15.71,1.99,1.58,4.52,4.43,4.96,6.93.04.24,0,.96-.06,1.21-.09.33-1.68,2.8-1.96,3.1-.88.94-1.68,1.08-2.91,1.12-3.78.12-7.28-1.79-10.47-3.59-6.42-3.63-12.59-12.88-18.85-16.86l-.59-.06-.68,5.11c-1.2,6.2-3.39,12.08-5.23,18.1-.83,2.72-1.45,7.3-4.01,9.06-.3.2-.6.13-.84.29-.29.21-.37.72-.85.99-1.23.72-3.85,1.21-4.93.02s-1.53-2.57-1.6-4.13c-.04-1.13.52-2.75.48-3.62-.07-2.07-.25-3.27.04-5.45.97-7.21,3.93-14.27,5-21.48-1.77.55-3.52,1.23-5.25,1.93-4.2,1.7-14.65,5.45-18.9,7.04-3.33,1.25-6.47,2.96-9.8.89-1.04-.65-1.34-1.18-1.66-2.37-.41-1.52.37-2.39,1.34-3.52,3.55-4.21,13.19-8.33,17.97-11.01,3.01-1.69,6.12-3.24,9.31-4.59-.05-.27-.18-.37-.39-.53-1.47-1.06-3.5-1.72-5.06-2.81-2.82-1.96-11.01-7.4-13.77-9.22-3.05-1.99-8.9-9.34-7.36-13.08.17-.41.57-.5.73-.78s.05-.7.19-1.02c.62-1.57,2.27-1.8,3.71-1.26.34.13.62.44.98.59,8.17,3.43,20.97,12.8,28.57,17.27.23.13,1.34.77,1.49.66l1.44-9.36c1.55-5.15,1.24-11.08,4.52-15.54,1.57-2.13,2.86-3.67,5.73-3.17,1.87.32,2.57,1.03,3.3,2.76,1.73,4.07.23,8.64-.21,12.79-.24,2.28-.17,4.65-.41,6.95-.19,1.94-.67,3.84-.71,5.78h0Z"
        />
      </svg>
    </div>
  );
}