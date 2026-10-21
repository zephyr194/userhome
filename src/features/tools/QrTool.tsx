import { useEffect, useState } from "react";
import {
  Button,
  Panel,
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
  DISCARD_FAILED_MESSAGE,
  ICON_RULES_TEXT,
  LEVEL_OPTIONS,
  QR_MAX_BYTES,
  SIZE_OPTIONS,
  canStartExport,
  describeIcon,
  describePrepared,
  discardTarget,
  effectiveLevel,
  exportOutcomeView,
  iconLevelNotice,
  inputProblem,
  isExportBusy,
  toPixelSize,
  type QrExportView,
  type QrPreviewView,
  type QrSnapshot,
  type SizeChoice,
} from "./qrToolState";
import { createRequestTracker } from "./toolRequestState";

export function QrTool() {
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
  const problem = inputProblem(text, shownLevel);

  function generate(next: QrSnapshot) {
    const requestId = previewTracker.issue();
    if (next.text.length === 0) {
      setPreview({ status: "idle" });
      return;
    }
    const limitMessage = inputProblem(
      next.text,
      effectiveLevel(next.level, next.iconId),
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
          setPreview({ status: "error", message: error.message });
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
      () => setDiscardNotice(DISCARD_FAILED_MESSAGE),
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
        setIconError(error.message);
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
        setIconError(error.message);
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
          setExportView({ status: "failed", message: error.message });
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
          setExportView(exportOutcomeView(prepared.target, outcome));
        }
      },
      (error: AppError) => {
        if (exportTracker.isCurrent(requestId)) {
          setExportView({ status: "failed", message: error.message });
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
      className="grid gap-ui-xl border border-border p-ui-2xl"
    >
      <div className="grid gap-ui-xs">
        <h2 id="qr-tool-heading" className="text-body font-semibold">
          二维码生成
        </h2>
        <p className="text-xs text-muted-foreground">
          文本只用于生成图片，不会访问链接、缩短或添加参数。二维码固定黑白，不随页面主题变化；输入不会保存。
        </p>
      </div>

      <TextAreaField
        label="文本或 URL"
        description={`UTF-8，上限 ${QR_MAX_BYTES[shownLevel]} 字节（当前纠错等级）。`}
        value={text}
        onValueChange={(next) => change({ text: next })}
        rows={4}
        spellCheck={false}
        disabled={inputLocked}
        error={problem}
      />

      <div className="flex flex-wrap items-end gap-ui-md">
        <SelectField
          label="纠错等级"
          value={level}
          onValueChange={(next) => change({ level: next })}
          options={LEVEL_OPTIONS}
          disabled={inputLocked}
        />
        <SelectField
          label="尺寸"
          value={size}
          onValueChange={(next) => change({ size: next })}
          options={SIZE_OPTIONS}
          disabled={inputLocked}
        />
      </div>

      <section aria-labelledby="qr-icon-heading" className="grid gap-ui-md">
        <h3 id="qr-icon-heading" className="text-body font-semibold">
          中心图标（可选）
        </h3>
        <p className="m-0 text-xs text-muted-foreground">{ICON_RULES_TEXT}</p>

        {icon ? (
          <div className="flex flex-wrap items-center gap-ui-md">
            {/* Fixed white substrate, like the preview: the thumbnail is the backend's PNG. */}
            <div
              className="grid w-fit rounded-control p-ui-sm"
              style={{ backgroundColor: "#ffffff" }}
            >
              <img
                alt="图标缩略图"
                src={`data:image/png;base64,${icon.thumbnailPngBase64}`}
                style={{ width: 64, height: 64, objectFit: "contain" }}
              />
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              {describeIcon(icon)}
            </p>
            <Button onClick={chooseIcon} disabled={inputLocked}>
              更换图标…
            </Button>
            <Button variant="ghost" onClick={removeIcon} disabled={inputLocked}>
              移除图标
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-ui-md">
            <Button onClick={chooseIcon} disabled={inputLocked}>
              选择图标…
            </Button>
          </div>
        )}

        {iconLevelNotice(level, iconId) ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            {iconLevelNotice(level, iconId)}
          </p>
        ) : null}

        {iconError ? (
          <div
            role="alert"
            className="grid gap-ui-xs rounded-control bg-danger-soft p-ui-lg text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              图标不可用
            </StatusBadge>
            <p className="m-0 break-words">{iconError}</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="qr-preview-heading" className="grid gap-ui-md">
        <h3 id="qr-preview-heading" className="text-body font-semibold">
          预览
        </h3>

        {preview.status === "idle" ? (
          <p className="text-xs text-muted-foreground">
            输入内容后会在这里生成二维码。
          </p>
        ) : null}

        {preview.status === "pending" ? (
          <p role="status" className="text-xs text-muted-foreground">
            正在生成…
          </p>
        ) : null}

        {preview.status === "error" ? (
          <div
            role="alert"
            className="grid gap-ui-xs rounded-control bg-danger-soft p-ui-lg text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              无法生成
            </StatusBadge>
            <p className="m-0 break-words">{preview.message}</p>
          </div>
        ) : null}

        {preview.status === "ready" ? (
          <>
            {/* Fixed white substrate: contrast must not follow the theme. */}
            <div
              className="grid w-fit gap-ui-xs rounded-control p-ui-lg"
              style={{ backgroundColor: "#ffffff" }}
            >
              <img
                alt="二维码预览"
                src={`data:image/png;base64,${preview.preview.pngBase64}`}
                style={{
                  width: "min(100%, 320px)",
                  height: "auto",
                  imageRendering: "pixelated",
                }}
              />
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              {`${preview.preview.moduleCount} × ${preview.preview.moduleCount} 模块 · 每模块 ${preview.preview.modulePx} px · 图像 ${preview.preview.imagePx} × ${preview.preview.imagePx} px · 纠错 ${effectiveLevel(preview.snapshot.level, preview.snapshot.iconId)}${preview.snapshot.iconId ? " · 含中心图标" : ""}`}
            </p>
          </>
        ) : null}
      </section>

      <section aria-labelledby="qr-export-heading" className="grid gap-ui-md">
        <h3 id="qr-export-heading" className="text-body font-semibold">
          导出 PNG
        </h3>

        {exportView.status !== "awaiting" && !busy ? (
          <div className="flex flex-wrap items-center gap-ui-md">
            <Button
              variant="primary"
              onClick={startExport}
              disabled={!canStartExport(preview, exportView)}
            >
              导出 PNG…
            </Button>
          </div>
        ) : null}

        {exportView.status === "cancelled" ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            已取消，未导出。
          </p>
        ) : null}

        {exportView.status === "preparing" ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            正在打开保存面板…
          </p>
        ) : null}

        {exportView.status === "awaiting" ? (
          <div className="grid gap-ui-md rounded-control bg-surface-muted p-ui-lg">
            <p className="m-0 break-all text-body font-semibold">
              {describePrepared(exportView.prepared).title}
            </p>
            <ul className="m-0 grid gap-ui-xxs pl-ui-xl text-xs text-muted-foreground">
              {describePrepared(exportView.prepared).notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-ui-md">
              <Button variant="primary" onClick={confirmExport}>
                确认写入
              </Button>
              <Button variant="ghost" onClick={discardExport}>
                取消
              </Button>
            </div>
          </div>
        ) : null}

        {exportView.status === "writing" ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            正在写入并回读校验…
          </p>
        ) : null}

        {exportView.status === "written" ? (
          <div
            role="status"
            className="grid gap-ui-xs rounded-control bg-surface-muted p-ui-lg text-xs"
          >
            <StatusBadge className="justify-self-start" tone="success">
              已导出
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
            className="grid gap-ui-xs rounded-control bg-danger-soft p-ui-lg text-xs text-danger"
          >
            <StatusBadge className="justify-self-start" tone="danger">
              导出失败
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
