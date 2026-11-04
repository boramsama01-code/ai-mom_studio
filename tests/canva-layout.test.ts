import { describe, expect, it } from 'vitest';
import { assertCanvaDesignSettings } from '../server/services/canvaEditorialAssets';
import { familyDialogueMetadataFixture } from './fixtures/familyDialogueCard';

describe('Canva fixed master design options',()=>{
  it('accepts the shared dark defaults without modifying saved choices',()=>{
    const designs=familyDialogueMetadataFixture(1).pageDesigns,before=structuredClone(designs);
    expect(()=>assertCanvaDesignSettings(designs)).not.toThrow();expect(designs).toEqual(before);
  });
  it.each(['white_mode','light_color','outro_image','outro_color','outro_alignment'])('rejects %s before an external write while preserving the draft',kind=>{
    const designs=familyDialogueMetadataFixture(1).pageDesigns;
    if(kind==='white_mode')designs.news_summary.background.kind='none';
    if(kind==='light_color')designs.discussion.background.color='#ffffff';
    if(kind==='outro_image'){designs.outro.background.kind='image';designs.outro.background.assetId=101;}
    if(kind==='outro_color')designs.outro.background.color='#ffffff';
    if(kind==='outro_alignment')designs.outro.alignment='left';
    const before=structuredClone(designs);
    expect(()=>assertCanvaDesignSettings(designs)).toThrow();expect(designs).toEqual(before);
  });
  it('does not discard an unused previous image or silently change its crop settings',()=>{
    const designs=familyDialogueMetadataFixture(1).pageDesigns;
    designs.outro.background.assetId=102;designs.outro.background.brightness=140;
    const before=structuredClone(designs);expect(()=>assertCanvaDesignSettings(designs)).not.toThrow();expect(designs).toEqual(before);
  });
});
