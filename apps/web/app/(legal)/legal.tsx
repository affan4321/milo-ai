import type { ReactNode } from "react";

export const CONTACT_EMAIL = "affan4321@gmail.com";
export const OPERATOR = "Muhammad Affan";
export const EFFECTIVE = "October 5, 2026";

/** A legal document: title, effective date, a contents list built from the sections, then the sections themselves. */
export function LegalDoc({ title, intro, sections }: { title: string; intro: ReactNode; sections: { id: string; title: string; body: ReactNode }[] }) {
  return (
    <article>
      <div className="eyebrow">Effective {EFFECTIVE}</div>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <div className="mt-5 space-y-4 text-base leading-relaxed text-muted">{intro}</div>
      <nav className="card mt-8 p-5" aria-label="Contents">
        <div className="eyebrow mb-3">Contents</div>
        <ol className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {sections.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="text-muted hover:text-accent-ink"><span className="mr-2 font-mono text-xs text-subtle">{String(i + 1).padStart(2, "0")}</span>{s.title}</a></li>)}
        </ol>
      </nav>
      <div className="mt-10 space-y-10">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-8">
            <h2 className="text-xl font-semibold tracking-tight"><span className="mr-2.5 font-mono text-sm font-normal text-subtle">{String(i + 1).padStart(2, "0")}</span>{s.title}</h2>
            <div className="mt-3 space-y-3 leading-relaxed text-muted [&_a]:font-medium [&_a]:text-accent-ink hover:[&_a]:underline [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-text [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">{s.body}</div>
          </section>
        ))}
      </div>
    </article>
  );
}

export const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
