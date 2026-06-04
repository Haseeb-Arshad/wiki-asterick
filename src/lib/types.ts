export interface WikiSection {
  id: string;
  title: string;
  level: number;
  content: string;
  html: string;
  subsections: WikiSection[];
}

export interface WikiArticle {
  title: string;
  subtitle: string;
  description: string;
  imageUrl: string | null;
  imageCaption: string;
  sections: WikiSection[];
  footnotes: { id: string; text: string }[];
  infobox: { label: string; value: string }[];
  lastModified: string;
}

export interface Highlight {
  id: string;
  articleTitle: string;
  text: string;
  sectionId: string;
  sectionTitle: string;
  createdAt: number;
  color: string;
}

export type FlatSection = {
  id: string;
  title: string;
  level: number;
};

export function flattenSections(sections: WikiSection[]): FlatSection[] {
  const result: FlatSection[] = [];
  function walk(secs: WikiSection[]) {
    for (const s of secs) {
      result.push({ id: s.id, title: s.title, level: s.level });
      if (s.subsections.length > 0) walk(s.subsections);
    }
  }
  walk(sections);
  return result;
}