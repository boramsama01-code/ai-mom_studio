import { describe, expect, it } from 'vitest';
import { currentTemplateDefault } from '../shared/currentTemplateDefaults';

describe('new-work current template defaults', () => {
  it('uses current common colors for Alligodang and user-created channels', () => {
    expect(currentTemplateDefault({slug:'current-dialogue',accentColor:'#285FAD'})).toBe('editorial:cyan');
    expect(currentTemplateDefault({slug:'my-new-channel',accentColor:'#72a7ff'})).toBe('editorial:blue');
    expect(currentTemplateDefault({slug:'fryday',accentColor:'#FFD166'})).toBe('editorial:yellow');
  });
  it('keeps the existing HighScoop master aliases for new HighScoop work', () => {
    expect(currentTemplateDefault({slug:'opportunities'})).toBe('highscoop:gifted');
    expect(currentTemplateDefault({slug:'highscoop',accentColor:'#57C7E3'})).toBe('highscoop:news');
  });
});
