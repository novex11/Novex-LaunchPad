import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsShell } from "@/components/docs/docs-shell";
import { getDocPage, flatDocs } from "@/content/docs/registry";

interface Props {
  params: Promise<{ slug?: string[] }>;
}

export function generateStaticParams() {
  return flatDocs().map((p) => ({ slug: p.slug ? p.slug.split("/") : [] }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getDocPage((slug ?? []).join("/"));
  if (!page) return { title: "Docs — Compose" };
  return {
    title: page.slug ? `${page.title} — Compose Docs` : "Compose Documentation",
    description: page.description,
  };
}

export default async function DocsPage({ params }: Props) {
  const { slug } = await params;
  const page = getDocPage((slug ?? []).join("/"));
  if (!page) notFound();

  return (
    <DocsShell page={page}>
      {page.sections.map((s) => (
        <section key={s.id} className="docs-section">
          <h2 id={s.id} className="group scroll-mt-24">
            <a href={`#${s.id}`} className="no-underline">
              {s.title}
              <span className="ml-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">#</span>
            </a>
          </h2>
          {s.body}
        </section>
      ))}
    </DocsShell>
  );
}
