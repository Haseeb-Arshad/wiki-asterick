import type { WikiSection } from "../../../shared/types";

export interface OutlineEntry {
  id: string;
  title: string;
  level: number;
  html: string;
}

/** Sections in reading order, flattened (each entry renders only its own HTML). */
export function flattenSections(sections: WikiSection[]): OutlineEntry[] {
  const result: OutlineEntry[] = [];
  const walk = (list: WikiSection[]) => {
    for (const section of list) {
      result.push({ id: section.id, title: section.title, level: section.level, html: section.html });
      walk(section.subsections);
    }
  };
  walk(sections);
  return result;
}

export function scrollToSection(id: string, behavior: ScrollBehavior = "smooth") {
  const element = document.getElementById(id);
  if (!element) return false;
  element.scrollIntoView({ behavior, block: "start" });
  return true;
}
