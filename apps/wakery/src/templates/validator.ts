export interface WakeMessageTemplate {
  composition: string;
  stateBlocks: Record<string, string> & { default: string };
  commentLengths: Record<string, string>;
}

// The re-wake template (spec_wakery-rewake-message.md): a single composition
// body — the wake-message composition with the re-wake header, the
// settled-holds placeholder, and the re-wake preamble. State blocks and
// comment-length hints are shared with the wake message (the task's state has
// not changed, so the same state's duties apply), so the artifact carries no
// blocks of its own.
export interface RewakeMessageTemplate {
  composition: string;
}

// The govern-notice template (spec_wakery-govern-notice-message.md): the
// notification cue turn for a state-based Govern arrival
// (milestone_govern-notice_v2026.08.05). A single composition body — no state
// blocks (the one duty is state-independent across both gates) and no
// comment-length hints (the turn posts no transition comment).
export interface GovernNoticeMessageTemplate {
  composition: string;
}

// The cap-alert template (spec_wakery-cap-alert-message.md, self-healing F2b):
// the one-duty delivery turn dispatched when a wake reaches the re-wake cap —
// report the blockage and its cause to the Principal, then end. Composition
// only, like the other notice turns.
export interface CapAlertMessageTemplate {
  composition: string;
}

// The stall-notice template (spec_wakery-stall-notice-message.md, self-healing
// F2): the one-duty confession turn for a project-level full stop — send the
// stall notice to the Principal, then end. Composition only.
export interface StallNoticeMessageTemplate {
  composition: string;
}

export type TemplateName =
  | 'wake-message'
  | 'rewake-message'
  | 'govern-notice-message'
  | 'cap-alert-message'
  | 'stall-notice-message';

export class TemplateValidationError extends Error {
  constructor(
    public readonly templateName: string,
    public readonly missingKey: string,
    detail?: string
  ) {
    super(`template ${templateName} failed validation: missing or invalid ${missingKey}${detail ? ` (${detail})` : ''}`);
    this.name = 'TemplateValidationError';
  }
}

type CompositionOnlyName = 'rewake-message' | 'govern-notice-message' | 'cap-alert-message' | 'stall-notice-message';
type AnyTemplate = WakeMessageTemplate | RewakeMessageTemplate | GovernNoticeMessageTemplate | CapAlertMessageTemplate | StallNoticeMessageTemplate;

export function validateTemplate(templateName: 'wake-message', parsed: unknown): WakeMessageTemplate;
export function validateTemplate(templateName: 'rewake-message', parsed: unknown): RewakeMessageTemplate;
export function validateTemplate(templateName: 'govern-notice-message', parsed: unknown): GovernNoticeMessageTemplate;
export function validateTemplate(templateName: 'cap-alert-message', parsed: unknown): CapAlertMessageTemplate;
export function validateTemplate(templateName: 'stall-notice-message', parsed: unknown): StallNoticeMessageTemplate;
export function validateTemplate(templateName: string, parsed: unknown): AnyTemplate;
export function validateTemplate(templateName: string, parsed: unknown): AnyTemplate {
  if (templateName === 'wake-message') return validateWakeMessage(parsed);
  if (templateName === 'rewake-message' || templateName === 'govern-notice-message' || templateName === 'cap-alert-message' || templateName === 'stall-notice-message') {
    return validateCompositionOnly(templateName, parsed);
  }
  throw new TemplateValidationError(templateName, 'template-name', `unknown template name: ${templateName}`);
}

function validateWakeMessage(parsed: unknown): WakeMessageTemplate {
  if (!isObject(parsed)) {
    throw new TemplateValidationError('wake-message', 'root', 'expected a JSON object');
  }
  if (typeof parsed.composition !== 'string') {
    throw new TemplateValidationError('wake-message', 'composition', 'expected string');
  }
  if (!isObject(parsed.stateBlocks)) {
    throw new TemplateValidationError('wake-message', 'stateBlocks', 'expected object');
  }
  if (typeof parsed.stateBlocks.default !== 'string') {
    throw new TemplateValidationError('wake-message', 'stateBlocks.default', 'expected string');
  }
  for (const [k, v] of Object.entries(parsed.stateBlocks)) {
    if (typeof v !== 'string') {
      throw new TemplateValidationError('wake-message', `stateBlocks.${k}`, 'expected string');
    }
  }
  if (!isObject(parsed.commentLengths)) {
    throw new TemplateValidationError('wake-message', 'commentLengths', 'expected object');
  }
  for (const [k, v] of Object.entries(parsed.commentLengths)) {
    if (typeof v !== 'string') {
      throw new TemplateValidationError('wake-message', `commentLengths.${k}`, 'expected string');
    }
  }
  return parsed as unknown as WakeMessageTemplate;
}

function validateCompositionOnly(name: CompositionOnlyName, parsed: unknown): RewakeMessageTemplate & GovernNoticeMessageTemplate & CapAlertMessageTemplate & StallNoticeMessageTemplate {
  if (!isObject(parsed)) {
    throw new TemplateValidationError(name, 'root', 'expected a JSON object');
  }
  if (typeof parsed.composition !== 'string') {
    throw new TemplateValidationError(name, 'composition', 'expected string');
  }
  return parsed as unknown as RewakeMessageTemplate & GovernNoticeMessageTemplate & CapAlertMessageTemplate & StallNoticeMessageTemplate;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
