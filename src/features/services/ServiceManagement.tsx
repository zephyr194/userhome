import { useState } from "react";
import { Button, Modal, Panel } from "../../components/ui";
import { decodeAppError, type AppError } from "../../ipc/core";
import {
  releaseAdoption,
  type ReleaseOutcome,
} from "../../ipc/servicesAdopt";
import type { LaunchdService } from "../../ipc/services";
import { AdoptServiceDialog } from "./AdoptServiceDialog";
import { EditServiceDialog } from "./EditServiceDialog";
import {
  describeAdoptSuccess,
  managementOf,
} from "./adoptServiceModel";
import { wasSaved, describeEditOutcome } from "./editServiceModel";

type OpenDialog = "adopt" | "edit" | "release" | undefined;

function ReasonList({ reasons }: { reasons: readonly string[] }) {
  return (
    <ul className="mt-ui-xs grid gap-ui-xs text-sm text-muted-foreground">
      {reasons.map((reason) => (
        <li className="break-words [overflow-wrap:anywhere]" key={reason}>
          {reason}
        </li>
      ))}
    </ul>
  );
}

function ReleaseAdoptionDialog({
  label,
  onClose,
  onReleased,
}: {
  label: string;
  onClose: () => void;
  onReleased: (outcome: ReleaseOutcome) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | undefined>();

  const confirm = () => {
    setBusy(true);
    setError(undefined);
    void releaseAdoption({ domain: "GUI", label })
      .then((outcome) => onReleased(outcome))
      .catch((failure: unknown) => {
        setBusy(false);
        setError(decodeAppError(failure));
      });
  };

  return (
    <Modal
      bodyClassName="grid gap-ui-3xl"
      busy={busy}
      className="max-w-[560px]"
      footer={
        <>
          <Button data-modal-cancel disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy} onClick={confirm} variant="danger">
            确认取消接管
          </Button>
        </>
      }
      onClose={busy ? () => undefined : onClose}
      open
      titleId="release-adoption-heading"
    >
      <div className="min-w-0">
        <h3 className="break-words [overflow-wrap:anywhere]" id="release-adoption-heading">
          取消接管 {label}
        </h3>
      </div>
      <p className="text-sm">
        只删除 UserHome 的接管记录。不修改 plist 文件，也不停止或卸载任务。
      </p>
      <p className="text-sm text-muted-foreground">
        取消后，该任务重新只是当前用户的任务，不能再通过 UserHome 编辑。
      </p>
      {error ? (
        <p className="break-words text-sm text-danger" role="alert">
          {error.message}
        </p>
      ) : null}
    </Modal>
  );
}

/**
 * The adoption and edit entries of one job, shown beside its details. A job
 * that may be adopted gets the adopt button; one that may not gets the reasons
 * as text. An adopted job gets edit (when its verdict allows it) and release.
 * Every other job gets nothing here.
 */
export function ServiceManagement({
  onChanged,
  service,
}: {
  onChanged: () => void;
  service: LaunchdService;
}) {
  const [open, setOpen] = useState<OpenDialog>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const view = managementOf(service);
  if (view.kind === "none") return null;

  const close = () => setOpen(undefined);

  return (
    <Panel aria-labelledby="service-management-heading" className="min-w-0">
      <header className="border-b border-border px-ui-3xl py-ui-xl">
        <h3 className="text-sm font-semibold" id="service-management-heading">
          接管与编辑
        </h3>
      </header>
      <div className="grid gap-ui-md px-ui-3xl py-ui-xl">
        {view.kind === "adopt" ? (
          <>
            <p className="text-sm">
              这是当前用户自己的任务，尚未被 UserHome 接管。接管只记录所有权，不修改 plist，也不加载或重启任务。
            </p>
            <div>
              <Button onClick={() => setOpen("adopt")} variant="primary">
                接管
              </Button>
            </div>
          </>
        ) : null}

        {view.kind === "adoptBlocked" ? (
          <>
            <p className="text-sm">这个任务不能接管：</p>
            <ReasonList reasons={view.reasons} />
          </>
        ) : null}

        {view.kind === "adopted" ? (
          <>
            <p className="text-sm">已由 UserHome 接管。</p>
            {view.editBlockers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                编辑会先预览再保存，保存后需重新加载任务才生效。
              </p>
            ) : (
              <>
                <p className="text-sm">这个任务当前不能编辑：</p>
                <ReasonList reasons={view.editBlockers} />
              </>
            )}
            <div className="flex flex-wrap gap-ui-md">
              {view.editBlockers.length === 0 ? (
                <Button onClick={() => setOpen("edit")} variant="primary">
                  编辑
                </Button>
              ) : null}
              <Button onClick={() => setOpen("release")}>取消接管</Button>
            </div>
          </>
        ) : null}

        {notice ? (
          <p className="text-sm text-success" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}
      </div>

      {open === "adopt" ? (
        <AdoptServiceDialog
          label={service.label}
          onAdopted={(execution) => {
            setNotice(describeAdoptSuccess(execution).title);
            onChanged();
          }}
          onClose={close}
        />
      ) : null}
      {open === "edit" ? (
        <EditServiceDialog
          onClose={close}
          onSaved={(execution) => {
            if (wasSaved(execution)) setNotice(describeEditOutcome(execution).title);
            onChanged();
          }}
          service={service}
        />
      ) : null}
      {open === "release" ? (
        <ReleaseAdoptionDialog
          label={service.label}
          onClose={close}
          onReleased={(outcome) => {
            setOpen(undefined);
            setNotice(
              outcome.released
                ? `已取消接管 ${outcome.label}：接管记录已删除，plist 与任务未改动。`
                : "没有找到接管记录，未做任何改动。",
            );
            onChanged();
          }}
        />
      ) : null}
    </Panel>
  );
}
