import { editorialTemplateOptions, type EditorialChannel } from './editorialTemplates';

/** A new channel uses the current common kit; saved manuscripts keep their own keys. */
export function currentTemplateDefault(channel: EditorialChannel & { accentColor?: string | null }): string {
  const options = editorialTemplateOptions(channel);
  return (options.find(option => option.color.toUpperCase() === channel.accentColor?.toUpperCase()) ?? options[0]).key;
}
