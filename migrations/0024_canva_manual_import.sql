-- Existing manual copies do not claim an Autofill master or dataset binding.
ALTER TABLE canva_render_jobs ALTER COLUMN master_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE canva_render_jobs ADD CONSTRAINT canva_render_master_or_manual_copy
  CHECK (master_id IS NOT NULL OR COALESCE(
    purpose IN ('import', 'caption_rebind')
    AND input->>'mappingVersion' = 'canva-manual-copy/1'
    AND input->'manualImport'->>'kind' = 'manual_copy'
    AND input->'manualImport'->>'designId' = design_id,
    false));
