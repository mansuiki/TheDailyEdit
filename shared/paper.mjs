export const PAPER_SECTIONS = [
  {
    id: 'technology',
    label: 'Technology',
    letter: 'B',
    desk: 'news',
    description: 'Tools, research and the people building what comes next.',
  },
  {
    id: 'world',
    label: 'World',
    letter: 'C',
    desk: 'news',
    description: 'The wider world, with context and a clear trail to the source.',
  },
  {
    id: 'business',
    label: 'Business',
    letter: 'D',
    desk: 'news',
    description: 'Companies, economies and the changing world of work.',
  },
  {
    id: 'science',
    label: 'Science',
    letter: 'E',
    desk: 'news',
    description: 'Discovery, climate and the questions worth following.',
  },
  {
    id: 'culture',
    label: 'Culture',
    letter: 'F',
    desk: 'news',
    description: 'Arts, ideas and life beyond the headlines.',
  },
  {
    id: 'inbox',
    label: 'Your Inbox',
    letter: 'G',
    desk: 'personal',
    description: 'Correspondence and reading selected from your connected inbox.',
  },
  {
    id: 'calendar',
    label: 'Your Week',
    letter: 'H',
    desk: 'personal',
    description: 'A personal diary of the days ahead.',
  },
  {
    id: 'markets',
    label: 'Markets',
    letter: 'I',
    desk: 'markets',
    description: 'The watchlist, in numbers and perspective.',
  },
];
export const DEFAULT_PAPER = {
  depth: 'standard',
  sections: {
    technology: 2,
    world: 2,
    business: 1,
    science: 1,
    culture: 0,
    inbox: 1,
    calendar: 1,
    markets: 1,
  },
};
// New readers start small and explicitly opt into personal-source pages later.
export const STARTER_PAPER = {
  depth: 'standard',
  sections: Object.fromEntries(
    PAPER_SECTIONS.map((s) => [s.id, ['technology', 'world'].includes(s.id) ? 1 : 0]),
  ),
};
export const sectionCatalog = (paper = DEFAULT_PAPER) => [
  ...PAPER_SECTIONS,
  ...(paper.customSections || []).map((s, i) => ({
    ...s,
    letter: String.fromCharCode(74 + i),
    desk: 'news',
  })),
];
export const paperSection = (id, paper) => sectionCatalog(paper).find((s) => s.id === id);
export function sectionOf(item) {
  if (item.sectionId) return item.sectionId;
  if (item.desk === 'markets' || item.source === 'markets') return 'markets';
  if (['applecalendar', 'googlecalendar'].includes(item.source)) return 'calendar';
  if (item.desk === 'personal' || item.source === 'gmail') return 'inbox';
  if (item.source === 'google') return 'world';
  return 'technology';
}
export function pageCount(paper = DEFAULT_PAPER) {
  return 1 + Object.values(paper.sections).reduce((a, n) => a + n, 0);
}
export function buildAssignments(desk, evidence, paper = DEFAULT_PAPER) {
  const jobs = [];
  for (const section of sectionCatalog(paper).filter(
    (s) => s.desk === desk && paper.sections[s.id] > 0,
  )) {
    const items = evidence.filter((e) => sectionOf(e) === section.id);
    if (!items.length) continue;
    const pages = paper.sections[section.id];
    // Each reporter sees every collected source assigned to its page. Disjoint
    // source partitions keep reporters from independently duplicating a story.
    const count = Math.min(pages, Math.max(1, Math.ceil(items.length / 3)));
    const groups = Array.from({ length: count }, () => []);
    items.forEach((e, i) => groups[i % count].push(e));
    groups.forEach((sources, i) =>
      jobs.push({
        id: `${section.id}-${i + 1}`,
        sectionId: section.id,
        sectionTitle: section.label,
        page: i + 1,
        targetArticles: Math.min(3, sources.length),
        depth: paper.depth,
        editorialDirection: section.direction || '',
        evidence: sources,
      }),
    );
  }
  return jobs;
}
export function assemblePages(state) {
  if (state.archived && state.pages) return state.pages;
  const paper = state.preferences.paper || DEFAULT_PAPER;
  const all = Object.values(state.sections).flatMap((s) => s.articles);
  const evidence = Object.values(state.sections).flatMap((s) => s.evidence);
  const pages = [
    {
      id: 'front',
      sectionId: 'front',
      label: 'Front Page',
      folio: 'A1',
      number: 1,
      articles: all,
      evidence: [],
    },
  ];
  const order = state.issue?.identity?.sectionOrder || sectionCatalog(paper).map((s) => s.id);
  for (const section of sectionCatalog(paper).sort(
    (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
  )) {
    const budget = paper.sections[section.id] || 0;
    if (!budget) continue;
    const articles = all.filter((a) => sectionOf(a) === section.id);
    const sources = evidence.filter((e) => sectionOf(e) === section.id);
    const count = Math.max(budget, Math.ceil(articles.length / 3));
    for (let n = 0; n < count; n++) {
      const assigned = articles.filter((a) => a.pageInSection === n + 1);
      const withoutPage = articles.filter((a) => !a.pageInSection).slice(n * 3, n * 3 + 3);
      const pageArticles = assigned.length ? assigned : withoutPage;
      pages.push({
        id: `${section.id}-${n + 1}`,
        sectionId: section.id,
        label: section.label,
        description: section.description,
        folio: `${section.letter}${n + 1}`,
        number: pages.length + 1,
        articles: pageArticles,
        evidence: sources.filter((_, i) => i % count === n),
        desk: section.desk,
        status: state.sections[section.desk].status,
        error: state.sections[section.desk].pageErrors
          ? state.sections[section.desk].pageErrors[`${section.id}-${n + 1}`] || null
          : pageArticles.length
            ? null
            : state.sections[section.desk].error,
      });
    }
  }
  return pages;
}
const stop = new Set(
  'the a an and or to of in on with for from as at by is are was be has have this that its it your you their our new news today says said more after before about into over through release released launches launch ai'.split(
    ' ',
  ),
);
function tokens(item) {
  return new Set(
    `${item.title || ''}`
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9.+-]{2,}/g)
      ?.filter((w) => !stop.has(w)) || [],
  );
}
export function relatedItems(article, articles, evidence) {
  const terms = tokens(article),
    ids = new Set(article.evidenceIds || []);
  const privateArticle = article.desk === 'personal';
  const score = (item) => [...tokens(item)].filter((t) => terms.has(t)).length;
  const related = articles
    .filter((a) => a.id !== article.id && (privateArticle || a.desk !== 'personal'))
    .map((a) => ({
      article: a,
      score: score(a),
      shared: (a.evidenceIds || []).some((id) => ids.has(id)),
    }))
    .filter((a) => a.shared || a.score >= 2)
    .sort((a, b) => Number(b.shared) - Number(a.shared) || b.score - a.score)
    .slice(0, 3)
    .map(({ article: a, shared }) => ({
      article: a,
      reason: shared ? 'Shared reporting sources' : 'Related subjects',
    }));
  const more = articles
    .filter(
      (a) =>
        a.id !== article.id &&
        (privateArticle || a.desk !== 'personal') &&
        sectionOf(a) === sectionOf(article) &&
        !related.some((r) => r.article.id === a.id),
    )
    .slice(0, Math.max(0, 3 - related.length))
    .map((a) => ({
      article: a,
      reason: `More from ${paperSection(sectionOf(a))?.label || a.sectionTitle || 'this section'}`,
    }));
  const sources = evidence
    .filter((e) => !ids.has(e.id) && (privateArticle || e.visibility !== 'private'))
    .map((e) => ({ e, score: score(e) }))
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => r.e);
  return { articles: [...related, ...more], sources };
}
