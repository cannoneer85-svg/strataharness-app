# Реестр скиллов

Каталог всех скиллов репозитория из `.agents/skills/`. Категории задаются здесь, а не вложенными папками. При добавлении, удалении или переименовании скилла Реестр обновляется в том же изменении, затем запускаются `.agents/scripts/Sync-ClaudeSkills.ps1`, `.agents/scripts/Test-Template.ps1` и `pnpm run verify-skill-invocation-metadata`.

- **template-version:** `v1.4.6`
- **template-source:** `https://github.com/cannoneer85-svg/StrataHarness`

**Колонки.** Запуск: `ручной` — модель не вызывает скилл сама (`disable-model-invocation: true` в `SKILL.md` и `allow_implicit_invocation: false` в `agents/openai.yaml`), только слэш-командой или чтением по пути после подтверждения этапа; `авто` — модель может выбрать скилл сама. Источник: `matt` — скилл Matt Pocock без изменений, `matt+правки` — адаптированный скилл для StrataHarness, `свой` — скилл StrataHarness, `dsh` — доменный скилл DeepSeek Harness. Статус: `active` или `in-progress`.

## Процесс разработки

| Скилл | Когда использовать | Запуск | Источник | Статус |
|---|---|---|---|---|
| [grill-with-docs](skills/grill-with-docs/SKILL.md) | Интервью по плану задачи с фиксацией терминов в `CONTEXT.md` и архитектурных решений в `.agents/notes/` | ручной | matt+правки | active |
| [grill-me](skills/grill-me/SKILL.md) | Жёсткое интервью, чтобы заострить план или дизайн, без записи документов | авто | matt | active |
| [grilling](skills/grilling/SKILL.md) | Стресс-тест идеи или решения вопросами; формат вопросов для других интервью | авто | matt+правки | active |
| [wayfinder](skills/wayfinder/SKILL.md) | Планирование очень большой работы в Тумане (больше одной сессии) как карты тикетов-решений | ручной | matt+правки | active |
| [to-spec](skills/to-spec/SKILL.md) | Свести обсуждение в спецификацию в `docs/specs/` без нового интервью | ручной | matt+правки | active |
| [to-tickets](skills/to-tickets/SKILL.md) | Разбить спеку или план на тикеты-трассеры с зависимостями `Blocked by` в `.scratch/<feature>/` | ручной | matt+правки | active |
| [implement](skills/implement/SKILL.md) | Реализовать работу по спеке или тикетам (In-Place или через Оркестратор субагентов) | ручной | matt+правки | active |
| [code-review](skills/code-review/SKILL.md) | Ревью изменений от `BASE_COMMIT` по осям Standards, Spec и Adversary в параллельных субагентах | авто | matt+правки | active |
| [handoff](skills/handoff/SKILL.md) | Передать контекст новой сессии: документ в `docs/handoff/`, `LATEST.md`, очистка завершённого в `.scratch`; без коммита | ручной | matt+правки | active |
| [close-task](skills/close-task/SKILL.md) | Закрыть задачу по команде пользователя: preflight-проверки, handoff и один локальный conventional-коммит без push | ручной | свой | active |
| [claude-handoff](skills/claude-handoff/SKILL.md) | Передать разговор свежему фоновому агенту, который сразу продолжит работу | авто | matt+правки | active |
| [triage](skills/triage/SKILL.md) | Провести входящие issues и внешние PR через роли триажа и подготовить брифы для агента | авто | matt+правки | active |
| [to-questionnaire](skills/to-questionnaire/SKILL.md) | Превратить решение, на которое нет полного ответа, в опросник для другого человека | авто | matt | active |

## Анализ и исследование

| Скилл | Когда использовать | Запуск | Источник | Статус |
|---|---|---|---|---|
| [analyze](skills/analyze/SKILL.md) | Задача анализа (без правки кода): короткое интервью, сбор фактов, документ в `docs/analysis/`; два стоп-гейта | авто | свой | active |
| [research](skills/research/SKILL.md) | Исследовать вопрос по первичным источникам и сохранить выводы в Markdown в репозитории | авто | matt | active |
| [prototype](skills/prototype/SKILL.md) | Одноразовый прототип, чтобы проверить модель состояний, логику или вид UI | авто | matt | active |

## Качество и отладка

| Скилл | Когда использовать | Запуск | Источник | Статус |
|---|---|---|---|---|
| [tdd](skills/tdd/SKILL.md) | Разработка через тесты (red-green-refactor) на согласованных швах | авто | matt+правки | active |
| [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) | Цикл диагностики сложных багов и регрессий с воспроизводимым red-тестом | авто | matt+правки | active |
| [retro](skills/retro/SKILL.md) | Ретроспектива сессии для улучшения окружения агента: гейты, линтеры, тесты, стандарты | ручной | matt+правки | active |
| [minimal-diff](skills/minimal-diff/SKILL.md) | Дисциплина объёма решения: лестница 7 ступеней до кода, запретные зоны и правила зависимостей | авто | свой | active |

## Домен и дизайн

| Скилл | Когда использовать | Запуск | Источник | Статус |
|---|---|---|---|---|
| [domain-modeling](skills/domain-modeling/SKILL.md) | Уточнить терминологию проекта, вести глоссарий `.agents/CONTEXT.md` и Agent Notes | авто | matt+правки | active |
| [codebase-design](skills/codebase-design/SKILL.md) | Спроектировать глубокий модуль: узкий интерфейс, швы, тестируемость | авто | matt | active |
| [improve-codebase-architecture](skills/improve-codebase-architecture/SKILL.md) | Найти в коде возможности углубить модули, HTML-отчёт и разбор выбранной области | авто | matt | active |
| [setup-ts-deep-modules](skills/setup-ts-deep-modules/SKILL.md) | Настроить dependency-cruiser в TypeScript-репозитории для проверки границ глубоких модулей | авто | matt | active |

## Доменные скиллы проекта (DSH)

| Скилл | Когда использовать | Запуск | Источник | Статус |
|---|---|---|---|---|
| [agent-experience](skills/agent-experience/SKILL.md) | Проектирование и изменение определений model-facing тулов, схем параметров и системного промпта | авто | dsh | active |
| [cordis-styling-nitpicking](skills/cordis-styling-nitpicking/SKILL.md) | Аудит жизненного цикла Cordis-плагинов: синглтоны, неочищенные эффекты и порядок dispose | авто | dsh | active |
| [dsh-archive-agent-notes](skills/dsh-archive-agent-notes/SKILL.md) | Добавление, аудит, архивация и проверка архитектурных записей в `.agents/notes/` | авто | dsh | active |
| [dsh-ci-test-reliability](skills/dsh-ci-test-reliability/SKILL.md) | Проектирование и диагностика тестов без флаков при параллелизме CI, таймерах и субпроцессах | авто | dsh | active |
| [dsh-client-ui-ux](skills/dsh-client-ui-ux/SKILL.md) | Дизайн и ревью изменений клиентского GUI в `packages/client` (токены, фидбек, меню, локализация) | авто | dsh | active |
| [dsh-code-review](skills/dsh-code-review/SKILL.md) | Стандарты ревью кода репозитория: конвенции `AGENTS.md`, defensive patterns, ADR и гейты | авто | dsh | active |
| [dsh-create-upgrade-guide](skills/dsh-create-upgrade-guide/SKILL.md) | Написание и обновление `docs/upgrade-guide/` при внешне заметных ломающих изменениях | авто | dsh | active |
| [dsh-cua-macos-signing](skills/dsh-cua-macos-signing/SKILL.md) | Подбор, создание и настройка фиксированного ключа подписи macOS при разработке CUA из исходников | авто | dsh | active |
| [dsh-doc-writing](skills/dsh-doc-writing/SKILL.md) | Создание, реструктуризация, аудит и двуязычное выравнивание документации, README пакетов и сайта | авто | dsh | active |
| [dsh-error-handling](skills/dsh-error-handling/SKILL.md) | Типизированные ошибки, владение обработкой, границы сбоев и понятные пользователю отчёты | авто | dsh | active |
| [dsh-find-simplifications](skills/dsh-find-simplifications/SKILL.md) | Поиск доказанных упрощений в коде, API, конфигурации и тестах без потери поведения | авто | dsh | active |
| [dsh-merging-stacked-prs](skills/dsh-merging-stacked-prs/SKILL.md) | Работа со стеками зависимых PR через нативный механизм stacked PRs в GitHub | авто | dsh | active |
| [dsh-official-plugin-artwork](skills/dsh-official-plugin-artwork/SKILL.md) | Отрисовка и ревью иконок официальных и экспериментальных плагинов | авто | dsh | active |
| [dsh-pr-description](skills/dsh-pr-description/SKILL.md) | Оформление и обновление описаний PR DeepSeek Harness (секции, тестирование и AI Usage) | авто | dsh | active |
| [dsh-pre-push-checks](skills/dsh-pre-push-checks/SKILL.md) | Выбор минимального достаточного набора локальных тестов и гейтов под конкретный diff | авто | dsh | active |
| [dsh-prose-standard](skills/dsh-prose-standard/SKILL.md) | Редакционный стандарт текста для Markdown, JSDoc, комментариев, промптов и диагностик | авто | dsh | active |
| [dsh-responsive-ui](skills/dsh-responsive-ui/SKILL.md) | Адаптивная вёрстка клиентского UI, обрезка текста, иконки, тултипы и фокус с клавиатуры | авто | dsh | active |
| [dsh-session-projection](skills/dsh-session-projection/SKILL.md) | Проектирование, расширение и ревью проекций состояния сессии (`session-projection`) и миграций восстановления | авто | dsh | active |
| [dsh-speed-up-perf](skills/dsh-speed-up-perf/SKILL.md) | Профилирование, синтетические бенчмарки и оптимизация производительности без смены поведения | авто | dsh | active |
| [dsh-translate-docs](skills/dsh-translate-docs/SKILL.md) | Двуязычный перевод и синхронизация пар документации строго по явному вызову пользователя | ручной | dsh | active |
| [dsh-trim-cot-leakage](skills/dsh-trim-cot-leakage/SKILL.md) | Очистка комментариев, JSDoc и доков от утечек цепочки рассуждений и истории правок | авто | dsh | active |
| [record-browser-gif](skills/record-browser-gif/SKILL.md) | Запись оптимизированных демонстрационных GIF реального Web UI для PR с изменениями интерфейса | авто | dsh | active |

## Письмо

| Скилл | Когда использовать | Запуск | Источник | Статус |
|---|---|---|---|---|
| [writing-fragments](skills/writing-fragments/SKILL.md) | Письмо, разведка: набрать сырые фрагменты без структуры | авто | matt | active |
| [writing-beats](skills/writing-beats/SKILL.md) | Письмо: собрать материал в последовательность смысловых шагов (beats) | авто | matt | active |
| [writing-shape](skills/writing-shape/SKILL.md) | Письмо: оформить материал в статью абзац за абзацем | авто | matt | active |

## Обучение и продуктивность

| Скилл | Когда использовать | Запуск | Источник | Статус |
|---|---|---|---|---|
| [teach](skills/teach/SKILL.md) | Научить пользователя новому навыку или понятию в этом рабочем пространстве | авто | matt+правки | active |
| [loop-me](skills/loop-me/SKILL.md) | Интервью о спецификации рабочих процессов, которые пользователь хочет построить | авто | matt | active |
| [wait-what](skills/wait-what/SKILL.md) | Последний ответ непонятен — переформулировать его заново простыми словами | авто | matt | active |
| [scaffold-exercises](skills/scaffold-exercises/SKILL.md) | Создать структуру упражнений курса: разделы, задачи, решения, пояснения | авто | matt | active |

## Инфраструктура и git

| Скилл | Когда использовать | Запуск | Источник | Статус |
|---|---|---|---|---|
| [resolving-merge-conflicts](skills/resolving-merge-conflicts/SKILL.md) | Разрешить незавершённый merge или rebase с конфликтами | авто | matt | active |
| [git-guardrails-claude-code](skills/git-guardrails-claude-code/SKILL.md) | Хуки Claude Code, блокирующие опасные git-команды | авто | matt | active |
| [wizard](skills/wizard/SKILL.md) | Интерактивный bash-мастер для шагов, которые может сделать только человек | авто | matt+правки | active |
| [pr](skills/pr/SKILL.md) | Справочник оформления описания PR по Show-Me, Before/After Evidence и Merge Danger | авто | matt+правки | active |
| [strata-release](skills/strata-release/SKILL.md) | Интерактивный мастер подготовки и выпуска десктоп-релиза `StrataHarness`: предпросмотр `strata:changelog`, русское резюме `docs/strata/releases/v*.md`, опциональный bump версии, тег `strata-v*` и подтверждённый `git push` | ручной | свой | active |

## Мета (Шаблон)

| Скилл | Когда использовать | Запуск | Источник | Статус |
|---|---|---|---|---|
| [ask](skills/ask/SKILL.md) | Спросить, какой скилл или маршрут подходит к ситуации (роутер по скиллам) | авто | свой | active |
| [init-project](skills/init-project/SKILL.md) | Инициализация и обновление Проекта из Шаблона (`Adopt` / `Update`), настройка трекера | ручной | свой | active |
| [writing-for-agents](skills/writing-for-agents/SKILL.md) | Писать документы для агентов: скиллы, `AGENTS.md`, инструкции | авто | matt | active |
