import { useState } from "react";
import { Button } from "../../components/ui";
import type { AppConfigListItem } from "../../ipc/appConfig";
import { SupportedConfigsDialog } from "./SupportedConfigsDialog";

export function SupportedConfigsAction({ items }: { items: readonly AppConfigListItem[] | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
        支持的配置
      </Button>
      <SupportedConfigsDialog items={items} onClose={() => setOpen(false)} open={open} />
    </>
  );
}
