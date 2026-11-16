/**
 * Typed Russian dictionaries for core client UI interaction utilities: account
 * notifications, context menus, file actions, drag feedback, and message quotes.
 */
import type {} from '@deepseek-ai/dsh-client-ui-account-notifications/client'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-file-actions/client'
import type {} from '@deepseek-ai/dsh-client-ui-file-drag/src/client/locales.ts'
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-message-quotes/client'

/** Russian dictionary for the `account.notifications` banner namespace. */
export const ruAccountNotifications = {
  close: 'Закрыть',
} satisfies LocaleDictOf<'account.notifications'>

/** Russian dictionary for the `contextMenu` shared popover menu namespace. */
export const ruContextMenu = {
  back: 'Назад',
  failed: 'Не удалось выполнить действие. Повторите попытку.',
} satisfies LocaleDictOf<'contextMenu'>

/** Russian dictionary for the `fileActions` context menu and download status namespace. */
export const ruFileActions = {
  'menu.finder': 'Показать в Finder',
  'menu.reveal': 'Показать в папке',
  'menu.saveAs': 'Сохранить как…',
  'menu.copied': 'Скопировано',
  'menu.copyImage': 'Копировать изображение',
  'menu.download': 'Скачать',
  'menu.saveFailed': 'Не удалось сохранить. Проверьте источник и путь назначения и повторите попытку.',
  'menu.copyFailed': 'Не удалось скопировать. Убедитесь, что содержимое доступно, и повторите попытку.',
  'menu.saved': 'Сохранено',
  'menu.downloadStarted': 'Загрузка началась',
  'menu.downloaded': 'Загрузка завершена',
  'path.revealError': 'Не удалось показать расположение файла. Повторите попытку.',
} satisfies LocaleDictOf<'fileActions'>

/** Russian dictionary for the `fileDrag` drag-and-drop fallback toast namespace. */
export const ruFileDrag = {
  failed: 'Не удалось перетащить файл. Повторите попытку.',
} satisfies LocaleDictOf<'fileDrag'>

/** Russian dictionary for the `messageQuotes` inline text-quoting action namespace. */
export const ruMessageQuotes = {
  'quote.add': 'Цитировать текст',
} satisfies LocaleDictOf<'messageQuotes'>
