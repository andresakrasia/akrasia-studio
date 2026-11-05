import type { PublicService } from './public-content';
import type { PublicCaseStudy, PublicProject } from './public-projects';

const filled = (value: string) => Boolean(value.trim());
const translatedBlocks = (original: Record<string, string>[], translation: Record<string, string>[]) =>
  original.length === translation.length && original.every((block, index) =>
    ['title', 'description'].every(key => !filled(block[key] || '') || filled(translation[index]?.[key] || '')));

/** Advertise language alternatives only when the published editorial content is translated. */
export function serviceHasEnglish(service: PublicService): boolean {
  return filled(service.title_en) && (['description', 'tagline', 'hero_description'] as const).every(key =>
    !filled(service[key]) || filled(service[`${key}_en`])) &&
    translatedBlocks(service.features, service.features_en) && translatedBlocks(service.process, service.process_en);
}

/** A title by itself is a catalogue entry, not a useful search landing page. */
export function serviceIsIndexable(service: PublicService): boolean {
  return (filled(service.hero_description) || filled(service.description)) &&
    [...service.features, ...service.process].some(block => filled(block.description || ''));
}

const completeCaseStudy = (study: PublicCaseStudy) =>
  [study.brief, study.process, study.result].every(filled);

export function projectHasEnglish(project: PublicProject): boolean {
  return completeCaseStudy(project.case_study_en) &&
    (project.case_study.services.length === 0 || project.case_study_en.services.length === project.case_study.services.length) &&
    project.case_study_en.services.every(filled);
}

export function projectIsIndexable(project: PublicProject): boolean {
  return completeCaseStudy(project.case_study);
}

export function metaDescription(value: string): string {
  const text = value.trim().replace(/\s+/gu, ' ');
  return text.length > 180 ? text.slice(0, 177).trimEnd() + '…' : text;
}
