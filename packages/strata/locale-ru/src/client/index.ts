/** StrataHarness Russian language pack, browser half. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  ruCordis,
  ruGoal,
  ruJob,
  ruPlan,
  ruScheduleCatalog,
  ruScheduleManager,
  ruSkill,
  ruSubagent,
  ruWorkflowRun,
} from './locales/agent-capabilities.ts'
import { ruSettingsAgentPreset } from './locales/agent-preset.ts'
import {
  ruAccountNotifications,
  ruContextMenu,
  ruFileActions,
  ruFileDrag,
  ruMessageQuotes,
} from './locales/client-ui.ts'
import { RU_LOCALE_ID, RU_LOCALE_LABEL, ruCommon, ruSettingsLocale } from './locales/common.ts'
import {
  ruApproval,
  ruChat,
  ruConversation,
  ruDeliverables,
  ruFeedback,
  ruQuestion,
  ruReference,
  ruSessionLogDownload,
  ruSlashMenu,
  ruTrajectory,
} from './locales/conversation.ts'
import {
  ruActionCards,
  ruCreationRecommendations,
  ruCuaPermissions,
  ruDeepseekChatImport,
  ruPluginRecommendations,
} from './locales/experimental-capabilities.ts'
import {
  ruAgentTeam,
  ruClaudeCodeMods,
  ruCotTranslation,
  ruInspectorPanel,
  ruSessionInspector,
  ruVoiceInput,
} from './locales/experimental.ts'
import { ruForgePanel } from './locales/forge.ts'
import { ruLiveshare } from './locales/liveshare.ts'
import {
  ruModel,
  ruSettingsModels,
} from './locales/models.ts'
import {
  ruCommand,
  ruDirectoryBrowser,
  ruOpenInApp,
  ruPermissionAccess,
  ruShortcuts,
  ruShortcutsLayout,
  ruSidebar,
  ruSidebarRight,
  ruWorkspace,
} from './locales/navigation.ts'
import { ruPluginMetadataCatalog } from './locales/plugin-metadata.ts'
import {
  ruEntryCustomization,
  ruPluginManager,
  ruPluginMarket,
  ruSettingsPluginInventory,
} from './locales/plugins.ts'
import {
  ruSecretMask,
  ruSettings,
  ruSettingsAccount,
  ruSettingsAgentLoop,
  ruSettingsPermission,
  ruSettingsPlugins,
  ruSettingsSessionLog,
  ruSettingsShell,
  ruSettingsSubagent,
  ruSettingsTheme,
  ruSettingsWebSearch,
} from './locales/settings.ts'
import {
  ruDocumentHtml,
  ruDocumentMarkdown,
  ruSidebarBrowser,
  ruSidebarCodePreview,
  ruSidebarDocumentPreview,
  ruSidebarExcel,
  ruSidebarFiles,
  ruSidebarImage,
  ruSidebarOffice,
  ruSidebarPdf,
  ruSidebarTerminal,
} from './locales/sidebars-and-viewers.ts'
import { ruStats } from './locales/stats.ts'

const RU_DICTIONARIES: readonly [namespace: string, dict: Readonly<Record<string, string>>][] = [
  ['common', ruCommon],
  ['settings.locale', ruSettingsLocale],
  ['settings', ruSettings],
  ['settings.theme', ruSettingsTheme],
  ['settings.models', ruSettingsModels],
  ['settings.account', ruSettingsAccount],
  ['settings.agentLoop', ruSettingsAgentLoop],
  ['settings.pluginInventory', ruSettingsPluginInventory],
  ['settings.sessionLog', ruSettingsSessionLog],
  ['settings.shell', ruSettingsShell],
  ['settings.subagent', ruSettingsSubagent],
  ['settings.webSearch', ruSettingsWebSearch],
  ['settings.agentPreset', ruSettingsAgentPreset],
  ['settings.permission', ruSettingsPermission],
  ['settings.plugins', ruSettingsPlugins],
  ['pluginManager', ruPluginManager],
  ['pluginMarket', ruPluginMarket],
  ['entryCustomization', ruEntryCustomization],
  ['secretMask', ruSecretMask],
  ['sidebar', ruSidebar],
  ['sidebarRight', ruSidebarRight],
  ['workspace', ruWorkspace],
  ['directory-browser', ruDirectoryBrowser],
  ['shortcuts', ruShortcuts],
  ['shortcuts.layout', ruShortcutsLayout],
  ['command', ruCommand],
  ['open-in-app', ruOpenInApp],
  ['permission.access', ruPermissionAccess],
  ['model', ruModel],
  ['account.notifications', ruAccountNotifications],
  ['contextMenu', ruContextMenu],
  ['fileActions', ruFileActions],
  ['fileDrag', ruFileDrag],
  ['messageQuotes', ruMessageQuotes],
  ['conversation', ruConversation],
  ['chat', ruChat],
  ['trajectory', ruTrajectory],
  ['approval', ruApproval],
  ['question', ruQuestion],
  ['feedback', ruFeedback],
  ['reference', ruReference],
  ['slash.menu', ruSlashMenu],
  ['deliverables', ruDeliverables],
  ['session-log-download', ruSessionLogDownload],
  ['plan', ruPlan],
  ['goal', ruGoal],
  ['job', ruJob],
  ['subagent', ruSubagent],
  ['skill', ruSkill],
  ['workflowRun', ruWorkflowRun],
  ['schedule.catalog', ruScheduleCatalog],
  ['schedule.manager', ruScheduleManager],
  ['cordis', ruCordis],
  ['sidebarFiles', ruSidebarFiles],
  ['sidebarTerminal', ruSidebarTerminal],
  ['sidebarBrowser', ruSidebarBrowser],
  ['sidebarDocumentPreview', ruSidebarDocumentPreview],
  ['sidebarCodePreview', ruSidebarCodePreview],
  ['documentMarkdown', ruDocumentMarkdown],
  ['documentHtml', ruDocumentHtml],
  ['sidebarImage', ruSidebarImage],
  ['sidebarPdf', ruSidebarPdf],
  ['sidebarExcel', ruSidebarExcel],
  ['sidebarOffice', ruSidebarOffice],
  ['agent-team', ruAgentTeam],
  ['claude-code-mods', ruClaudeCodeMods],
  ['cotTranslation', ruCotTranslation],
  ['voice-input', ruVoiceInput],
  ['inspectorPanel', ruInspectorPanel],
  ['session-inspector', ruSessionInspector],
  ['actionCards', ruActionCards],
  ['creationRecommendations', ruCreationRecommendations],
  ['pluginRecommendations', ruPluginRecommendations],
  ['cuaPermissions', ruCuaPermissions],
  ['deepseekChatImport', ruDeepseekChatImport],
  ['forgePanel', ruForgePanel],
  ['stats', ruStats],
  ['liveshare', ruLiveshare],
]

/** Required service: the Phase-1 browser locale runtime. */
export const inject = ['locale']

/**
 * Register the Russian selectable language, typed Russian UI dictionaries, and built-in metadata catalog.
 * @param ctx - Client plugin context providing `ctx.locale`.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.addLanguage({ id: RU_LOCALE_ID, label: RU_LOCALE_LABEL, fallback: 'en' }, { ifExists: 'ignore' }))
  for (const [namespace, dict] of RU_DICTIONARIES) {
    ctx.effect(() => ctx.locale.register(namespace, RU_LOCALE_ID, dict, { override: true }))
  }
  ctx.effect(() => ctx.locale.registerTextCatalog(RU_LOCALE_ID, ruPluginMetadataCatalog))
}
