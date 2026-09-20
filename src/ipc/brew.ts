import { createInternalError, invokeCommand, isRecord } from "./core";
import {
  decodeOperationDetails,
  decodeOperationPreview,
  type OperationDetails,
  type OperationPreview,
} from "./operations";

const MAX_PAGE_SIZE = 100;
const MAX_TEXT_BYTES = 2 * 1024;

export type BrewPackageKind = "FORMULA" | "CASK";

export interface BrewPackage {
  kind: BrewPackageKind;
  identifier: string;
  displayName: string;
  description?: string;
  installedVersions: readonly string[];
  outdated: boolean;
}

export interface BrewPackageQuery {
  kind?: BrewPackageKind;
  filter?: string;
  page: number;
  pageSize: number;
}

export interface BrewPackagePage {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: readonly BrewPackage[];
}

export interface BrewSearchQuery {
  query: string;
  page: number;
  pageSize: number;
}

export interface BrewSearchResult {
  kind: BrewPackageKind;
  identifier: string;
}

export interface BrewSearchPage {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: readonly BrewSearchResult[];
}

export interface BrewPackageDetails extends BrewPackage {
  homepage?: string;
  currentVersion?: string;
}

export type BrewPackageAction = "INSTALL" | "UPGRADE" | "UNINSTALL";

export interface BrewActionInput {
  action: BrewPackageAction;
  kind: BrewPackageKind;
  identifier: string;
}

function decodeText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).length > MAX_TEXT_BYTES
  ) {
    throw createInternalError();
  }
  return value;
}

function decodeCount(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw createInternalError();
  }
  return value;
}

export function decodeBrewPackage(value: unknown): BrewPackage {
  if (
    !isRecord(value) ||
    !["FORMULA", "CASK"].includes(String(value.kind)) ||
    !Array.isArray(value.installedVersions) ||
    value.installedVersions.length > 64 ||
    typeof value.outdated !== "boolean"
  ) {
    throw createInternalError();
  }
  return {
    kind: value.kind as BrewPackageKind,
    identifier: decodeText(value.identifier),
    displayName: decodeText(value.displayName),
    ...(value.description === undefined || value.description === null
      ? {}
      : { description: decodeText(value.description) }),
    installedVersions: value.installedVersions.map(decodeText),
    outdated: value.outdated,
  };
}

export function decodeBrewPackagePage(value: unknown): BrewPackagePage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw createInternalError();
  }
  const pageSize = decodeCount(value.pageSize, MAX_PAGE_SIZE);
  if (pageSize === 0 || value.items.length > pageSize) {
    throw createInternalError();
  }
  return {
    page: decodeCount(value.page),
    pageSize,
    totalItems: decodeCount(value.totalItems, 20_000),
    totalPages: decodeCount(value.totalPages, 20_000),
    items: value.items.map(decodeBrewPackage),
  };
}

export function decodeBrewSearchPage(value: unknown): BrewSearchPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw createInternalError();
  }
  const pageSize = decodeCount(value.pageSize, MAX_PAGE_SIZE);
  if (pageSize === 0 || value.items.length > pageSize) {
    throw createInternalError();
  }
  return {
    page: decodeCount(value.page),
    pageSize,
    totalItems: decodeCount(value.totalItems, 2_000),
    totalPages: decodeCount(value.totalPages, 2_000),
    items: value.items.map((item) => {
      if (
        !isRecord(item) ||
        !["FORMULA", "CASK"].includes(String(item.kind))
      ) {
        throw createInternalError();
      }
      return {
        kind: item.kind as BrewPackageKind,
        identifier: decodeText(item.identifier),
      };
    }),
  };
}

export function decodeBrewPackageDetails(
  value: unknown,
): BrewPackageDetails {
  const packageValue = decodeBrewPackage(value);
  if (!isRecord(value)) {
    throw createInternalError();
  }
  return {
    ...packageValue,
    ...(value.homepage === undefined || value.homepage === null
      ? {}
      : { homepage: decodeText(value.homepage) }),
    ...(value.currentVersion === undefined || value.currentVersion === null
      ? {}
      : { currentVersion: decodeText(value.currentVersion) }),
  };
}

export function listBrewPackages(
  query: BrewPackageQuery,
): Promise<BrewPackagePage> {
  return invokeCommand("list_brew_packages", decodeBrewPackagePage, { query });
}

export function searchBrewPackages(
  query: BrewSearchQuery,
): Promise<BrewSearchPage> {
  return invokeCommand("search_brew_packages", decodeBrewSearchPage, { query });
}

export function getBrewPackage(
  kind: BrewPackageKind,
  identifier: string,
): Promise<BrewPackageDetails> {
  return invokeCommand("get_brew_package", decodeBrewPackageDetails, {
    kind,
    identifier,
  });
}

export function previewBrewAction(
  input: BrewActionInput,
): Promise<OperationPreview> {
  return invokeCommand("preview_brew_action", decodeOperationPreview, { input });
}

export function executeBrewAction(
  operationId: string,
): Promise<OperationDetails> {
  return invokeCommand("execute_brew_action", decodeOperationDetails, {
    operationId,
  });
}
