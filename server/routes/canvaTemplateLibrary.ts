import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { ah, parse, HttpError } from './util';
import { configureCanvaLibrary, getCanvaLibraryPreview, getCanvaTemplateLibrary, resetCanvaLibraryBackoff } from '../services/canvaTemplateLibrary';
import { kickCanvaLibrary } from '../worker/canvaLibrary';

export const canvaTemplateLibraryRoutes=Router();
canvaTemplateLibraryRoutes.get('/canva/template-library',ah(async(_req,res)=>{
  kickCanvaLibrary(getDb());res.json(await getCanvaTemplateLibrary(getDb()));
}));
canvaTemplateLibraryRoutes.put('/canva/template-library',ah(async(req,res)=>{
  const body=parse(z.object({folderId:z.string().trim().min(1).max(2048),enabled:z.boolean()}).strict(),req.body);
  await configureCanvaLibrary(getDb(),body);kickCanvaLibrary(getDb());res.json(await getCanvaTemplateLibrary(getDb()));
}));
canvaTemplateLibraryRoutes.post('/canva/template-library/sync',ah(async(req,res)=>{
  parse(z.object({}).strict(),req.body??{});await resetCanvaLibraryBackoff(getDb());kickCanvaLibrary(getDb());res.status(202).json(await getCanvaTemplateLibrary(getDb()));
}));
canvaTemplateLibraryRoutes.get('/canva/template-library/designs/:id/preview',ah(async(req,res)=>{
  const id=parse(z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),req.params.id),page=parse(z.coerce.number().int().min(0).max(19),req.query.page??0);
  const preview=await getCanvaLibraryPreview(getDb(),id,page);if(!preview)throw new HttpError(404,'저장된 Canva 미리보기가 아직 없습니다.');
  const etag=`"${preview.sha256}"`;
  res.set({'Content-Type':preview.mime,'Cache-Control':'private, max-age=30','ETag':etag,'X-Content-Type-Options':'nosniff'});
  if(req.headers['if-none-match']===etag){res.status(304).end();return;}res.send(preview.bytes);
}));
