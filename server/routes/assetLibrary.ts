import { Router } from 'express';
import { z } from 'zod';
import { assetLibraryQuerySchema } from '../../shared/assetLibrary';
import { getDb } from '../db';
import { ah, parse } from './util';
import { assetLibraryStudioRevision, assetLibraryVideoPreview, listAssetLibrary } from '../services/assetLibrary';

export const assetLibraryRoutes = Router();
const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
assetLibraryRoutes.get('/assets/library', ah(async (req,res) => {
  res.set('Cache-Control','private, no-store').json(await listAssetLibrary(getDb(),parse(assetLibraryQuerySchema,req.query)));
}));
assetLibraryRoutes.get('/assets/library/videos/:id/preview', ah(async (req,res) => {
  const bytes = await assetLibraryVideoPreview(getDb(),parse(id,req.params.id));
  res.type('image/jpeg').set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff').send(bytes);
}));
assetLibraryRoutes.get('/studio/cards/:cardId/revisions/:revisionId', ah(async (req,res) => {
  res.set('Cache-Control','private, no-store').json(await assetLibraryStudioRevision(getDb(),parse(id,req.params.cardId),parse(id,req.params.revisionId)));
}));
