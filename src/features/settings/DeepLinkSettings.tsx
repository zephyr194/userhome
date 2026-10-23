import { CopyButton, StatusBadge } from "../../components/ui";
import { useT } from "../../i18n/useLocale";
import { listDeepLinks } from "../../app/deepLink";

export function DeepLinkSettings() {
  const t = useT();
  const pages = listDeepLinks();

  return (
    <div className="grid min-w-0 gap-ui-12" aria-label={t("settings.deepLink.listLabel")} role="region">
      <p className="m-0 text-aux leading-relaxed text-muted-foreground">
        {t("settings.deepLink.description")}
      </p>
      <p className="m-0 flex flex-wrap items-center gap-ui-8 text-aux leading-relaxed">
        <StatusBadge tone="warning">{t("settings.deepLink.availability")}</StatusBadge>
        <span>{t("settings.deepLink.availabilityNote")}</span>
      </p>
      {pages.map((page) => (
        <section className="grid min-w-0 gap-ui-4" key={page.routeId}>
          <h3 className="m-0 break-words text-group font-semibold">{t(page.labelKey)}</h3>
          <table aria-label={t(page.labelKey)} className="w-full table-fixed border-collapse text-aux">
            <colgroup>
              <col className="w-40" />
              <col />
              <col className="w-44" />
            </colgroup>
            <tbody>
              {page.rows.map((row) => (
                <tr className="border-t border-line" key={row.link}>
                  <th className="py-ui-4 pr-ui-8 text-left font-normal text-muted-foreground" scope="row">
                    {t(row.labelKey)}
                  </th>
                  <td className="min-w-0 py-ui-4 pr-ui-8">
                    <code className="break-all font-mono text-foreground">{row.link}</code>
                  </td>
                  <td className="py-ui-4">
                    <CopyButton
                      ariaLabel={t("settings.deepLink.copyOf", { label: t(row.labelKey) })}
                      label={t("common.copy")}
                      value={row.link}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
