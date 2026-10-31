/**
 * Core Russian (`ru`) locale constants and base UI dictionaries (`common` and
 * `settings.locale`).
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'

/** Canonical BCP 47 primary language subtag for Russian in StrataHarness. */
export const RU_LOCALE_ID = 'ru'

/** Native selector label for the Russian UI locale. */
export const RU_LOCALE_LABEL = 'Русский'

/** Russian base dictionary for the `common` namespace. */
export const ruCommon = {
  'ok': 'ОК',
  'cancel': 'Отмена',
  'close': 'Закрыть',
  'copy': 'Копировать',
  'copied': 'Скопировано',
  'codeBlock.title': 'Блок кода',
  'codeBlock.wrap': 'Переносить строки',
  'codeBlock.unwrap': 'Не переносить строки',
  'copy.failed': 'Не удалось скопировать',
  'copy.value': 'Копировать значение',
  'copy.json': 'Копировать JSON',
  'copy.path': 'Копировать путь свойства',
  'copy.prettyJson': 'Копировать форматированный JSON',
  'copy.compactJson': 'Копировать компактный JSON',
  'copy.optionsHint': '{action}; правый клик — варианты копирования',
  'retry': 'Повторить',
  'loading': 'Загрузка…',
  'load.failed': 'Не удалось загрузить',
  'submit': 'Отправить',
  'submitting': 'Отправка…',
  'next': 'Далее',
  'previous': 'Назад',
  'skip': 'Пропустить',
  'delete': 'Удалить',
  'edit': 'Изменить',
  'save': 'Сохранить',
  'search': 'Поиск',
  'more': 'Ещё',
  'collapse': 'Свернуть',
  'expand': 'Развернуть',
  'back': 'Назад',
  'brand.localBuild': 'Локальная сборка DSH',
  'workspace.defaultName': 'Рабочая область по умолчанию',
  'unknown': 'Неизвестно',
  'none': 'Нет',
  'truncated': 'Обрезано',
  'json.label': 'JSON',
  'markdown.footnotes': 'Сноски',
  'markdown.truncatedCharacters': '… обрезано (всего {total, plural, one {# символ} few {# символа} many {# символов} other {# символов}})',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
} satisfies LocaleDictOf<'common'>

/** Russian dictionary for the `settings.locale` language-selector namespace. */
export const ruSettingsLocale = {
  'language.title': 'Язык',
} satisfies LocaleDictOf<'settings.locale'>
