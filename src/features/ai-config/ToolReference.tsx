import { useCallback, useEffect, useState } from "react";
import { Button, Panel, StatusBadge } from "../../components/ui";
import { CheckboxField, SelectField, TextField } from "../../components/ui/forms";
import type { AiToolId } from "../../ipc/aiConfig";
import {
  getToolReference,
  type ReferenceListing,
  type ReferenceResource,
  type ReferenceSetting,
  type ToolReference as ToolReferenceData,
} from "../../ipc/aiConfigReference";
import { decodeAppError, type AppError } from "../../ipc/core";
import type { Locale } from "../../i18n";
import { localizeErrorMessage } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
import { definitionDescription } from "./aiConfigModel";
import { HighlightText } from "./ConfigSearchControls";
import { configSearchItem, matchesSearch, searchTerms } from "./configSearch";
import { publishToolSearchItems } from "./configSearchStore";
import {
  COVERAGE_LABELS,
  COVERAGE_TONES,
  LAYER_LABELS,
  REFERENCE_BANNER_KEY,
  REFERENCE_PAGE_SIZE,
  RISK_LABELS,
  VALUE_TYPE_FILTER_OPTIONS,
  VALUE_TYPE_LABELS,
  filterSettings,
  formatVersionNote,
  listingStatusText,
  nextShownCount,
  visiblePage,
  type ValueTypeFilter,
} from "./toolReferenceModel";

export type ToolReferenceState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly reference: ToolReferenceData }
  | { readonly status: "failed"; readonly error: AppError };

export interface ToolReferenceProps {
  readonly toolId: AiToolId;
  /** The page-wide search term; only settings matching it are listed. */
  readonly query?: string;
}

function localizedSetting(setting: ReferenceSetting, locale: Locale): ReferenceSetting {
  return {
    ...setting,
    description: definitionDescription(setting.keyPath, setting.description, locale),
  };
}

/** Callers key this by tool id, so each tool starts from a fresh, unfiltered list. */
export function ToolReference({ toolId, query = "" }: ToolReferenceProps) {
  const [state, setState] = useState<ToolReferenceState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const locale = useLocale();

  useEffect(() => {
    let current = true;
    getToolReference(toolId).then(
      (reference) => {
        if (current) setState({ status: "ready", reference });
      },
      (error: unknown) => {
        if (current) setState({ status: "failed", error: decodeAppError(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [toolId, attempt]);

  useEffect(() => {
    if (state.status !== "ready") return;
    publishToolSearchItems(
      toolId,
      state.reference.settings.map((setting) =>
        configSearchItem(localizedSetting(setting, locale)),
      ),
    );
  }, [state, toolId, locale]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  return <ToolReferenceView state={state} onRetry={retry} query={query} />;
}

export function ToolReferenceView({
  state,
  onRetry,
  query = "",
}: {
  readonly state: ToolReferenceState;
  readonly onRetry: () => void;
  readonly query?: string;
}) {
  const t = useT();
  if (state.status === "loading") {
    return (
      <p role="status" className="m-0 text-body text-muted-foreground">
        {t("aiConfig.ref.loading")}
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <Panel role="alert" className="grid justify-items-start gap-ui-8 p-ui-12">
        <p className="m-0 text-body font-semibold text-danger">{t("aiConfig.ref.failed")}</p>
        <p className="m-0 text-body">{localizeErrorMessage(state.error, t)}</p>
        <Button onClick={onRetry}>{t("common.retry")}</Button>
      </Panel>
    );
  }
  return <ReferenceContent reference={state.reference} query={query} />;
}

function ReferenceContent({
  reference,
  query,
}: {
  readonly reference: ToolReferenceData;
  readonly query: string;
}) {
  const t = useT();
  const locale = useLocale();
  const settings = reference.settings.map((setting) => localizedSetting(setting, locale));
  return (
    <section
      aria-label={t("aiConfig.ref.regionLabel", { name: reference.displayName })}
      className="grid min-w-0 content-start gap-ui-12"
    >
      <Panel className="grid gap-ui-8 p-ui-12">
        <h3 className="m-0 text-group font-semibold">{t("aiConfig.ref.heading")}</h3>
        <p role="note" className="m-0 text-body font-semibold">
          {t(REFERENCE_BANNER_KEY)}
        </p>
        <p className="m-0 text-aux text-muted-foreground">
          {t("aiConfig.ref.sourceLabel")}
          <span className="break-all font-mono">{reference.source.url}</span>
          {t("aiConfig.ref.sourceNote", { note: formatVersionNote(reference, t) })}
        </p>
      </Panel>

      {reference.notices.length > 0 ? (
        <ul aria-label={t("aiConfig.ref.noticeLabel")} className="m-0 grid list-none gap-ui-8 p-0">
          {reference.notices.map((notice) => (
            <li
              key={notice}
              className="grid gap-ui-8 rounded-control border border-warning-border bg-warning-soft p-ui-12 text-body text-warning-text"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
                <span aria-hidden="true" className="font-semibold">
                  ⚠
                </span>
                <StatusBadge tone="warning">{t("aiConfig.ref.noticeBadge")}</StatusBadge>
              </div>
              <p className="m-0">{notice}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <ResourceList resources={reference.resources} />
      <CoverageSummary flags={reference.flagsCoverage} env={reference.envCoverage} />
      <SettingsList settings={settings} query={query} />
    </section>
  );
}

function ResourceList({ resources }: { readonly resources: readonly ReferenceResource[] }) {
  const t = useT();
  return (
    <section aria-labelledby="ai-reference-resources" className="grid min-w-0 gap-ui-8">
      <h3 id="ai-reference-resources" className="m-0 text-body font-semibold">
        {t("aiConfig.ref.resourcesHeading", { count: resources.length })}
      </h3>
      <ul aria-label={t("aiConfig.ref.resourcesLabel")} className="m-0 grid list-none gap-ui-8 p-0">
        {resources.map((resource) => (
          <li key={resource.id} className="grid min-w-0 gap-ui-4 border-t border-border pt-ui-8">
            <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
              <code className="break-all text-aux font-semibold">{resource.id}</code>
              <StatusBadge tone={COVERAGE_TONES[resource.coverage]}>
                {t(COVERAGE_LABELS[resource.coverage])}
              </StatusBadge>
              {resource.metadataOnly ? (
                <StatusBadge tone="neutral">{t("aiConfig.ref.metadataOnly")}</StatusBadge>
              ) : null}
            </div>
            <p className="m-0 break-all text-aux text-muted-foreground">
              {t(LAYER_LABELS[resource.layer])} · {resource.format} ·{" "}
              <code className="font-mono">{resource.location}</code>
            </p>
            <p className="m-0 text-aux">
              {resource.description}
              {resource.descriptionTruncated ? t("aiConfig.ref.descriptionTruncated") : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CoverageSummary({
  flags,
  env,
}: {
  readonly flags: ReferenceListing;
  readonly env: ReferenceListing;
}) {
  const t = useT();
  return (
    <section aria-labelledby="ai-reference-coverage" className="grid min-w-0 gap-ui-4">
      <h3 id="ai-reference-coverage" className="m-0 text-body font-semibold">
        {t("aiConfig.ref.coverageHeading")}
      </h3>
      <ListingLine label={t("aiConfig.ref.flags")} listing={flags} />
      <ListingLine label={t("aiConfig.ref.env")} listing={env} />
    </section>
  );
}

function ListingLine({ label, listing }: { readonly label: string; readonly listing: ReferenceListing }) {
  const t = useT();
  return (
    <p className="m-0 break-words text-aux">
      {t("aiConfig.ref.listingLine", { label, status: listingStatusText(listing.snapshotComplete, t) })}
      {listing.coverageNote ? t("aiConfig.ref.listingNote", { note: listing.coverageNote }) : ""}
      {listing.coverageNoteTruncated ? t("aiConfig.ref.coverageNoteTruncated") : ""}
      <span className="text-muted-foreground">
        {" "}
        {t("aiConfig.ref.sourceLabel")}
        <span className="break-all font-mono">{listing.sourceUrl}</span>
      </span>
    </p>
  );
}

function SettingsList({
  settings,
  query: searchQuery,
}: {
  readonly settings: readonly ReferenceSetting[];
  readonly query: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [valueType, setValueType] = useState<ValueTypeFilter>("all");
  const [riskOnly, setRiskOnly] = useState(false);
  const [shown, setShown] = useState(REFERENCE_PAGE_SIZE);

  const terms = searchTerms(searchQuery);
  const scoped = settings.filter((setting) => matchesSearch(configSearchItem(setting), terms));
  const filtered = filterSettings(scoped, { query, valueType, riskOnly });
  const page = visiblePage(filtered, shown);

  return (
    <section aria-labelledby="ai-reference-settings" className="grid min-w-0 gap-ui-8">
      <h3 id="ai-reference-settings" className="m-0 text-body font-semibold">
        {t("aiConfig.ref.settingsHeading", { shown: filtered.length, total: settings.length })}
      </h3>
      <div className="flex min-w-0 flex-wrap items-end gap-ui-8">
        <TextField
          label={t("aiConfig.ref.searchLabel")}
          className="min-w-0 flex-1"
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            setShown(REFERENCE_PAGE_SIZE);
          }}
        />
        <SelectField<ValueTypeFilter>
          label={t("aiConfig.ref.typeLabel")}
          value={valueType}
          options={VALUE_TYPE_FILTER_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          onValueChange={(next) => {
            setValueType(next);
            setShown(REFERENCE_PAGE_SIZE);
          }}
        />
        <CheckboxField
          label={t("aiConfig.ref.riskOnlyLabel")}
          checked={riskOnly}
          onCheckedChange={(next) => {
            setRiskOnly(next);
            setShown(REFERENCE_PAGE_SIZE);
          }}
        />
      </div>

      {filtered.length === 0 ? (
        <p role="status" className="m-0 text-aux text-muted-foreground">
          {t("aiConfig.ref.noMatchingKeys")}
        </p>
      ) : (
        <ul aria-label={t("aiConfig.ref.settingsListLabel")} className="m-0 grid list-none gap-ui-8 p-0">
          {page.visible.map((setting) => (
            <SettingRow key={setting.id} setting={setting} terms={terms} />
          ))}
        </ul>
      )}

      {page.hasMore ? (
        <div>
          <Button variant="secondary" onClick={() => setShown(nextShownCount(shown, filtered.length))}>
            {t("aiConfig.ref.showMore", { count: page.remaining })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function SettingRow({
  setting,
  terms,
}: {
  readonly setting: ReferenceSetting;
  readonly terms: readonly string[];
}) {
  const t = useT();
  return (
    <li className="grid min-w-0 gap-ui-4 border-t border-border pt-ui-8">
      <div className="flex min-w-0 flex-wrap items-center gap-ui-8">
        <code className="break-all text-aux font-semibold">
          <HighlightText text={setting.keyPath} terms={terms} />
        </code>
        <StatusBadge tone="neutral">{t(VALUE_TYPE_LABELS[setting.valueType])}</StatusBadge>
        {setting.risks.map((risk) => (
          <StatusBadge key={risk} tone="warning">
            {t(RISK_LABELS[risk])}
          </StatusBadge>
        ))}
        {setting.secret ? <StatusBadge tone="danger">{t("aiConfig.ref.secret")}</StatusBadge> : null}
      </div>
      <p className="m-0 text-aux">
        <HighlightText text={setting.description} terms={terms} />
        {setting.descriptionTruncated ? t("aiConfig.ref.descriptionTruncated") : ""}
      </p>
      <p className="m-0 break-words text-aux text-muted-foreground">
        {t("aiConfig.ref.defaultNote", { value: setting.defaultNote })}
        {setting.defaultNoteTruncated ? t("aiConfig.ref.defaultNoteTruncated") : ""}
      </p>
      {setting.valueType === "enum" ? (
        <p className="m-0 break-words text-aux text-muted-foreground">
          {t("aiConfig.ref.allowedValues")}
          <HighlightText
            text={setting.allowedValues.join(t("aiConfig.listSeparator"))}
            terms={terms}
          />
        </p>
      ) : null}
      <p className="m-0 text-aux text-muted-foreground">
        {t("aiConfig.ref.coverage", { status: t(COVERAGE_LABELS[setting.coverage]) })}
      </p>
    </li>
  );
}
