import { useState } from "react";
import { Button, StatusBadge } from "../../components/ui";
import { COPY_LINK_FAILED, copyText } from "../../components/ui/clipboard";
import { DEEP_LINK_EXAMPLES } from "./deepLinkExamples";
import { SettingsSection } from "./SettingsPrimitives";

export function DeepLinkSettings() {
  const [copy, setCopy] = useState<{ id: string; status: "copied" | "failed" }>();

  async function copyExample(id: string, link: string) {
    setCopy({ id, status: (await copyText(link)) ? "copied" : "failed" });
  }

  const copiedExample = DEEP_LINK_EXAMPLES.find((example) => example.id === copy?.id);

  return (
    <SettingsSection headingId="deep-link-settings-heading" title="链接打开">
      <p className="m-0 text-aux leading-relaxed text-muted-foreground">
        在浏览器、文档或终端里点击 userhome:// 链接，UserHome 会显示主窗口并打开对应页面。链接只做导航，不会执行任何操作。
      </p>
      <p className="r8-deeplink-settings__note m-0 flex flex-wrap items-center gap-ui-8 text-aux leading-relaxed">
        <StatusBadge tone="warning">仅安装后可用</StatusBadge>
        <span>只在安装后的应用中可用；开发运行（tauri dev）时系统不会注册这个链接。</span>
      </p>
      <ul aria-label="链接示例" className="r8-deeplink-examples">
        {DEEP_LINK_EXAMPLES.map((example) => (
          <li className="r8-deeplink-examples__row" key={example.id}>
            <span className="text-aux text-muted-foreground">{example.purpose}</span>
            <span className="r8-deeplink-examples__line">
              <code className="r8-deeplink-examples__link">{example.link}</code>
              <Button
                onClick={() => void copyExample(example.id, example.link)}
                size="sm"
                variant="secondary"
              >
                复制
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {copy?.status === "failed" ? (
        <p className="m-0 text-aux text-danger" role="alert">
          {COPY_LINK_FAILED}
        </p>
      ) : copy?.status === "copied" && copiedExample ? (
        <p className="m-0 text-aux text-muted-foreground" role="status">
          已复制：{copiedExample.purpose}
        </p>
      ) : null}
    </SettingsSection>
  );
}
