import { useState } from "react";
import { Button, StatusBadge } from "../../components/ui";
import { COPY_LINK_FAILED_KEY, copyText } from "../../components/ui/clipboard";
import { useT } from "../../i18n/useLocale";
import { DEEP_LINK_EXAMPLES } from "./deepLinkExamples";
import { SettingsSection } from "./SettingsPrimitives";

export function DeepLinkSettings() {
  const t = useT();
  const [copy, setCopy] = useState<{ id: string; status: "copied" | "failed" }>();

  async function copyExample(id: string, link: string) {
    setCopy({ id, status: (await copyText(link)) ? "copied" : "failed" });
  }

  const copiedExample = DEEP_LINK_EXAMPLES.find((example) => example.id === copy?.id);

  return (
    <SettingsSection headingId="deep-link-settings-heading" title={t("settings.deepLink.title")}>
      <p className="m-0 text-aux leading-relaxed text-muted-foreground">
        {t("settings.deepLink.description")}
      </p>
      <p className="r8-deeplink-settings__note m-0 flex flex-wrap items-center gap-ui-8 text-aux leading-relaxed">
        <StatusBadge tone="warning">{t("settings.deepLink.availability")}</StatusBadge>
        <span>{t("settings.deepLink.availabilityNote")}</span>
      </p>
      <ul aria-label={t("settings.deepLink.examplesLabel")} className="r8-deeplink-examples">
        {DEEP_LINK_EXAMPLES.map((example) => (
          <li className="r8-deeplink-examples__row" key={example.id}>
            <span className="text-aux text-muted-foreground">{t(example.purposeKey)}</span>
            <span className="r8-deeplink-examples__line">
              <code className="r8-deeplink-examples__link">{example.link}</code>
              <Button
                onClick={() => void copyExample(example.id, example.link)}
                size="sm"
                variant="secondary"
              >
                {t("settings.deepLink.copy")}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {copy?.status === "failed" ? (
        <p className="m-0 text-aux text-danger" role="alert">
          {t(COPY_LINK_FAILED_KEY)}
        </p>
      ) : copy?.status === "copied" && copiedExample ? (
        <p className="m-0 text-aux text-muted-foreground" role="status">
          {t("settings.deepLink.copied", { purpose: t(copiedExample.purposeKey) })}
        </p>
      ) : null}
    </SettingsSection>
  );
}
