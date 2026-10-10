# Spec: service-management

Status: Approved on 2026-09-20

## Objective

Manage Caddy configuration and allowlisted Homebrew service lifecycle actions,
using normal user-level service commands when possible and controlled elevation
only when required.

## MVP Service Scope

- Deep integration: Caddy.
- Inventory-only recognition: other entries returned by `brew services list`,
  including the baseline Unbound service.
- Service actions: start, stop, restart.
- Service status refresh after every action.
- Caddy configuration validation before write or restart.

## Caddy Workflow

1. Resolve Caddy from the catalog and detected Homebrew prefix.
2. Read the Caddyfile through `config-management`.
3. Validate candidate content with the resolved Caddy executable and an
   allowlisted argument shape.
4. Write only after successful validation and confirmation.
5. Preview start, stop, or restart separately from the config write.
6. Refresh service state and surface the exact outcome.

Config write and service restart are two explicit operations. A valid write does
not silently restart a service.

## Elevation Policy

- Prefer user-level `brew services` actions.
- Use the privileged helper only for a catalog-declared system-level service or
  protected path.
- The preview clearly marks elevation and the exact service/resource ID.
- The helper maps the ID to a compiled allowlist. It does not receive `brew`,
  `launchctl`, or filesystem arguments from the frontend.
- If the signed helper is unavailable, elevated actions are disabled while
  read-only status remains available.

## Interfaces

```text
list_services() -> ServiceSummary[]
get_service(serviceId) -> ServiceDetails
preview_service_action(action) -> OperationPreview
execute_service_action(operationId) -> OperationDetails
validate_service_config(input) -> ValidationResult
```

## Acceptance Criteria

- Caddy 2.11.4 is detected on the baseline machine without hard-coding its
  version.
- Invalid Caddy configuration cannot be written or used for restart.
- Starting, stopping, and restarting require separate previews and confirmation.
- Service state is refreshed after an action and does not report success solely
  from process exit code.
- User-level actions do not invoke the privileged helper.
- System-level actions fail closed when helper signing, registration,
  authorization, or request validation fails.
- Unrecognized services are read-only.

## Boundaries

- Always: validate config separately from service mutation.
- Ask first: enable mutation for a service other than Caddy.
- Never: accept arbitrary launchd labels, plist paths, or service commands.
