import sharp from 'sharp';
import type { StudioContent } from '../../shared/studio';
import { editorialBrandForChannel, editorialTemplateForKey, editorialTemplateOptions } from '../../shared/editorialTemplates';
import { buildNotionCanvaPptx, type NotionCanvaDocument, type NotionCanvaPhoto } from './notionCanva';
import { CanvaRestError } from './canvaRest';
import { HttpError } from '../routes/util';

/** The four-panel workspace uses the same current cover, interiors and closing card. */
export function studioCurrentDocument(content: StudioContent, brandName: string) {
  const current = editorialTemplateForKey(content.exportDesign);
  if (!current) throw new HttpError(400, '현재 공통 템플릿을 선택해 주세요.');
  const channel = {slug: content.channel, name: brandName};
  const kit = editorialTemplateOptions(channel).find(kit => kit.colorId === current.colorId)!;
  const document: NotionCanvaDocument = {
    title: content.title, coverStyle: 'A', category: content.subcategory || kit.category, categoryColor: kit.color,
    pages: [
      {title: content.title, ...(content.panels[0].imageId ? {imageId: String(content.panels[0].imageId)} : {}), sourceLabel: content.sourceLabel},
      ...content.panels.map((panel, i) => ({
        title: `핵심 이야기 ${String(i + 1).padStart(2, '0')}`,
        body: panel.dialogue, interiorTemplate: panel.imageId ? 'image_text' as const : 'text' as const,
        ...(panel.imageId ? {imageId: String(panel.imageId)} : {}), sourceLabel: content.sourceLabel,
      })),
    ],
  };
  return {document, brand: editorialBrandForChannel(channel), soft: kit.soft};
}

export function createStudioCurrentRenderer(content: StudioContent, version: number, brandName: string, images: ReadonlyMap<number, Buffer>) {
  const {document, brand, soft} = studioCurrentDocument(content, brandName);
  const pageCount = document.pages.length + 1;
  const page = async (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= pageCount) throw new HttpError(400, '내보낼 페이지를 확인하세요.');
    const photos: NotionCanvaPhoto[] = [];
    for (const id of new Set(document.pages.map(page => page.imageId).filter(Boolean))) {
      const bytes = images.get(Number(id));
      if (!bytes) throw new HttpError(400, '이 콘텐츠의 그림을 찾을 수 없습니다.');
      photos.push({id: id!, bytes: await sharp(bytes, {limitInputPixels: 40_000_000}).rotate().png().toBuffer(), mimeType: 'image/png'});
    }
    try {
      const result = await buildNotionCanvaPptx(document, photos, {previewPage: index, previewOnly: true, brand, soft});
      if (!result.previewSvg || result.pageCount !== pageCount) throw new HttpError(500, '출력 페이지 수를 확인해 주세요.');
      return sharp(Buffer.from(result.previewSvg)).flatten({background: '#ffffff'}).png().toBuffer();
    } catch (error) {
      if (error instanceof CanvaRestError && error.status === 422) throw new HttpError(422, error.message);
      throw error;
    }
  };
  return {version, content, pageCount, page};
}
