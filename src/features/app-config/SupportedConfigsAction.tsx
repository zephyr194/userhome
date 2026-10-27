import { useState } from "react";
import { Button } from "../../components/ui";
import { useLocale } from "../../i18n/useLocale";
import type { AppConfigListItem } from "../../ipc/appConfig";
import { appConfigCopy } from "./appConfigModel";
import { SupportedConfigsDialog } from "./SupportedConfigsDialog";

export function SupportedConfigsAction({ items }: { items: readonly AppConfigListItem[] | undefined }) {
  const copy = appConfigCopy(useLocale());
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} variant="default">
        {copy.t("appConfig.supported.open")}
      </Button>
      <SupportedConfigsDialog items={items} onClose={() => setOpen(false)} open={open} />
    </>
  );
}
