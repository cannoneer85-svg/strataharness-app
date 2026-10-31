// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import {
  apply as localeApply,
  inject as localeInject,
  type LocaleRuntime,
} from '@deepseek-ai/dsh-client-locale/client'
import { LOCALE_CONFIG_GLOBAL } from '@deepseek-ai/dsh-client-locale/src/locale-settings.ts'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import {
  en as enApproval,
  zh as zhApproval,
} from '@deepseek-ai/dsh-client-ui-approval/src/client/locales.ts'
import {
  en as enChat,
  zh as zhChat,
} from '@deepseek-ai/dsh-client-ui-chat/src/client/locale.ts'
import {
  en as enConversation,
  zh as zhConversation,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import {
  en as enCordis,
  zh as zhCordis,
} from '@deepseek-ai/dsh-client-ui-cordis/src/client/locales.ts'
import {
  en as enDeliverables,
  zh as zhDeliverables,
} from '@deepseek-ai/dsh-client-ui-deliverables/src/client/locales.ts'
import {
  en as enGoal,
  zh as zhGoal,
} from '@deepseek-ai/dsh-client-ui-goal/src/client/locales.ts'
import {
  en as enSlashMenu,
  zh as zhSlashMenu,
} from '@deepseek-ai/dsh-client-ui-input-trigger/src/client/locales.ts'
import {
  en as enJob,
  zh as zhJob,
} from '@deepseek-ai/dsh-client-ui-jobs/src/client/locales.ts'
import {
  en as enFeedback,
  zh as zhFeedback,
} from '@deepseek-ai/dsh-client-ui-message-feedback/src/client/locales.ts'
import {
  en as enPlan,
  zh as zhPlan,
} from '@deepseek-ai/dsh-client-ui-plan/src/client/locales.ts'
import {
  en as enReference,
  zh as zhReference,
} from '@deepseek-ai/dsh-client-ui-reference/src/client/locales.ts'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  en as enScheduleCatalog,
  zh as zhScheduleCatalog,
} from '@deepseek-ai/dsh-client-ui-schedule/src/client/locales.ts'
import {
  en as enScheduleManager,
  zh as zhScheduleManager,
} from '@deepseek-ai/dsh-client-ui-schedule/src/client/task-manager-locales.ts'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  en as enSidebarBrowser,
  zh as zhSidebarBrowser,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/src/client/locales.ts'
import {
  en as enSidebarCodePreview,
  zh as zhSidebarCodePreview,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/code/locales.ts'
import {
  en as enSidebarExcel,
  zh as zhSidebarExcel,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/excel/locales.ts'
import {
  en as enDocumentHtml,
  zh as zhDocumentHtml,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/html/locales.ts'
import {
  en as enSidebarImage,
  zh as zhSidebarImage,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/image/locales.ts'
import {
  en as enSidebarDocumentPreview,
  zh as zhSidebarDocumentPreview,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/locales.ts'
import {
  en as enDocumentMarkdown,
  zh as zhDocumentMarkdown,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/markdown/locales.ts'
import {
  en as enSidebarOffice,
  zh as zhSidebarOffice,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/office/locales.ts'
import {
  en as enSidebarPdf,
  zh as zhSidebarPdf,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/pdf/locales.ts'
import {
  en as enSidebarFiles,
  zh as zhSidebarFiles,
} from '@deepseek-ai/dsh-client-ui-sidebar-files/src/client/locales.ts'
import {
  en as enSidebarTerminal,
  zh as zhSidebarTerminal,
} from '@deepseek-ai/dsh-client-ui-sidebar-terminal/src/client/locales.ts'
import {
  en as enSkill,
  zh as zhSkill,
} from '@deepseek-ai/dsh-client-ui-skill/src/client/locales.ts'
import {
  en as enSubagent,
  zh as zhSubagent,
} from '@deepseek-ai/dsh-client-ui-subagent/src/client/locales.ts'
import {
  en as enTrajectory,
  zh as zhTrajectory,
} from '@deepseek-ai/dsh-client-ui-trajectory/src/client/locales.ts'
import {
  en as enQuestion,
  zh as zhQuestion,
} from '@deepseek-ai/dsh-client-ui-user-questions/src/client/locales.ts'
import {
  en as enWorkflowRun,
  zh as zhWorkflowRun,
} from '@deepseek-ai/dsh-client-ui-workflow-run/src/client/locales.ts'
import {
  en as enAgentTeam,
  zh as zhAgentTeam,
} from '@deepseek-ai/dsh-experimental-client-ui-agent-team/src/client/locales.ts'
import {
  en as enClaudeCodeMods,
  zh as zhClaudeCodeMods,
} from '@deepseek-ai/dsh-experimental-client-ui-claude-code-mods/src/client/locales.ts'
import {
  en as enCotTranslation,
  zh as zhCotTranslation,
} from '@deepseek-ai/dsh-experimental-client-ui-cot-translation/src/client/locales.ts'
import {
  en as enVoiceInput,
  zh as zhVoiceInput,
} from '@deepseek-ai/dsh-experimental-client-ui-voice-input/src/client/locales.ts'
import {
  en as enInspectorPanel,
  zh as zhInspectorPanel,
} from '@deepseek-ai/dsh-experimental-inspector/src/client/bottom/locales.ts'
import {
  en as enSessionInspector,
  zh as zhSessionInspector,
} from '@deepseek-ai/dsh-experimental-session-inspector/src/client/locales.ts'
import {
  en as enSessionLogDownload,
  zh as zhSessionLogDownload,
} from '@deepseek-ai/dsh-session-log-export/src/client/locales.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
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
} from '../src/client/locales/agent-capabilities.ts'
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
} from '../src/client/locales/conversation.ts'
import {
  ruAgentTeam,
  ruClaudeCodeMods,
  ruCotTranslation,
  ruInspectorPanel,
  ruSessionInspector,
  ruVoiceInput,
} from '../src/client/locales/experimental.ts'
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
} from '../src/client/locales/sidebars-and-viewers.ts'

interface NamespaceSpec {
  readonly ns: string
  readonly ru: Record<string, string>
  readonly en: Record<string, string>
  readonly zh: Record<string, string>
}

const NAMESPACE_SPECS: readonly NamespaceSpec[] = [
  { ns: 'conversation', ru: ruConversation, en: enConversation, zh: zhConversation },
  { ns: 'chat', ru: ruChat, en: enChat, zh: zhChat },
  { ns: 'trajectory', ru: ruTrajectory, en: enTrajectory, zh: zhTrajectory },
  { ns: 'approval', ru: ruApproval, en: enApproval, zh: zhApproval },
  { ns: 'question', ru: ruQuestion, en: enQuestion, zh: zhQuestion },
  { ns: 'feedback', ru: ruFeedback, en: enFeedback, zh: zhFeedback },
  { ns: 'reference', ru: ruReference, en: enReference, zh: zhReference },
  { ns: 'slash.menu', ru: ruSlashMenu, en: enSlashMenu, zh: zhSlashMenu },
  { ns: 'deliverables', ru: ruDeliverables, en: enDeliverables, zh: zhDeliverables },
  { ns: 'session-log-download', ru: ruSessionLogDownload, en: enSessionLogDownload, zh: zhSessionLogDownload },
  { ns: 'plan', ru: ruPlan, en: enPlan, zh: zhPlan },
  { ns: 'goal', ru: ruGoal, en: enGoal, zh: zhGoal },
  { ns: 'job', ru: ruJob, en: enJob, zh: zhJob },
  { ns: 'subagent', ru: ruSubagent, en: enSubagent, zh: zhSubagent },
  { ns: 'skill', ru: ruSkill, en: enSkill, zh: zhSkill },
  { ns: 'workflowRun', ru: ruWorkflowRun, en: enWorkflowRun, zh: zhWorkflowRun },
  { ns: 'schedule.catalog', ru: ruScheduleCatalog, en: enScheduleCatalog, zh: zhScheduleCatalog },
  { ns: 'schedule.manager', ru: ruScheduleManager, en: enScheduleManager, zh: zhScheduleManager },
  { ns: 'cordis', ru: ruCordis, en: enCordis, zh: zhCordis },
  { ns: 'sidebarFiles', ru: ruSidebarFiles, en: enSidebarFiles, zh: zhSidebarFiles },
  { ns: 'sidebarTerminal', ru: ruSidebarTerminal, en: enSidebarTerminal, zh: zhSidebarTerminal },
  { ns: 'sidebarBrowser', ru: ruSidebarBrowser, en: enSidebarBrowser, zh: zhSidebarBrowser },
  { ns: 'sidebarDocumentPreview', ru: ruSidebarDocumentPreview, en: enSidebarDocumentPreview, zh: zhSidebarDocumentPreview },
  { ns: 'sidebarCodePreview', ru: ruSidebarCodePreview, en: enSidebarCodePreview, zh: zhSidebarCodePreview },
  { ns: 'documentMarkdown', ru: ruDocumentMarkdown, en: enDocumentMarkdown, zh: zhDocumentMarkdown },
  { ns: 'documentHtml', ru: ruDocumentHtml, en: enDocumentHtml, zh: zhDocumentHtml },
  { ns: 'sidebarImage', ru: ruSidebarImage, en: enSidebarImage, zh: zhSidebarImage },
  { ns: 'sidebarPdf', ru: ruSidebarPdf, en: enSidebarPdf, zh: zhSidebarPdf },
  { ns: 'sidebarExcel', ru: ruSidebarExcel, en: enSidebarExcel, zh: zhSidebarExcel },
  { ns: 'sidebarOffice', ru: ruSidebarOffice, en: enSidebarOffice, zh: zhSidebarOffice },
  { ns: 'agent-team', ru: ruAgentTeam, en: enAgentTeam, zh: zhAgentTeam },
  { ns: 'claude-code-mods', ru: ruClaudeCodeMods, en: enClaudeCodeMods, zh: zhClaudeCodeMods },
  { ns: 'cotTranslation', ru: ruCotTranslation, en: enCotTranslation, zh: zhCotTranslation },
  { ns: 'voice-input', ru: ruVoiceInput, en: enVoiceInput, zh: zhVoiceInput },
  { ns: 'inspectorPanel', ru: ruInspectorPanel, en: enInspectorPanel, zh: zhInspectorPanel },
  { ns: 'session-inspector', ru: ruSessionInspector, en: enSessionInspector, zh: zhSessionInspector },
]

function extractPlaceholders(template: string): string[] {
  const names = new Set<string>()
  const pattern = /\{([a-zA-Z0-9_]+)(?:\s*,\s*plural\s*,|\})/g
  for (const match of template.matchAll(pattern)) {
    names.add(match[1]!)
  }
  return [...names].sort()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function bootLocaleWithRu() {
  vi.stubGlobal('navigator', { languages: ['ru-RU', 'en-US'], language: 'ru-RU' })
  vi.stubGlobal(LOCALE_CONFIG_GLOBAL, {
    defaultLocale: 'ru',
    localeOrder: ['ru', 'en', 'zh'],
  })
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  new TestRemote(ctx, {
    settings: {
      describe: async () => ({
        ok: true as const,
        value: { writable: true, hasDocument: true, namespaces: [] },
      }),
      mutate: async () => ({
        ok: false as const,
        error: { code: 'READ_ONLY' as const, message: 'unused' },
      }),
    },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...localeInject], apply: localeApply }).await()
  const locale = ctx.get('locale') as LocaleRuntime
  for (const spec of NAMESPACE_SPECS) {
    locale.register(spec.ns, 'zh', spec.zh)
    locale.register(spec.ns, 'en', spec.en)
  }
  const ruFiber = ctx.plugin({ inject: [...inject], apply })
  await ruFiber.await()
  return { ctx, locale, ruFiber }
}

describe('Conversation, trajectory, agent capabilities, sidebars, viewers, and experimental panels in @strata/locale-ru', () => {
  it('covers all 36 remaining LocaleNamespaceMap namespaces', () => {
    expect(NAMESPACE_SPECS).toHaveLength(36)
  })

  it.each(NAMESPACE_SPECS)('maintains 100% key and placeholder parity for $ns', ({ ns, ru, en }) => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())

    for (const [key, enText] of Object.entries(en)) {
      const ruText = ru[key]
      expect(typeof ruText, `${ns}:${key} should be a string`).toBe('string')
      // `chat` intentionally defines `'message.stepProcess.sharedPrefix': ''` just like `en`.
      if (enText.length > 0) {
        expect(ruText!.length, `${ns}:${key} should not be empty`).toBeGreaterThan(0)
      }
      expect(extractPlaceholders(ruText!), `${ns}:${key} placeholders`).toEqual(extractPlaceholders(enText))
    }
  })

  it('registers all 36 workspace-loop, viewer, and experimental namespaces into ctx.locale and falls back cleanly on unload', async () => {
    const boot = await bootLocaleWithRu()
    try {
      expect(boot.locale.getLocale().active).toBe('ru')

      for (const spec of NAMESPACE_SPECS) {
        const t = boot.locale.bind(spec.ns)
        const sampleKey = Object.keys(spec.en).find(k => spec.ru[k] !== spec.en[k]) ?? Object.keys(spec.en)[0]!
        const resolved = t(sampleKey, {
          count: 2,
          days: 7,
          files: 3,
          items: 5,
          limit: '10 MB',
          message: 'timeout',
          n: 2,
          name: 'demo.ts',
          page: 1,
          path: 'src/index.ts',
          percent: 100,
          provider: 'Google',
          records: 10,
          seconds: 5,
          shown: 2,
          size: '5 MB',
          slot: 'main',
          step: 5,
          steps: 4,
          title: 'Daily sync',
          tokens: 1200,
          toolName: 'bash',
          total: 10,
          turn: 1,
          turns: 2,
          unit: 'мин',
          value: 5,
        })
        expect(resolved, `${spec.ns}:${sampleKey} should resolve to ru`).not.toBe(sampleKey)
        if (spec.ru[sampleKey] !== spec.en[sampleKey] && !spec.ru[sampleKey]!.includes('{')) {
          expect(resolved, `${spec.ns}:${sampleKey} should differ from en`).toBe(spec.ru[sampleKey])
        }
      }

      // Unload @strata/locale-ru and confirm clean fallback to English without raw keys.
      await boot.ruFiber.dispose()
      expect(boot.locale.getLocale().active).toBe('en')
      expect(boot.locale.bind('conversation')('input.send')).toBe('Send message')
      expect(boot.locale.bind('trajectory')('view.trajectory')).toBe('Trajectory')
      expect(boot.locale.bind('approval')('waiting')).toBe('Waiting for approval')
      expect(boot.locale.bind('sidebarTerminal')('title')).toBe('Terminal')
      expect(boot.locale.bind('sidebarExcel')('language')).toBe('en')
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })

  it('preserves canonical Russian terminology and machine-interpreted locale tokens', () => {
    expect(ruTrajectory['view.trajectory']).toBe('Траектория')
    expect(ruChat['settings.transcript.title']).toBe('Подробности работы')
    expect(ruChat['message.compaction.commandTitle']).toBe('compact')
    expect(ruChat['message.turnProcess.took'].endsWith(' ')).toBe(true)
    expect(ruChat['duration.hourUnit'].endsWith(' ')).toBe(true)
    expect(ruChat['duration.minuteUnit'].endsWith(' ')).toBe(true)

    expect(ruApproval['reject']).toBe('Отклонить')
    expect(ruQuestion['plan.approve']).toBe('Одобрить')
    expect(ruQuestion['plan.decline']).toBe('Отклонить')

    expect(ruSlashMenu['command']).toBe('Команды')
    expect(ruSlashMenu['skill']).toBe('Скиллы')
    expect(ruSlashMenu['subagent']).toBe('Субагенты')
    expect(ruSlashMenu['drill.key']).toBe('Tab')

    expect(ruConversation['hint.goal.active']).toContain('edit')
    expect(ruConversation['hint.goal.active']).toContain('pause')
    expect(ruConversation['hint.goal.active']).toContain('resume')
    expect(ruConversation['hint.goal.active']).toContain('clear')
    expect(ruPlan['chip.on.title']).toContain('(/plan off)')

    // FortuneSheet spreadsheet locale code & Intl.DateTimeFormat locale tags.
    expect(ruSidebarExcel['language']).toBe('ru')
    expect(ruScheduleCatalog['time.locale']).toBe('ru')
    expect(ruScheduleManager['time.locale']).toBe('ru')

    expect(ruSidebarFiles['type.label']).toBe('Файлы')
    expect(ruSidebarTerminal['title']).toBe('Терминал')
    expect(ruSidebarBrowser['type.label']).toBe('Браузер')
    expect(ruCotTranslation['targetLanguageHint']).toContain('auto')
  })

  it('formats Russian plural counters accurately across 1, 2, 5, 11, and 21 via Intl.PluralRules("ru")', async () => {
    const boot = await bootLocaleWithRu()
    try {
      const tConv = boot.locale.bind('conversation')
      expect(tConv('queue.count', { n: 1 })).toBe('1 сообщение в очереди')
      expect(tConv('queue.count', { n: 2 })).toBe('2 сообщения в очереди')
      expect(tConv('queue.count', { n: 5 })).toBe('5 сообщений в очереди')
      expect(tConv('queue.count', { n: 11 })).toBe('11 сообщений в очереди')
      expect(tConv('queue.count', { n: 21 })).toBe('21 сообщение в очереди')

      expect(tConv('search.matches', { shown: 1, files: 1 })).toBe('1 совпадение · 1 файл')
      expect(tConv('search.matches', { shown: 2, files: 3 })).toBe('2 совпадения · 3 файла')
      expect(tConv('search.matches', { shown: 5, files: 11 })).toBe('5 совпадений · 11 файлов')
      expect(tConv('search.matches', { shown: 21, files: 21 })).toBe('21 совпадение · 21 файл')

      expect(tConv('detail.jobs.count', { count: 1 })).toBe('1 фоновая задача')
      expect(tConv('detail.jobs.count', { count: 2 })).toBe('2 фоновые задачи')
      expect(tConv('detail.jobs.count', { count: 5 })).toBe('5 фоновых задач')

      const tChat = boot.locale.bind('chat')
      expect(tChat('stats.counts', { turns: 1, steps: 1 })).toBe('1 ход · 1 шаг')
      expect(tChat('stats.counts', { turns: 2, steps: 4 })).toBe('2 хода · 4 шага')
      expect(tChat('stats.counts', { turns: 5, steps: 11 })).toBe('5 ходов · 11 шагов')
      expect(tChat('stats.counts', { turns: 21, steps: 21 })).toBe('21 ход · 21 шаг')

      expect(tChat('message.turnProcess.toolCalls.other', { count: 1 })).toBe('1 вызов инструмента')
      expect(tChat('message.turnProcess.toolCalls.other', { count: 2 })).toBe('2 вызова инструментов')
      expect(tChat('message.turnProcess.toolCalls.other', { count: 5 })).toBe('5 вызовов инструментов')

      const tTraj = boot.locale.bind('trajectory')
      expect(tTraj('summary.steps.other', { count: 1 })).toBe('1 шаг')
      expect(tTraj('summary.steps.other', { count: 2 })).toBe('2 шага')
      expect(tTraj('summary.steps.other', { count: 5 })).toBe('5 шагов')
      expect(tTraj('summary.steps.other', { count: 21 })).toBe('21 шаг')

      const tDeliv = boot.locale.bind('deliverables')
      expect(tDeliv('changes.title', { count: 1 })).toBe('Изменён 1 файл')
      expect(tDeliv('changes.title', { count: 2 })).toBe('Изменено 2 файла')
      expect(tDeliv('changes.title', { count: 5 })).toBe('Изменено 5 файлов')
      expect(tDeliv('changes.title', { count: 21 })).toBe('Изменён 21 файл')

      const tJob = boot.locale.bind('job')
      expect(tJob('count.live.other', { count: 1 })).toBe('Выполняется 1 фоновая задача')
      expect(tJob('count.live.other', { count: 2 })).toBe('Выполняются 2 фоновые задачи')
      expect(tJob('count.live.other', { count: 5 })).toBe('Выполняются 5 фоновых задач')

      const tSubagent = boot.locale.bind('subagent')
      expect(tSubagent('count.total.other', { count: 1 })).toBe('1 субагент')
      expect(tSubagent('count.total.other', { count: 2 })).toBe('2 субагента')
      expect(tSubagent('count.total.other', { count: 5 })).toBe('5 субагентов')

      const tSchedule = boot.locale.bind('schedule.manager')
      expect(tSchedule('delivery.retentionBounds', { records: 1, days: 1 }))
        .toBe('Для каждой задачи хранится до 1 записи за последние 1 день.')
      expect(tSchedule('delivery.retentionBounds', { records: 2, days: 3 }))
        .toBe('Для каждой задачи хранится до 2 записей за последние 3 дня.')
      expect(tSchedule('delivery.retentionBounds', { records: 50, days: 30 }))
        .toBe('Для каждой задачи хранится до 50 записей за последние 30 дней.')

      const tOffice = boot.locale.bind('sidebarOffice')
      expect(tOffice('missingFontsCount', { count: 1 })).toBe('1 шрифт')
      expect(tOffice('missingFontsCount', { count: 2 })).toBe('2 шрифта')
      expect(tOffice('missingFontsCount', { count: 5 })).toBe('5 шрифтов')
      expect(tOffice('missingFontsCount', { count: 21 })).toBe('21 шрифт')
    } finally {
      await boot.ctx.fiber.dispose()
    }
  })
})
