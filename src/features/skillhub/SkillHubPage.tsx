import { useState } from "react";
import { Button, SectionTabs, type SectionTab } from "../../components/ui";
import { TextField } from "../../components/ui/forms";
import { PageRegion, PageShell } from "../../components/ui/PageShell";
import { useT } from "../../i18n/useLocale";
import type { MessageKey } from "../../i18n";
import { SKILL_SOURCE_IDS, SKILL_SOURCES, type SkillSourceId } from "./skillCatalog";
import {
  countSkillEntries,
  filterSkillGroups,
  type SkillKindFilter,
  type SkillSourceFilter,
} from "./skillhubFilter";

const KIND_FILTERS: readonly SkillKindFilter[] = ["all", "user", "model", "principle", "auto", "exp"];

const KIND_LABEL_KEYS: Record<SkillKindFilter, MessageKey> = {
  all: "skillhub.kind.all",
  user: "skillhub.kind.user",
  model: "skillhub.kind.model",
  principle: "skillhub.kind.principle",
  auto: "skillhub.kind.auto",
  exp: "skillhub.kind.exp",
};

export function SkillHubPage() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SkillSourceFilter>("all");
  const [kind, setKind] = useState<SkillKindFilter>("all");

  const groups = filterSkillGroups({ query, source, kind });
  const sourceTabs: readonly SectionTab[] = [
    { id: "all", label: t("skillhub.source.all") },
    ...SKILL_SOURCE_IDS.map((id) => ({ id, label: SKILL_SOURCES[id].name })),
  ];

  return (
    <PageShell layout="strip" scrollKey="skillhub">
      <PageRegion className="skillhub">
        <p className="text-meta text-muted-foreground">{t("skillhub.readonly")}</p>
        <SectionTabs
          label={t("skillhub.source.label")}
          sections={sourceTabs}
          selected={source}
          onSelect={(id) => setSource(id === "all" ? "all" : (id as SkillSourceId))}
        />
        {source === "all" ? null : <SourceNote source={source} />}
        <TextField
          type="search"
          value={query}
          onValueChange={setQuery}
          label={t("skillhub.search.label")}
          placeholder={t("skillhub.search.placeholder")}
        />
        <div role="group" aria-label={t("skillhub.kind.label")} className="flex flex-wrap gap-ui-8">
          {KIND_FILTERS.map((filter) => {
            const selected = filter === kind;
            return (
              <Button
                key={filter}
                variant={selected ? "secondary" : "ghost"}
                aria-pressed={selected}
                onClick={() => setKind(filter)}
              >
                {t(KIND_LABEL_KEYS[filter])}
              </Button>
            );
          })}
        </div>
        <p className="text-meta text-muted-foreground">
          {t("skillhub.count", { count: countSkillEntries(groups) })}
        </p>
        {groups.length === 0 ? (
          <p className="text-aux text-muted-foreground">{t("skillhub.empty")}</p>
        ) : (
          groups.map(({ group, entries }) => (
            <section key={group} className="flex flex-col gap-ui-4">
              <h2 className="text-aux font-semibold text-foreground">{group}</h2>
              <ul className="flex flex-col">
                {entries.map((entry) => (
                  <li
                    key={`${entry.source}:${entry.name}`}
                    className="flex flex-col gap-ui-4 border-b border-line py-ui-8"
                  >
                    <div className="flex flex-wrap items-baseline gap-ui-8">
                      <code className="font-mono text-aux font-medium text-foreground">{entry.name}</code>
                      <span className="text-meta text-muted-foreground">{SKILL_SOURCES[entry.source].name}</span>
                      {entry.kind ? (
                        <span className="text-meta text-accent-text">{t(KIND_LABEL_KEYS[entry.kind])}</span>
                      ) : null}
                    </div>
                    <p className="text-aux text-muted-foreground">{entry.usage}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </PageRegion>
    </PageShell>
  );
}

function SourceNote({ source }: { source: SkillSourceId }) {
  const t = useT();
  const meta = SKILL_SOURCES[source];
  return (
    <div className="flex flex-col gap-ui-4 text-meta text-muted-foreground">
      <p>
        {t("skillhub.source.focus")}：{meta.focus}
      </p>
      <p>
        {t("skillhub.source.entry")}：{meta.entry}
      </p>
    </div>
  );
}
