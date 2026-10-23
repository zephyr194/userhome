import { useEffect, useState } from "react";
import { localizeError } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
import {
  ActionRow,
  Button,
  Panel,
  PasteButton,
  SelectField,
  StatusBadge,
  TextAreaField,
} from "../../components/ui";
import type { AppError } from "../../ipc/core";
import {
  clearQrIcon,
  confirmQrExport,
  discardQrExport,
  prepareQrExport,
  previewQr,
  selectQrIcon,
  type PreparedQrExport,
  type QrErrorCorrection,
  type QrIconSummary,
} from "../../ipc/qr";
import {
  QR_MAX_BYTES,
  SIZE_OPTIONS,
  canStartExport,
  describeIcon,
  describePrepared,
  discardFailedMessage,
  discardTarget,
  effectiveLevel,
  exportOutcomeView,
  iconLevelNotice,
  iconRulesText,
  inputProblem,
  isExportBusy,
  levelOptions,
  toPixelSize,
  type QrExportView,
  type QrPreviewView,
  type QrSnapshot,
  type SizeChoice,
} from "./qrToolState";
import { createRequestTracker } from "./toolRequestState";

export function QrTool() {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState("");
  const [level, setLevel] = useState<QrErrorCorrection>("M");
  const [size, setSize] = useState<SizeChoice>("512");
  const [icon, setIcon] = useState<QrIconSummary | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState<string | undefined>();
  const [preview, setPreview] = useState<QrPreviewView>({ status: "idle" });
  const [exportView, setExportView] = useState<QrExportView>({
    status: "idle",
  });
  const [discardNotice, setDiscardNotice] = useState<string | undefined>();
  const [previewTracker] = useState(createRequestTracker);
  const [exportTracker] = useState(createRequestTracker);

  useEffect(
    () => () => {
      previewTracker.invalidate();
      exportTracker.invalidate();
    },
    [previewTracker, exportTracker],
  );

  const busy = isExportBusy(exportView);
  const inputLocked = busy || iconBusy;
  const iconId = icon?.iconId;
  const shownLevel = effectiveLevel(level, iconId);
  const problem = inputProblem(text, shownLevel, locale);

  function generate(next: QrSnapshot) {
    const requestId = previewTracker.issue();
    if (next.text.length === 0) {
      setPreview({ status: "idle" });
      return;
    }
    const limitMessage = inputProblem(
      next.text,
      effectiveLevel(next.level, next.iconId),
      locale,
    );
    if (limitMessage) {
      setPreview({ status: "error", message: limitMessage });
      return;
    }
    setPreview({ status: "pending" });
    previewQr({
      text: next.text,
      level: next.level,
      size: toPixelSize(next.size),
      iconId: next.iconId,
    }).then(
      (result) => {
        if (previewTracker.isCurrent(requestId)) {
          setPreview({ status: "ready", snapshot: next, preview: result });
        }
      },
      (error: AppError) => {
        if (previewTracker.isCurrent(requestId)) {
          setPreview({ status: "error", message: localizeError(error, locale) });
        }
      },
    );
  }

  function discardPrepared(prepared: PreparedQrExport) {
    discardQrExport({
      grantId: prepared.grantId,
      operationId: prepared.operationId,
    }).then(
      () => undefined,
      () => setDiscardNotice(discardFailedMessage(locale)),
    );
  }

  function dropAwaitingExport() {
    const prepared = discardTarget(exportView);
    if (prepared) discardPrepared(prepared);
  }

  function change(next: Partial<QrSnapshot>) {
    const snapshot: QrSnapshot = {
      text: next.text ?? text,
      level: next.level ?? level,
      size: next.size ?? size,
      iconId,
    };
    setText(snapshot.text);
    setLevel(snapshot.level);
    setSize(snapshot.size);
    dropAwaitingExport();
    exportTracker.invalidate();
    setExportView({ status: "idle" });
    generate(snapshot);
  }

  function replaceIcon(nextIcon: QrIconSummary | null) {
    setIcon(nextIcon);
    dropAwaitingExport();
    exportTracker.invalidate();
    setExportView({ status: "idle" });
    generate({
      text,
      level,
      size,
      iconId: nextIcon?.iconId,
    });
  }

  function chooseIcon() {
    setIconBusy(true);
    setIconError(undefined);
    selectQrIcon().then(
      (outcome) => {
        setIconBusy(false);
        if (outcome.status === "CANCELLED") return;
        replaceIcon({
          iconId: outcome.iconId,
          format: outcome.format,
          width: outcome.width,
          height: outcome.height,
          thumbnailPngBase64: outcome.thumbnailPngBase64,
        });
      },
      (error: AppError) => {
        setIconBusy(false);
        setIconError(localizeError(error, locale));
      },
    );
  }

  function removeIcon() {
    setIconBusy(true);
    setIconError(undefined);
    clearQrIcon().then(
      () => {
        setIconBusy(false);
        replaceIcon(null);
      },
      (error: AppError) => {
        setIconBusy(false);
        setIconError(localizeError(error, locale));
      },
    );
  }

  function startExport() {
    if (preview.status !== "ready" || !canStartExport(preview, exportView)) {
      return;
    }
    const { snapshot } = preview;
    const requestId = exportTracker.issue();
    setDiscardNotice(undefined);
    setExportView({ status: "preparing" });
    prepareQrExport({
      text: snapshot.text,
      level: effectiveLevel(snapshot.level, snapshot.iconId),
      size: toPixelSize(snapshot.size),
      expectedSha256: preview.preview.sha256,
      iconId: snapshot.iconId,
    }).then(
      (outcome) => {
        if (!exportTracker.isCurrent(requestId)) {
          if (outcome.status === "PREVIEWED") discardPrepared(outcome);
          return;
        }
        if (outcome.status === "CANCELLED") {
          setExportView({ status: "cancelled" });
          return;
        }
        setExportView({ status: "awaiting", snapshot, prepared: outcome });
      },
      (error: AppError) => {
        if (exportTracker.isCurrent(requestId)) {
          setExportView({
            status: "failed",
            message: localizeError(error, locale),
          });
        }
      },
    );
  }

  function confirmExport() {
    if (exportView.status !== "awaiting") return;
    const { snapshot, prepared } = exportView;
    const requestId = exportTracker.issue();
    setExportView({ status: "writing", snapshot, prepared });
    confirmQrExport({
      operationId: prepared.operationId,
      grantId: prepared.grantId,
    }).then(
      (outcome) => {
        if (exportTracker.isCurrent(requestId)) {
          setExportView(exportOutcomeView(prepared.target, outcome, locale));
        }
      },
      (error: AppError) => {
        if (exportTracker.isCurrent(requestId)) {
          setExportView({
            status: "failed",
            message: localizeError(error, locale),
          });
        }
      },
    );
  }

  function discardExport() {
    dropAwaitingExport();
    exportTracker.invalidate();
    setExportView({ status: "idle" });
  }

  return (
    <Panel
      aria-labelledby="qr-tool-heading"
      className="grid gap-ui-12 p-ui-12"
    >
      <div className="grid gap-ui-4">
        <h2 id="qr-tool-heading" className="text-body font-semibold">
          {t("tools.qr.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("tools.qr.description")}
        </p>
      </div>

      <TextAreaField
        label={t("tools.qr.inputLabel")}
        expandTitle={t("tools.qr.inputExpandTitle")}
        description={t("tools.qr.inputLimit", { bytes: QR_MAX_BYTES[shownLevel] })}
        action={
          <PasteButton
            disabled={inputLocked}
            onPaste={(next) => change({ text: next })}
          />
        }
        value={text}
        onValueChange={(next) => change({ text: next })}
        expandable
        emphasis
        rows={4}
        spellCheck={false}
        disabled={inputLocked}
        error={problem}
      />

      <ActionRow alignItems="end">
        <SelectField
          label={t("tools.qr.levelLabel")}
          value={level}
          onValueChange={(next) => change({ level: next })}
          options={levelOptions(locale)}
          disabled={inputLocked}
        />
        <SelectField
          label={t("tools.qr.sizeLabel")}
          value={size}
          onValueChange={(next) => change({ size: next })}
          options={SIZE_OPTIONS}
          disabled={inputLocked}
        />
      </ActionRow>

      <section aria-labelledby="qr-icon-heading" className="grid gap-ui-8">
        <h3 id="qr-icon-heading" className="text-body font-semibold">
          {t("tools.qr.iconHeading")}
        </h3>
        <p className="m-0 text-xs text-muted-foreground">{iconRulesText(locale)}</p>

        {icon ? (
          <ActionRow>
            {/* Fixed white substrate, like the preview: the thumbnail is the backend's PNG. */}
            <div className="grid w-fit rounded-control bg-qr-substrate p-ui-8">
              <img
                alt={t("tools.qr.iconThumbnail")}
                src={`data:image/png;base64,${icon.thumbnailPngBase64}`}
                style={{ width: 64, height: 64, objectFit: "contain" }}
              />
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              {describeIcon(icon)}
            </p>
            <Button onClick={chooseIcon} disabled={inputLocked} variant="secondary">
              {t("tools.qr.iconReplace")}
            </Button>
            <Button variant="ghost" onClick={removeIcon} disabled={inputLocked}>
              {t("tools.qr.iconRemove")}
            </Button>
          </ActionRow>
        ) : (
          <div className="flex flex-wrap items-center gap-ui-8">
            <Button onClick={chooseIcon} disabled={inputLocked} variant="secondary">
              {t("tools.qr.iconChoose")}
            </Button>
          </div>
        )}

        {iconLevelNotice(level, iconId, locale) ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            {iconLevelNotice(level, iconId, locale)}
          </p>
        ) : null}

        {iconError ? (
          <div
            role="alert"
            className="grid gap-ui-4 rounded-control bg-danger-soft p-ui-8 text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              {t("tools.qr.iconUnavailable")}
            </StatusBadge>
            <p className="m-0 break-words">{iconError}</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="qr-preview-heading" className="grid gap-ui-8">
        <h3 id="qr-preview-heading" className="text-body font-semibold">
          {t("tools.qr.previewHeading")}
        </h3>

        {preview.status === "idle" ? (
          <p className="text-xs text-muted-foreground">
            {t("tools.qr.previewIdle")}
          </p>
        ) : null}

        {preview.status === "pending" ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t("tools.qr.generating")}
          </p>
        ) : null}

        {preview.status === "error" ? (
          <div
            role="alert"
            className="grid gap-ui-4 rounded-control bg-danger-soft p-ui-8 text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              {t("tools.qr.generateFailed")}
            </StatusBadge>
            <p className="m-0 break-words">{preview.message}</p>
          </div>
        ) : null}

        {preview.status === "ready" ? (
          <>
            {/* Fixed white substrate: contrast must not follow the theme. */}
            <div className="grid w-fit gap-ui-4 rounded-control bg-qr-substrate p-ui-8">
              <img
                alt={t("tools.qr.previewAlt")}
                src={`data:image/png;base64,${preview.preview.pngBase64}`}
                style={{
                  width: "min(100%, 320px)",
                  height: "auto",
                  imageRendering: "pixelated",
                }}
              />
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              {t("tools.qr.previewMeta", {
                modules: preview.preview.moduleCount,
                modulePx: preview.preview.modulePx,
                imagePx: preview.preview.imagePx,
                level: effectiveLevel(preview.snapshot.level, preview.snapshot.iconId),
              })}
              {preview.snapshot.iconId ? t("tools.qr.previewWithIcon") : ""}
            </p>
          </>
        ) : null}
      </section>

      <section aria-labelledby="qr-export-heading" className="grid gap-ui-8">
        <h3 id="qr-export-heading" className="text-body font-semibold">
          {t("tools.qr.exportHeading")}
        </h3>

        {exportView.status !== "awaiting" && !busy ? (
          <div className="flex flex-wrap items-center gap-ui-8">
            <Button
              variant="primary"
              onClick={startExport}
              disabled={!canStartExport(preview, exportView)}
            >
              {t("tools.qr.exportAction")}
            </Button>
          </div>
        ) : null}

        {exportView.status === "cancelled" ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            {t("tools.qr.cancelled")}
          </p>
        ) : null}

        {exportView.status === "preparing" ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            {t("tools.qr.preparing")}
          </p>
        ) : null}

        {exportView.status === "awaiting" ? (
          <div className="grid gap-ui-8 rounded-control bg-surface-muted p-ui-8">
            <p className="m-0 break-all text-body font-semibold">
              {describePrepared(exportView.prepared, locale).title}
            </p>
            <ul className="m-0 grid gap-ui-2 pl-ui-12 text-xs text-muted-foreground">
              {describePrepared(exportView.prepared, locale).notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <ActionRow>
              <Button variant="primary" onClick={confirmExport}>
                {t("tools.qr.confirmWrite")}
              </Button>
              <Button variant="secondary" onClick={discardExport}>
                {t("common.cancel")}
              </Button>
            </ActionRow>
          </div>
        ) : null}

        {exportView.status === "writing" ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            {t("tools.qr.writing")}
          </p>
        ) : null}

        {exportView.status === "written" ? (
          <div
            role="status"
            className="grid gap-ui-4 rounded-control bg-surface-muted p-ui-8 text-xs"
          >
            <StatusBadge className="justify-self-start" tone="success">
              {t("tools.qr.exported")}
            </StatusBadge>
            <p className="m-0 break-all">{exportView.target}</p>
            <p className="m-0 text-muted-foreground">{exportView.message}</p>
            {exportView.warning ? (
              <p className="m-0 text-danger">{exportView.warning}</p>
            ) : null}
          </div>
        ) : null}

        {exportView.status === "failed" ? (
          <div
            role="alert"
            className="grid gap-ui-4 rounded-control bg-danger-soft p-ui-8 text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              {t("tools.qr.exportFailed")}
            </StatusBadge>
            <p className="m-0 break-words">{exportView.message}</p>
            {exportView.warning ? (
              <p className="m-0 break-words">{exportView.warning}</p>
            ) : null}
          </div>
        ) : null}

        {discardNotice ? (
          <p role="alert" className="m-0 text-xs text-danger">
            {discardNotice}
          </p>
        ) : null}
      </section>
    </Panel>
  );
}
