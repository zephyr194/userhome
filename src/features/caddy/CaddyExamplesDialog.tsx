import { useState } from "react";
import { Button, CodeViewer, Modal, VerticalMenu } from "../../components/ui";
import { useCaddyCopy } from "./caddyCopy";
import {
  CADDY_EXAMPLES,
  REFERENCE_NOTICE_KEY,
  exampleTitle,
  examplePurpose,
} from "./caddyExamples";

const TITLE_ID = "caddy-examples-heading";

interface CaddyExamplesDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CaddyExamplesDialog({ open, onClose }: CaddyExamplesDialogProps) {
  const { t } = useCaddyCopy();
  return (
    <Modal
      bodyClassName="r7-caddy-examples__body"
      className="r7-caddy-examples"
      onClose={onClose}
      open={open}
      title={<span id={TITLE_ID}>{t("caddy.examples.heading")}</span>}
      titleId={TITLE_ID}
    >
      <ExamplesContent onClose={onClose} />
    </Modal>
  );
}

// Mounted only while the dialog is open, so selection and copy status reset on each open.
function ExamplesContent({ onClose }: { onClose: () => void }) {
  const copy = useCaddyCopy();
  const { t } = copy;
  const menuItems = CADDY_EXAMPLES.map((item) => ({
    id: item.id,
    label: exampleTitle(item, copy),
    description: examplePurpose(item, copy),
  }));
  const [selectedId, setSelectedId] = useState(CADDY_EXAMPLES[0].id);
  const [copyResult, setCopyResult] = useState<{ id: string; status: "copied" | "failed" } | null>(null);
  const example = CADDY_EXAMPLES.find((item) => item.id === selectedId) ?? CADDY_EXAMPLES[0];
  const copyStatus = copyResult?.id === example.id ? copyResult.status : null;

  async function copyExample() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(example.text);
      setCopyResult({ id: example.id, status: "copied" });
    } catch {
      setCopyResult({ id: example.id, status: "failed" });
    }
  }

  return (
    <div className="r7-caddy-examples__frame flex min-h-0 flex-1 flex-col gap-ui-12">
      <div className="r7-caddy-examples__main">
        <div className="r7-caddy-examples__list">
          <VerticalMenu
            items={menuItems}
            label={t("caddy.examples.listLabel")}
            onSelect={setSelectedId}
            selected={example.id}
          />
        </div>
        <div className="r7-caddy-examples__detail">
          {example.support === "reference" ? (
            <p className="m-0 text-aux text-muted-foreground" role="note">
              {t(REFERENCE_NOTICE_KEY)}
            </p>
          ) : null}
          <CodeViewer
            allowWindow={false}
            label={t("caddy.examples.codeLabel")}
            language="caddyfile"
            scrollClassName="r7-caddy-examples__code"
            text={example.text}
            title={exampleTitle(example, copy)}
          />
        </div>
      </div>
      <div className="r7-caddy-examples__footer flex flex-wrap items-center justify-end gap-ui-8 border-t border-border pt-ui-12">
        {copyStatus === "failed" ? (
          <p className="m-0 mr-auto text-aux text-danger" role="alert">
            {t("caddy.examples.copyFailed")}
          </p>
        ) : null}
        {copyStatus === "copied" ? (
          <span className="text-aux text-muted-foreground" role="status">
            {t("common.copied")}
          </span>
        ) : null}
        <Button onClick={copyExample} size="sm" variant="ghost">
          {t("caddy.examples.copy")}
        </Button>
        <Button data-modal-cancel onClick={onClose} size="sm" variant="default">
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
