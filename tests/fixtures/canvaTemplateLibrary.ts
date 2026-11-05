import type { CanvaLibraryItem, CanvaTemplateLibraryState } from "../../shared/canvaTemplateLibrary";

export function canvaLibraryItemFixture(overrides: Partial<CanvaLibraryItem> = {}): CanvaLibraryItem {
  const designId = overrides.designId ?? "Dlibrary_first";
  const updatedAt = overrides.updatedAt ?? 1793836800;
  const preview = (page: number) => `/api/canva/template-library/designs/${designId}/preview?page=${page}&v=${updatedAt}`;
  return {
    id: designId, key: `canva:${designId}`, designId, title: "Canva 기본 8장",
    sourceType: "design", pageCount: 8, updatedAt, syncedAt: "2026-11-05T00:00:00.000Z",
    editUrl: `https://www.canva.com/design/${designId}/edit`, thumbnailUrl: preview(0),
    pages: Array.from({ length: 8 }, (_, index) => ({ pageNumber: index + 1, width: 1080, height: 1350, previewUrl: preview(index) })),
    status: "ready", reason: null, canCreate: true, previewStatus: "ready", ...overrides,
  };
}

export function canvaLibraryStateFixture(overrides: Partial<CanvaTemplateLibraryState> = {}): CanvaTemplateLibraryState {
  return {
    configured: true, connected: true, autofill: true, folderId: "FAHZ9dTp-H8", folderName: "Studio 템플릿",
    folderUrl: "https://www.canva.com/folder/FAHZ9dTp-H8", enabled: true, syncIntervalSeconds: 120,
    lastSyncedAt: "2026-11-05T00:00:00.000Z", syncStatus: "ready", errorCode: null, message: null,
    items: [], ...overrides,
  };
}
