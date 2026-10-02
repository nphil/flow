const AUTOMATION_TEXT = {
  namePlaceholder: 'common:placeholders.automationName',
  enterName: 'common:placeholders.enterAutomationName',
  describe: 'common:placeholders.describeAutomation',
  nameLabel: 'common:labels.automationName',
  defaultName: 'common:defaults.newAutomation',
  settingsTitle: 'common:automationSettings.title',
  modeDescription: 'common:automationSettings.modeDescription',
  runSuccess: 'panels:header.runSuccess',
  runFailed: 'panels:header.runFailed',
  duplicated: 'panels:header.duplicated',
  deleted: 'panels:header.deleted',
  deleteFailed: 'panels:header.deleteFailed',
  deleteTitle: 'dialogs:deleteAutomation.title',
  deleteDescription: 'dialogs:deleteAutomation.description',
  deleting: 'dialogs:deleteAutomation.deleting',
  saveTitle: 'dialogs:save.title',
  saveTitleUpdate: 'dialogs:save.titleUpdate',
  saveDescription: 'dialogs:save.description',
  saveDescriptionUpdate: 'dialogs:save.descriptionUpdate',
  saveNameLabel: 'dialogs:save.nameLabel',
  traceSaveFirst: 'dialogs:traceViewer.saveAutomationFirst',
  noTraces: 'dialogs:traceViewer.noTracesFound',
  traceTitle: 'common:labels.automationTrace',
  dirtyDescription: 'dialogs:dirtyGuard.description',
  readabilityEmptyBody: 'panels:readability.emptyBody',
  readabilityEmptyCanvasBody: 'panels:readability.emptyCanvasBody',
} as const;

const SCRIPT_TEXT = {
  namePlaceholder: 'common:placeholders.scriptName',
  enterName: 'common:placeholders.enterScriptName',
  describe: 'common:placeholders.describeScript',
  nameLabel: 'common:labels.scriptName',
  defaultName: 'common:defaults.newScript',
  settingsTitle: 'common:scriptSettings.title',
  modeDescription: 'common:scriptSettings.modeDescription',
  runSuccess: 'panels:header.runScriptSuccess',
  runFailed: 'panels:header.runScriptFailed',
  duplicated: 'panels:header.duplicatedScript',
  deleted: 'panels:header.deletedScript',
  deleteFailed: 'panels:header.deleteScriptFailed',
  deleteTitle: 'dialogs:deleteScript.title',
  deleteDescription: 'dialogs:deleteScript.description',
  deleting: 'dialogs:deleteScript.deleting',
  saveTitle: 'dialogs:save.titleScript',
  saveTitleUpdate: 'dialogs:save.titleUpdateScript',
  saveDescription: 'dialogs:save.descriptionScript',
  saveDescriptionUpdate: 'dialogs:save.descriptionUpdateScript',
  saveNameLabel: 'dialogs:save.nameLabelScript',
  traceSaveFirst: 'dialogs:traceViewer.saveScriptFirst',
  noTraces: 'dialogs:traceViewer.noScriptTracesFound',
  traceTitle: 'common:labels.scriptTrace',
  dirtyDescription: 'dialogs:dirtyGuard.descriptionScript',
  readabilityEmptyBody: 'panels:readability.emptyBodyScript',
  readabilityEmptyCanvasBody: 'panels:readability.emptyCanvasBodyScript',
} as const satisfies Record<keyof typeof AUTOMATION_TEXT, string>;

/**
 * The translation keys whose wording depends on whether the open flow is an automation or a
 * script, in one place: `t(FLOW_TEXT[flowKind].runSuccess)`. The script table must define exactly
 * the names the automation table does, so no screen can offer one kind a string the other lacks.
 */
export const FLOW_TEXT = { automation: AUTOMATION_TEXT, script: SCRIPT_TEXT } as const;
