/**
 * Typed Russian dictionaries for the Right-Sidebar Workspace Files tree,
 * Embedded Terminal, Embedded Browser, Document Preview frame, and Code,
 * Markdown, HTML, Image, PDF, Excel, and Office document renderers.
 */
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/code/locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/excel/locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/html/locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/image/locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/markdown/locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/office/index.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/pdf/locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-files/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-terminal/src/client/locales.ts'
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'

const RU_DOCUMENT_ZOOM = {
  zoomControls: 'Управление масштабом',
  zoomMenu: 'Выбрать масштаб',
  zoomOut: 'Уменьшить масштаб',
  zoomIn: 'Увеличить масштаб',
  zoomFitWidth: 'По ширине',
  zoomValue: '{percent}%',
} as const

/** Russian dictionary for the `sidebarFiles` workspace file-tree tab namespace. */
export const ruSidebarFiles = {
  'shortcut.noSession': 'Сначала выберите сессию',
  'type.label': 'Файлы',
  'guide.title': 'Файлы рабочей области',
  'guide.description': 'Просмотр файлов рабочей области текущей сессии',
  loading: 'Чтение…',
  empty: 'Пустой каталог',
  truncated: 'Слишком много записей; показана только часть списка.',
  noWorkspace: 'У этой сессии нет каталога рабочей области.',
  reload: 'Обновить',
  autoRefresh: 'Автообновление',
  'autoRefresh.enable': 'Включить автообновление',
  'autoRefresh.disable': 'Выключить автообновление',
  'entry.other': 'Это не файл и не каталог, поэтому открыть объект нельзя.',
  'error.notFound': 'Каталог не найден. Возможно, он был перемещён или удалён.',
  'error.outsideWorkspace': 'Каталог находится за пределами рабочей области и не читается в боковой панели.',
  'error.notDirectory': 'Указанный путь не является каталогом.',
  'error.unavailable': 'Ошибка чтения: {message}',
} satisfies LocaleDictOf<'sidebarFiles'>

/** Russian dictionary for the `sidebarTerminal` embedded PTY terminal tab namespace. */
export const ruSidebarTerminal = {
  'shortcut.noSession': 'Сначала выберите сессию',
  recoveryFailed: 'Не удалось восстановить терминал: {message}',
  retryRecovery: 'Повторить восстановление терминала',
  shell: 'Выбрать оболочку',
  shellLoading: 'Загрузка оболочек…',
  shellEmpty: 'Нет доступных оболочек',
  description: 'Выполнение команд в рабочей области сессии',
  title: 'Терминал',
  new: 'Новый терминал',
  loading: 'Чтение окружения терминала…',
  creating: 'Запуск…',
  connecting: 'Подключение…',
  disconnected: 'Соединение разорвано.',
  reconnect: 'Переподключиться',
  readonly: 'Этот режим открыт только для чтения.',
  control: 'Перехватить управление',
  closed: 'Терминал закрыт.',
  exited: 'Процесс завершился ({code})',
  failed: 'Ошибка терминала: {message}',
  rename: 'Название терминала',
  unavailable: 'Недоступно',
  retry: 'Повторить',
  cleanupFailed: 'Не удалось завершить терминал «{title}»: {message}',
  missingTerminal: 'Этот терминал больше не существует. Откройте новый терминал.',
  inputFull: 'Буфер ввода заполнен. Переподключитесь и повторите попытку.',
  attachmentEnded: 'Подключение к терминалу завершено. Переподключитесь для продолжения.',
  invalidOutput: 'Не удалось получить экран терминала. Переподключитесь для восстановления.',
  terminalLimit: 'Достигнут лимит терминалов. Закройте неиспользуемые терминалы и повторите попытку. Завершённые терминалы также учитываются в лимите.',
} satisfies LocaleDictOf<'sidebarTerminal'>

/** Russian dictionary for the `sidebarBrowser` embedded web browser tab namespace. */
export const ruSidebarBrowser = {
  'type.label': 'Браузер',
  'guide.title': 'Браузер',
  'guide.description': 'Просмотр веб-страниц',
  'shortcut.noSession': 'Сначала откройте сессию',
  'address.placeholder': 'Введите адрес HTTP(S)',
  'address.changed': 'URL изменился',
  back: 'Назад',
  forward: 'Вперёд',
  reload: 'Обновить',
  go: 'Перейти',
  external: 'Открыть в системном браузере',
  'sandbox.disable': 'Снять ограничения песочницы',
  'sandbox.enable': 'Восстановить ограничения песочницы',
  'sandbox.warning': 'Ограничения песочницы сняты: страница может перенаправлять верхнее окно приложения, скачивать файлы, открывать модальные диалоги и захватывать ввод.',
  start: 'Введите адрес HTTP(S), чтобы начать просмотр',
  loading: 'Открытие…',
  'restore.previous': 'Открыто ранее',
  'restore.action': 'Восстановить страницу',
  'error.empty': 'Введите адрес.',
  'error.invalid': 'Адрес некорректен или слишком длинен.',
  'error.protocol': 'Поддерживаются только адреса HTTP и HTTPS; для локальных файлов используйте предпросмотр документов.',
  'error.credentials': 'Адрес не должен содержать имя пользователя или пароль.',
  'error.application-origin': 'Нельзя открыть само приложение DSH во встроенном браузере.',
  'load.failed': 'Не удалось загрузить страницу; обновите её или откройте в системном браузере.',
  'load.failed.detail': 'Ошибка загрузки страницы ({code}): {description}',
  'address.unknown': 'Страница выполнила переход; в этом режиме новый URL недоступен для чтения.',
} satisfies LocaleDictOf<'sidebarBrowser'>

/** Russian dictionary for the `sidebarDocumentPreview` container, chrome, and error states namespace. */
export const ruSidebarDocumentPreview = {
  loading: 'Рендеринг документа…',
  loadMore: 'Загрузить ещё',
  changed: 'Файл изменился; показано предыдущее содержимое.',
  reloadNow: 'Обновить',
  reload: 'Перечитать файл',
  autoRefresh: 'Автообновление',
  'autoRefresh.enable': 'Включить автообновление',
  'autoRefresh.disable': 'Выключить автообновление',
  'wrap.enable': 'Включить перенос строк',
  'wrap.disable': 'Выключить перенос строк',
  'wrap.aria': 'Перенос строк',
  openWith: 'Открыть с помощью',
  'viewer.text': 'Обычный текст',
  resourceUnavailable: 'Служба файловых ресурсов недоступна.',
  rendererUnavailable: 'Предпросмотр «{name}» недоступен.',
  unsupportedFile: 'Предпросмотр файлов этого типа пока не поддерживается.',
  'error.notFound': 'Файл не найден. Возможно, он был перемещён или удалён.',
  'error.tooLarge': 'Размер страницы превышает лимит {limit}; чтение невозможно.',
  'error.notText': 'Предпросмотр файлов этого типа пока не поддерживается.',
  'error.notRegularFile': 'Путь не указывает на обычный файл; отображать нечего.',
  'error.unavailable': 'Ошибка чтения: {message}',
  retry: 'Повторить',
} satisfies LocaleDictOf<'sidebarDocumentPreview'>

/** Russian dictionary for the `sidebarCodePreview` syntax-highlighted code renderer namespace. */
export const ruSidebarCodePreview = {
  title: 'Код',
  copy: 'Копировать',
  copied: 'Скопировано',
} satisfies LocaleDictOf<'sidebarCodePreview'>

/** Russian dictionary for the `documentMarkdown` Markdown document renderer namespace. */
export const ruDocumentMarkdown = {
  'viewer.label': 'Markdown',
  'code.copy': 'Копировать',
  'code.copied': 'Скопировано',
  'footnotes': 'Сноски',
} satisfies LocaleDictOf<'documentMarkdown'>

/** Russian dictionary for the `documentHtml` sandboxed HTML document renderer namespace. */
export const ruDocumentHtml = {
  title: 'HTML',
  frame: 'Предпросмотр документа HTML',
  loading: 'Рендеринг документа…',
  failed: 'Не удалось отобразить этот HTML-документ.',
} satisfies LocaleDictOf<'documentHtml'>

/** Russian dictionary for the `sidebarImage` zoomable image renderer namespace. */
export const ruSidebarImage = {
  ...RU_DOCUMENT_ZOOM,
  title: 'Изображение',
  preview: 'Предпросмотр изображения: {name}',
  loading: 'Рендеринг документа…',
  failed: 'Не удалось отобразить это изображение.',
  unsupported: 'Для предпросмотра изображения требуется полное содержимое файла.',
} satisfies LocaleDictOf<'sidebarImage'>

/** Russian dictionary for the `sidebarPdf` zoomable PDF page renderer namespace. */
export const ruSidebarPdf = {
  ...RU_DOCUMENT_ZOOM,
  title: 'PDF',
  pageImage: 'Страница PDF {page}',
  loading: 'Рендеринг документа…',
  rendering: 'Отрисовка страницы…',
  failed: 'Не удалось отобразить PDF: {message}',
  password: 'Этот PDF защищён паролем; предпросмотр защищённых паролем файлов не поддерживается.',
  workerFailed: 'Процесс рендеринга PDF прервался. Повторите попытку.',
  unsupported: 'Для предпросмотра PDF требуется полное содержимое файла.',
  retry: 'Повторить',
} satisfies LocaleDictOf<'sidebarPdf'>

/**
 * Russian dictionary for the `sidebarExcel` FortuneSheet workbook renderer namespace.
 * `language: 'ru'` selects FortuneSheet's built-in Russian spreadsheet locale.
 */
export const ruSidebarExcel = {
  title: 'Таблица',
  language: 'ru',
  loading: 'Рендеринг документа…',
  invalid: 'Не удалось открыть таблицу. Проверьте формат файла, целостность данных или наличие пароля.',
  tooLarge: 'Размер книги превышает лимит предпросмотра.',
  timeout: 'Превышено время ожидания открытия книги. Попробуйте файл меньшего размера.',
  encoding: 'Не удалось распознать кодировку текстового файла. Сохраните его в UTF-8 или UTF-16 с BOM и повторите попытку.',
  formulaWarning: 'Книга содержит формулы. Отображаемые значения могут отсутствовать или отличаться от расчётных.',
  unsupportedNotice: 'Предпросмотр не поддерживает {features} в этой книге. Откройте файл в настольном приложении для полноценной работы.',
  charts: 'диаграммы',
  images: 'изображения',
  shapes: 'фигуры',
  conditionalFormatting: 'условное форматирование',
  featureSeparator: ', ',
  retry: 'Повторить',
} satisfies LocaleDictOf<'sidebarExcel'>

/** Russian dictionary for the `sidebarOffice` Host-converted Office document renderer namespace. */
export const ruSidebarOffice = {
  title: 'Документ Office',
  loading: 'Рендеринг документа…',
  retry: 'Повторить',
  viewMissingFonts: 'Отсутствуют шрифты ({count, plural, one {# шрифт} few {# шрифта} many {# шрифтов} other {# шрифтов}}). Нажмите для просмотра.',
  missingFontsTitle: 'Отсутствующие шрифты',
  missingFontsDescription: 'Следующие шрифты недоступны при предпросмотре. Начертание текста и вёрстка могут отличаться от исходного документа.',
  missingFontsCount: '{count, plural, one {# шрифт} few {# шрифта} many {# шрифтов} other {# шрифтов}}',
  closeDetails: 'Закрыть список шрифтов',
  unavailable: 'Предпросмотр Office недоступен. Включите службу рендеринга документов на компьютере, где запущен DeepSeek Harness.',
  invalid: 'Не удалось открыть файл Office для предпросмотра. Возможно, он повреждён, защищён паролем или имеет неверное расширение.',
  tooLarge: 'Размер файла Office или полученного PDF превышает лимит предпросмотра. Уменьшите файл или измените настройки предпросмотра.',
  failed: 'Не удалось преобразовать документ Office в рабочий PDF. Проверьте файл и повторите попытку.',
  timeout: 'Превышено время ожидания конвертации Office. Повторите попытку.',
  busy: 'Служба предпросмотра Office загружена. Повторите попытку через несколько секунд.',
  changed: 'Файл изменился во время чтения. Откройте предпросмотр заново.',
} satisfies LocaleDictOf<'sidebarOffice'>
