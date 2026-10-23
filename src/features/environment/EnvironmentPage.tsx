import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useToolSection } from "../../app/SectionContext";
import { Button, PageShell, SectionTabs, VerticalMenu, type SectionTab, type VerticalMenuItem } from "../../components/ui";
import { PageRegion } from "../../components/ui/PageShell";
import { createScrollMemory } from "../../components/ui/pageScrollMemory";
import { useT } from "../../i18n/useLocale";
import { EnvironmentView } from "./EnvironmentView";
import { LaunchctlPage } from "./LaunchctlPage";
import { useDotenvWorkspace } from "./useDotenvWorkspace";
import { ZshPage } from "./ZshPage";

type SystemTabId = "zsh" | "launchctl";

function isSystemTab(section: string): section is SystemTabId {
  return section === "zsh" || section === "launchctl";
}

/**
 * The environment page holds two levels: the system variables (zsh startup files
 * and the macOS login session, one tab each) and the dotenv files of the
 * authorized directories (one tab per directory). The route keeps its three
 * section values; this page maps them to the two levels. Tabs stay fixed above
 * the content, which alone scrolls. Each tab is read only the first time it is
 * shown, then stays mounted so its state survives switching back and forth.
 */
export function EnvironmentPage() {
  const t = useT();
  const [section, setSection] = useToolSection("dotenv");
  const [lastSystemTab, setLastSystemTab] = useState<SystemTabId>("zsh");
  if (isSystemTab(section) && section !== lastSystemTab) setLastSystemTab(section);
  const [zshOpened, setZshOpened] = useState(section === "zsh");
  const [launchctlOpened, setLaunchctlOpened] = useState(section === "launchctl");
  if (section === "zsh" && !zshOpened) setZshOpened(true);
  if (section === "launchctl" && !launchctlOpened) setLaunchctlOpened(true);
  // Only the content scrolls; each section keeps its own offset while another one is shown.
  const contentRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [scrollMemory] = useState(() => createScrollMemory(section));
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = scrollMemory.switchTo(section);
  }, [section, scrollMemory]);

  const dotenv = useDotenvWorkspace();
  const selectedDirectory = dotenv.state.selectedGrantId;
  useEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [section, selectedDirectory, dotenv.tabs.length]);

  const domains: readonly VerticalMenuItem[] = [
    {
      id: "system",
      label: t("env.page.domain.system"),
      description: t("env.page.domain.systemDescription"),
    },
    {
      id: "dotenv",
      label: t("env.page.domain.dotenv"),
      description: t("env.page.domain.dotenvDescription"),
    },
  ];
  const systemTabs: readonly SectionTab[] = [
    { id: "zsh", label: t("env.page.tab.zsh") },
    { id: "launchctl", label: t("env.page.tab.launchctl") },
  ];
  const directoryTabs: readonly SectionTab[] = dotenv.tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    title: tab.title,
  }));
  const domain = isSystemTab(section) ? "system" : "dotenv";
  const selectDomain = (id: string) => setSection(id === "system" ? lastSystemTab : "dotenv");

  return (
    <div className="environment-page borderless-pane h-full min-h-0 min-w-0">
      <PageShell layout="master-detail" scrollKey={section}>
        <div className="environment-page__menu min-w-0 px-ui-8">
          <VerticalMenu
            items={domains}
            label={t("env.page.menu")}
            onSelect={selectDomain}
            selected={domain}
          />
        </div>
        <div className="environment-page__detail min-w-0">
          {domain === "system" ? (
            <div className="environment-page__tabs shrink-0 min-w-0 px-ui-12" ref={tabsRef}>
              <SectionTabs
                label={t("env.page.systemTabs")}
                onSelect={setSection}
                sections={systemTabs}
                selected={section}
              />
            </div>
          ) : directoryTabs.length > 0 ? (
            <div
              className="environment-page__tabs flex shrink-0 min-w-0 items-end gap-ui-8 px-ui-12"
              ref={tabsRef}
            >
              <div className="environment-page__tab-scroll min-w-0 flex-1 overflow-x-auto">
                <SectionTabs
                  label={t("env.dotenv.tabs")}
                  onSelect={dotenv.actions.selectGrant}
                  sections={directoryTabs}
                  selected={selectedDirectory ?? directoryTabs[0]?.id ?? ""}
                />
              </div>
              <Button
                disabled={dotenv.addingGrant}
                onClick={dotenv.actions.addGrant}
                size="sm"
              >
                {dotenv.addingGrant ? t("env.dotenv.grant.waiting") : t("env.dotenv.grant.add")}
              </Button>
            </div>
          ) : null}
          <div
            className="environment-page__content min-w-0"
            onScroll={(event) => scrollMemory.record(event.currentTarget.scrollTop)}
            ref={contentRef}
          >
            <div className="min-w-0" hidden={section !== "dotenv"}>
              <EnvironmentView
                actions={dotenv.actions}
                addingGrant={dotenv.addingGrant}
                choosingNewFile={dotenv.choosingNewFile}
                directory={dotenv.directory}
                editor={{
                  actions: dotenv.editor.controller,
                  check: dotenv.editor.check,
                  focus: dotenv.editFocus,
                  state: dotenv.editor.state,
                }}
                grantNotice={dotenv.grantNotice}
                grants={dotenv.state.grants}
                patternsText={dotenv.state.patternsText}
                recursive={dotenv.state.recursive}
                selectedGrant={dotenv.selectedGrant}
              />
            </div>
            <div className="min-w-0" hidden={section !== "zsh"}>
              <PageRegion>{zshOpened ? <ZshPage /> : null}</PageRegion>
            </div>
            <div className="min-w-0" hidden={section !== "launchctl"}>
              <PageRegion>{launchctlOpened ? <LaunchctlPage /> : null}</PageRegion>
            </div>
          </div>
        </div>
      </PageShell>
    </div>
  );
}
