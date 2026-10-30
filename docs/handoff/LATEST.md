> Копия архивного handoff: [2026-10-30-strata-release-changelog-and-skill.md](2026-10-30-strata-release-changelog-and-skill.md)

# Handoff: Гибридные релизные заметки (`strata:changelog`) и интерактивный скилл выпуска релиза (`/strata-release`)

## Состояние

- **Цель:** Реализовать автоматическое формирование описания изменений между релизами `StrataHarness Desktop` (гибридная схема: версионное продуктовое резюме на русском языке `docs/strata/releases/v<version>.md` + автоматическая секция `## What's Changed` из истории Git с фильтрацией шума `Soft-Fork`), локальную CLI-команду предпросмотра `pnpm run strata:changelog` и ручной интерактивный скилл-мастер выпуска версий `/strata-release` перед публикацией первого боевого релиза `strata-v1.0.0`.
- **Достигнутый этап:** Этап 6 — Закрытие задачи (`/close-task`); оба тикета реализации (`01`, `02`), трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) и preflight-проверки полностью завершены.
- **Что сделано:**
  - Утверждена спецификация [0002-strata-release-changelog-and-skill-spec.md](../specs/0002-strata-release-changelog-and-skill-spec.md).
  - В релизный оркестратор [release-helper.ts](../../scripts/strata/release-helper.ts) добавлены загрузка и нормализация версионного русского резюме `docs/strata/releases/v<buildVersion>.md` (`readProductReleaseSummary`) с мягким фоллбэком и диагностическим предупреждением при отсутствии файла, строгий валидатор разметки и ссылок резюме (`validateProductReleaseSummary` / флаг `--strict-summary`), резолвер базового тега сравнения (`resolveReleaseBaselineTag`: `upstreamBaseTag` `dsh-v0.2.1-rc.4` для первого выпуска `1.0.0`, максимальный предшествующий стабильный `strata-v*` для стабильных версий и максимальный любой `strata-v*` для пререлизов), коллектор изменений (`collectReleaseChangelog`: агрегация обновления ядра `dsh-v*` с исключением транзитивных коммитов апстрима и сверкой версии в корневом [package.json](../../package.json), дельта gitlink-указателя `resources/strataharness`, фильтрация релизных bump-коммитов, пять категорий с выделением строго `strata(override)` в `Engine & Desktop Overrides` и лимит в 50 элементов) и CLI-подкоманда `changelog` (`--version`, `--base`, `--target-ref`, `--strict-summary`, `--json`), подключённая в корневом [package.json](../../package.json) как `pnpm run strata:changelog`.
  - Подготовлено русскоязычное продуктовое резюме первого релиза [v1.0.0.md](../strata/releases/v1.0.0.md), охватывающее мульти-LLM бандл `@strata/product-bundle`, встроенную методологию `resources/strataharness`, брендинг `@strata/ui-brand`, трёхуровневую изоляцию (`com.nikl.strataharness`, `@strata/desktop`, `~/.strataharness`, `strata://`) и инфраструктуру релизов Фаз 1–4 MVP.
  - Создан ручной интерактивный скилл выпуска релиза [SKILL.md](../../.agents/skills/strata-release/SKILL.md) (с `disable-model-invocation: true` и [openai.yaml](../../.agents/skills/strata-release/agents/openai.yaml) `allow_implicit_invocation: false`), зарегистрированный в [.agents/SKILLS.md](../../.agents/SKILLS.md), подключённый в роутере [.agents/skills/ask/SKILL.md](../../.agents/skills/ask/SKILL.md) и задокументированный в ранбуке [fork-maintenance.md](../strata/fork-maintenance.md).
  - Добавлен интеграционный набор тестов [release-changelog.spec.ts](../../scripts/strata/release-changelog.spec.ts), проверяющий все ветки выбора базового тега, фильтрацию апстримных слияний, строгую валидацию `--strict-summary`, CLI-предпросмотр и метаданные скилла `/strata-release`.
- **Важные эксплуатационные нюансы (Gotchas):**
  - Перед расчётом `strata:changelog` и проверкой занятости тегов скилл `/strata-release` обязательно выполняет `git fetch origin --tags`, а при отправке релиза использует атомарный пуш `git push --atomic origin main refs/tags/<upstreamBaseTag>:refs/tags/<upstreamBaseTag> refs/tags/strata-v<targetVersion>:refs/tags/strata-v<targetVersion>`: это исключает публикацию осиротевшего тега `strata-v*` при отклонении ветки и гарантирует наличие тега базового ядра `<upstreamBaseTag>` на раннерах GitHub Actions для фильтрации коммитов апстрима.
  - Корпусные гейты `verify-md-wrap` и `verify-md-links` пропускают операционный каталог `docs/strata/**`, поэтому проверка однострочных абзацев и относительных ссылок в новых файлах `docs/strata/releases/v<version>.md` выполняется механически флагом `pnpm run strata:changelog -- --version <version> --strict-summary`.
  - В Windows `pwsh` каталог `C:\Program Files\Git\usr\bin` всегда должен находиться в конце `$env:PATH` после `C:\Windows\System32`.

## Открытые тикеты

none

## Следующий шаг

1. Отправить созданный локальный коммит этой задачи в `origin` (`git push origin main`), после чего вызвать ручной скилл `/strata-release` для подготовки и контролируемого выпуска первого боевого релиза `strata-v1.0.0` (с готовым резюме [v1.0.0.md](../strata/releases/v1.0.0.md) без лишнего инкремента версии `1.0.0`).
2. Любую новую задачу разработки или анализа начинать со **Шага 0** согласно корневому [AGENTS.md](../../AGENTS.md).

## Рекомендуемые скиллы

- Ручной мастер подготовки и выпуска релиза продукта (`/strata-release`): `.agents/skills/strata-release/SKILL.md`
- Роутер скиллов и маршрутов: `.agents/skills/ask/SKILL.md`
- Этап 1 (Интервью разработки): `.agents/skills/grill-with-docs/SKILL.md`
- Этап 1 для категории `Fog` (Туман): `.agents/skills/wayfinder/SKILL.md`
- Маршрут исследования без правок кода (`Analysis`): `.agents/skills/analyze/SKILL.md`
- Выбор минимального набора локальных проверок перед пушем: `.agents/skills/dsh-pre-push-checks/SKILL.md`
