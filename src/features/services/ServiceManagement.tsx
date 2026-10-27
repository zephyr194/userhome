import { useState } from "react";
import { Button, Modal, Panel } from "../../components/ui";
import { localizeError } from "../../i18n/errors";
import { useLocale, useT } from "../../i18n/useLocale";
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
    <ul className="mt-ui-4 grid gap-ui-4 text-sm text-muted-foreground">
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
  const t = useT();
  const locale = useLocale();
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
      bodyClassName="grid gap-ui-16"
      busy={busy}
      className="max-w-[560px]"
      footer={
        <>
          <Button data-modal-cancel disabled={busy} onClick={onClose} variant="default">
            {t("common.cancel")}
          </Button>
          <Button disabled={busy} onClick={confirm} variant="danger">
            {t("services.management.releaseConfirm")}
          </Button>
        </>
      }
      onClose={busy ? () => undefined : onClose}
      open
      titleId="release-adoption-heading"
    >
      <div className="min-w-0">
        <h3 className="break-words [overflow-wrap:anywhere]" id="release-adoption-heading">
          {t("services.management.releaseTitle", { label })}
        </h3>
      </div>
      <p className="text-sm">
        {t("services.management.releaseScope")}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("services.management.releaseEffect")}
      </p>
      {error ? (
        <p className="break-words text-sm text-danger" role="alert">
          {localizeError(error, locale)}
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
  const t = useT();
  const [open, setOpen] = useState<OpenDialog>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const view = managementOf(service, t);
  if (view.kind === "none") return null;

  const close = () => setOpen(undefined);
  const openDialog = (next: OpenDialog) => {
    setNotice(undefined);
    setOpen(next);
  };

  return (
    <Panel aria-labelledby="service-management-heading" className="min-w-0">
      <header className="border-b border-border px-ui-16 py-ui-12">
        <h3 className="text-sm font-semibold" id="service-management-heading">
          {t("services.management.heading")}
        </h3>
      </header>
      <div className="grid gap-ui-8 px-ui-16 py-ui-12">
        {view.kind === "adopt" ? (
          <>
            <p className="text-sm">
              {t("services.management.adoptIntro")}
            </p>
            <div>
              <Button onClick={() => openDialog("adopt")} variant="primary">
                {t("services.management.adopt")}
              </Button>
            </div>
          </>
        ) : null}

        {view.kind === "adoptBlocked" ? (
          <>
            <p className="text-sm">{t("services.management.adoptBlocked")}</p>
            <ReasonList reasons={view.reasons} />
          </>
        ) : null}

        {view.kind === "adopted" ? (
          <>
            <p className="text-sm">{t("services.management.adopted")}</p>
            {view.editBlockers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("services.management.editHint")}
              </p>
            ) : (
              <>
                <p className="text-sm">{t("services.management.editBlocked")}</p>
                <ReasonList reasons={view.editBlockers} />
              </>
            )}
            <div className="flex flex-wrap gap-ui-8">
              {view.editBlockers.length === 0 ? (
                <Button onClick={() => openDialog("edit")} variant="primary">
                  {t("services.management.edit")}
                </Button>
              ) : null}
              <Button onClick={() => openDialog("release")} variant="default">
                {t("services.management.release")}
              </Button>
            </div>
          </>
        ) : null}

        {notice && open === undefined ? (
          <p className="text-sm text-success" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}
      </div>

      {open === "adopt" ? (
        <AdoptServiceDialog
          label={service.label}
          onAdopted={(execution) => {
            setNotice(describeAdoptSuccess(execution, t).title);
            onChanged();
          }}
          onClose={close}
        />
      ) : null}
      {open === "edit" ? (
        <EditServiceDialog
          onClose={close}
          onSaved={(execution) => {
            if (wasSaved(execution)) setNotice(describeEditOutcome(execution, t).title);
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
                ? t("services.management.releasedNotice", { label: outcome.label })
                : t("services.management.releaseMissing"),
            );
            onChanged();
          }}
        />
      ) : null}
    </Panel>
  );
}
