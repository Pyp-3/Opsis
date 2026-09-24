/**
 * Externalised UI strings (PROMPT.md §12.4). MVP ships English only; every user-visible
 * string in the web app comes from a message catalogue so other locales can be added by
 * supplying another `Messages` object. `{name}` placeholders are filled by `format`.
 */
export const en = {
  'app.title': 'Opsis',
  'app.tagline': 'See what you mean.',
  'app.skipToDiagram': 'Skip to diagram',

  'input.region': 'Draw a sentence',
  'input.label': 'Type a sentence to see it as a diagram',
  'input.placeholder': 'e.g. A sandwich can contain bread, tomato, ham.',
  'input.submit': 'Draw it',
  'input.cancel': 'Cancel',
  'input.counter': '{count} of {max} characters',
  'input.tooLong': 'Please keep it under {max} characters.',
  'input.empty': 'Type a sentence first.',

  'progress.label': 'Building your diagram',
  'progress.parsing': 'Reading the sentence',
  'progress.mapping': 'Choosing pictures',
  'progress.layout': 'Arranging the diagram',
  'progress.done': 'Done',
  'progress.stepDone': 'done',
  'progress.stepActive': 'in progress',
  'progress.stepPending': 'waiting',

  'onboarding.title': 'Try one of these',
  'onboarding.body':
    'Opsis turns a sentence into a picture you can explore. Click a part to learn about it, explode a whole into its parts, and open any part to go deeper.',
  'onboarding.keys':
    'Keyboard: Tab to move through parts, Enter for a summary, Shift+Enter to explain more, E to explode, O to open a part, Backspace to go back.',

  'state.loadingDiagram': 'Loading diagram…',
  'state.loading3d': 'Loading 3D view…',
  'state.loading2d': 'Loading 2D editor…',
  'state.error': 'Something went wrong',
  'state.retry': 'Try again',
  'state.dismiss': 'Dismiss',
  'state.noScenes': 'This diagram has no scenes.',
  'state.network': 'Opsis could not reach the server. Check your connection and try again.',
  'state.unexpected': 'Opsis received an unexpected reply from the server.',

  'toolbar.label': 'Diagram controls',
  'toolbar.explode': 'Explode',
  'toolbar.assemble': 'Assemble',
  'toolbar.zoomToFit': 'Zoom to fit',
  'toolbar.view3d': '3D',
  'toolbar.view2d': '2D',
  'toolbar.viewLabel': 'View',
  'toolbar.comingSoon': 'Coming soon',
  'toolbar.export': 'Export',
  'toolbar.readingLevel': 'Reading level',
  'toolbar.colorBlind': 'Colour-blind-safe colours',
  'toolbar.reduceMotion': 'Reduce motion',

  'canvas.editRegion': 'Edit {title}',
  'canvas.toolbar': '2D editing controls',
  'canvas.nodeLabel': 'Node label',
  'canvas.labelFor': 'Label for {label}',
  'canvas.main': 'main',
  'canvas.optional': 'optional',
  'canvas.newIdea': 'New idea',
  'canvas.addNode': 'Add node',
  'canvas.add': 'Add',
  'canvas.deleteSelected': 'Delete selected',
  'canvas.undo': 'Undo',
  'canvas.redo': 'Redo',
  'canvas.save': 'Save',
  'canvas.share': 'Share',
  'canvas.undoDone': 'Edit undone.',
  'canvas.redoDone': 'Edit restored.',
  'canvas.saved': 'Saved.',
  'canvas.shareCopied': 'Read-only link copied: {url}',
  'canvas.minimap': 'Diagram minimap',
  'canvas.addedSummary': '{label} was added to this diagram.',
  'canvas.present': 'Present',
  'canvas.presentationControls': 'Presentation controls',
  'canvas.previousStep': 'Previous step',
  'canvas.nextStep': 'Next step',
  'canvas.play': 'Play presentation',
  'canvas.pause': 'Pause presentation',
  'canvas.replay': 'Replay',
  'canvas.scrub': 'Presentation step',
  'canvas.exitPresentation': 'Exit presentation',

  'export.group': 'Export diagram',
  'export.action': 'Export {format}',
  'export.inProgress': 'Exporting…',
  'export.pngUnsupported': 'PNG export is not supported by this browser.',
  'export.pngFailed': 'Could not create PNG.',
  'export.glbFailed': 'Could not create a binary GLB.',

  'audience.child': 'Child',
  'audience.teen': 'Teen',
  'audience.adult': 'Adult',

  'breadcrumbs.label': 'Diagram path',

  'outline.title': 'Diagram as list',
  'outline.optional': 'optional',
  'outline.anchor': 'main',
  'outline.relations': 'Connections',
  'outline.relation': '{from} {verb} {to}',
  'outline.relationLabelled': '{from} {verb} {to} ({label})',
  'edge.arrow': 'leads to',
  'edge.line': 'is linked to',
  'edge.containment': 'contains',
  'edge.path': 'moves towards',

  'panel.close': 'Close panel',
  'panel.tabs': 'About this part',
  'panel.summary': 'Summary',
  'panel.explanation': 'Explanation',
  'panel.explainMore': 'Explain more',
  'panel.open': 'Open',
  'panel.openHint': 'See {label} as its own diagram',
  'panel.loading': 'Loading…',
  'panel.error': 'Could not load this explanation.',
  'panel.saveForExplanation': 'Save this diagram to explain a new node.',
  'panel.optionalBadge': 'optional',
  'panel.optionalHint': 'The sentence says “can”: this part is possible, not required.',
  'panel.unsure': 'Unsure',
  'panel.unsureHint': 'Opsis is not confident about this. Check another source.',
  'panel.whatItIs': 'What it is',
  'panel.whyItMattersHere': 'Why it matters here',
  'panel.howItWorks': 'How it works',
  'panel.funFact': 'Fun fact',
  'panel.commonMisconception': 'Did you know?',
  'panel.suggested': 'Parts you could open',

  'note.misconception': 'Did you know?',
  'note.nuance': 'Did you know?',
  'note.safety': 'Stay safe',
  'note.ambiguity': 'This could mean more than one thing',
  'note.other': 'Note',
} as const;

/** A message id. */
export type MessageKey = keyof typeof en;

/** A complete catalogue for one locale. */
export type Messages = Readonly<Record<MessageKey, string>>;

/** Shipped locales. */
export const MESSAGES: Readonly<Record<'en', Messages>> = { en };

/** Fills `{name}` placeholders; unknown placeholders are left as written. */
export function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** A translator bound to one catalogue. */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Creates a translator for `messages`. */
export function createTranslator(messages: Messages = en): Translate {
  return (key, params) => format(messages[key], params);
}

/** English translator used by the MVP. */
export const t: Translate = createTranslator(en);
