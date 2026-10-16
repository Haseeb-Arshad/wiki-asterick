/** Data contracts shared by the API server and the React client. */

export interface WikiSection {
  /** Anchor id from the source article. The lead section uses "lead". */
  id: string;
  /** Empty for the lead section. */
  title: string;
  level: number;
  html: string;
  subsections: WikiSection[];
}

export interface Footnote {
  id: string;
  label: string;
  text: string;
  url: string | null;
}

export interface InfoboxRow {
  label: string;
  value: string;
}

export interface MediaSource {
  src: string;
  type: string;
}

export interface MediaItem {
  id: string;
  type: "image" | "video" | "audio";
  /** File page name, e.g. "File:Moon.jpg". */
  file: string;
  caption: string;
  /** Large rendition (image) or poster-sized preview (video). */
  src: string;
  thumb: string;
  width: number;
  height: number;
  poster: string | null;
  sources: MediaSource[];
  durationSeconds: number | null;
  sectionId: string;
  filePage: string;
}

export interface LanguageLink {
  lang: string;
  title: string;
  autonym: string;
}

export interface ExternalLink {
  label: string;
  url: string;
}

export interface WikiImage {
  src: string;
  width: number;
  height: number;
}

export interface WikiArticle {
  /** "web" for pages opened from a shared link; wiki articles omit it. */
  kind?: "wiki" | "web";
  /** A Wikimedia host, or "web:<hostname>" for web pages. */
  wiki: string;
  title: string;
  description: string;
  extract: string;
  lang: string;
  dir: "ltr" | "rtl";
  image: WikiImage | null;
  sections: WikiSection[];
  footnotes: Footnote[];
  infobox: InfoboxRow[];
  media: MediaItem[];
  languages: LanguageLink[];
  externalLinks: ExternalLink[];
  wordCount: number;
  readingMinutes: number;
  lastEdited: string | null;
  revisionId: number;
  sourceUrl: string;
  /** Web pages: publication name and author. */
  site?: string;
  byline?: string;
}

export interface ArticleSummary {
  wiki: string;
  title: string;
  description: string;
  extract: string;
  thumbnail: string | null;
  image: WikiImage | null;
  lang: string;
  dir: "ltr" | "rtl";
}

export interface SearchHit {
  title: string;
  description: string;
  excerpt: string;
  thumbnail: string | null;
}

export interface TrendingArticle extends ArticleSummary {
  rank: number;
  views: number;
  trend: number[];
}

export interface PictureOfTheDay {
  title: string;
  description: string;
  credit: string;
  src: string;
  thumb: string;
  width: number;
  height: number;
  filePage: string;
}

export interface NewsStory {
  story: string;
  links: ArticleSummary[];
}

export interface OnThisDayEvent {
  year: number;
  text: string;
  pages: ArticleSummary[];
}

export interface WikiFeed {
  wiki: string;
  date: string;
  featured: ArticleSummary | null;
  mostRead: TrendingArticle[];
  picture: PictureOfTheDay | null;
  news: NewsStory[];
  onThisDay: OnThisDayEvent[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

export interface ArticleRef {
  wiki: string;
  title: string;
  description: string;
  thumbnail: string | null;
  /** Original address, for web pages (wiki "web:<host>"). */
  url?: string | null;
}

export interface Bookmark extends ArticleRef {
  createdAt: number;
}

export interface HistoryEntry extends ArticleRef {
  progress: number;
  sectionId: string | null;
  readAt: number;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export interface Highlight {
  id: string;
  wiki: string;
  articleTitle: string;
  url?: string | null;
  sectionId: string;
  sectionTitle: string;
  text: string;
  /** A few characters before and after the quote, used to find it again. */
  prefix: string;
  suffix: string;
  note: string;
  color: HighlightColor;
  createdAt: number;
  updatedAt: number;
}

export interface AiNoteSource {
  n: number;
  kind: "article" | "web";
  title: string;
  url: string;
  site: string;
  date: string | null;
  favicon: string | null;
  /** Article passages: the section of the page this source is, so a citation can jump to it. */
  sectionId?: string;
}

/** A question asked of the AI and its answer, kept with the page it was asked on. */
export interface AiNote {
  id: string;
  /** Page the question was asked on; "general" when it was asked outside an article. */
  wiki: string;
  articleTitle: string;
  url?: string | null;
  question: string;
  /** The highlighted passage the question was about, if any. */
  quote: string;
  quotePrefix: string;
  quoteSuffix: string;
  sectionId: string;
  answer: string;
  sources: AiNoteSource[];
  model: string;
  mode: "quick" | "deep";
  web: boolean;
  createdAt: number;
}

export interface LibrarySnapshot {
  bookmarks: Bookmark[];
  highlights: Highlight[];
  history: HistoryEntry[];
  notes: AiNote[];
}

export interface ApiError {
  error: string;
  code?: string;
}
