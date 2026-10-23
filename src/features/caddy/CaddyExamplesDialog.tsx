import { useState } from "react";
import { Button, CodeViewer, Modal, VerticalMenu } from "../../components/ui";
import { CADDY_EXAMPLES, REFERENCE_NOTICE } from "./caddyExamples";

const TITLE_ID = "caddy-examples-heading";
const COPY_FAILED = "复制失败：请在代码区选中文本后按 ⌘C。";
const MENU_ITEMS = CADDY_EXAMPLES.map((example) => ({
  id: example.id,
  label: example.title,
  description: example.purpose,
}));

interface CaddyExamplesDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CaddyExamplesDialog({ open, onClose }: CaddyExamplesDialogProps) {
  return (
    <Modal
      bodyClassName="r7-caddy-examples__body"
      className="r7-caddy-examples"
      onClose={onClose}
      open={open}
      title={<span id={TITLE_ID}>配置示例</span>}
      titleId={TITLE_ID}
    >
      <ExamplesContent onClose={onClose} />
    </Modal>
  );
}

// Mounted only while the dialog is open, so selection and copy status reset on each open.
function ExamplesContent({ onClose }: { onClose: () => void }) {
  const [selectedId, setSelectedId] = useState(CADDY_EXAMPLES[0].id);
  const [copy, setCopy] = useState<{ id: string; status: "copied" | "failed" } | null>(null);
  const example = CADDY_EXAMPLES.find((item) => item.id === selectedId) ?? CADDY_EXAMPLES[0];
  const copyStatus = copy?.id === example.id ? copy.status : null;

  async function copyExample() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(example.text);
      setCopy({ id: example.id, status: "copied" });
    } catch {
      setCopy({ id: example.id, status: "failed" });
    }
  }

  return (
    <div className="r7-caddy-examples__frame flex min-h-0 flex-1 flex-col gap-ui-12">
      <div className="r7-caddy-examples__main">
        <div className="r7-caddy-examples__list">
          <VerticalMenu
            items={MENU_ITEMS}
            label="配置示例列表"
            onSelect={setSelectedId}
            selected={example.id}
          />
        </div>
        <div className="r7-caddy-examples__detail">
          {example.support === "reference" ? (
            <p className="m-0 text-aux text-muted-foreground" role="note">
              {REFERENCE_NOTICE}
            </p>
          ) : null}
          <CodeViewer
            label="Caddyfile 示例"
            language="caddyfile"
            scrollClassName="r7-caddy-examples__code"
            text={example.text}
            title={example.title}
          />
        </div>
      </div>
      <div className="r7-caddy-examples__footer flex flex-wrap items-center justify-end gap-ui-8 border-t border-border pt-ui-12">
        {copyStatus === "failed" ? (
          <p className="m-0 mr-auto text-aux text-danger" role="alert">
            {COPY_FAILED}
          </p>
        ) : null}
        {copyStatus === "copied" ? (
          <span className="text-aux text-muted-foreground" role="status">
            已复制
          </span>
        ) : null}
        <Button onClick={copyExample} size="sm" variant="secondary">
          复制示例
        </Button>
        <Button data-modal-cancel onClick={onClose} size="sm" variant="secondary">
          关闭
        </Button>
      </div>
    </div>
  );
}
