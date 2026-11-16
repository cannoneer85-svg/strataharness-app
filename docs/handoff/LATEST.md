<!-- Copied from docs/handoff/2026-11-16-strata-v1-1-sync-presets-onboarding.md -->
# Передача контекста: Синхронизация с dsh-v0.2.2-rc.3, новая линейка пресетов и экран приветствия (strata-v1-1-sync-presets-onboarding)

**Дата:** 2026-11-16
**Спецификация:** [`docs/specs/0006-strata-v1-1-sync-presets-onboarding-spec.md`](../specs/0006-strata-v1-1-sync-presets-onboarding-spec.md)
**Сводка релиза:** [`docs/strata/releases/v1.1.0.md`](../strata/releases/v1.1.0.md)
**Целевая ветка:** `main` (через ветку синхронизации `sync/dsh-v0.2.2-rc.3`)
**Версия продукта:** `1.1.0`
**Базовый тег апстрима:** `dsh-v0.2.2-rc.3`
**Сабмодуль методологии:** `v1.4.6`

---

## 1. Состояние (State)

- **Цель:** Обновить движок форка `StrataHarness` с `dsh-v0.2.1-rc.5` до `dsh-v0.2.2-rc.3` (Issue #9), довести до 100% русскую локализацию, обновить сабмодуль методологии до `v1.4.6`, перестроить линейку встроенных пресетов агентов (`strata-developer` по умолчанию, `standard`, `strata-analyst`, `strata-designer`, плюс скрытые за `developerTools` `ptc` и `cordis`, алиас `strata -> strata-developer` и компактный бейдж `'По умолчанию'`), исправить позиционирование и CSS-вёрстку экрана приветствия Desktop (`600×700`) и подготовить выпуск `1.1.0`.
- **Достигнутый этап:** Этап 6 (Закрытие задачи / `close-task`), завершены Этапы 1–5 и все тикеты `01`–`06`.
- **Что сделано:**
  1. Выполнено слияние `dsh-v0.2.2-rc.3` на ветку `sync/dsh-v0.2.2-rc.3` с сохранением трёхуровневой изоляции (`.strataharness`, `com.nikl.strataharness`, `strata://`), отключением телеметрии и OAuth, неактивным Dependabot, переносом апстримных воркфлоу в `.github/upstream-workflows/` и адаптацией под `window-drag-regions`.
  2. Обновлён пакет `@strata/locale-ru` (включая 5 новых модулей словарей `client-ui`, `experimental-capabilities`, `forge`, `liveshare`, `stats`, `523` записи `ruPluginMetadataCatalog`, короткий бейдж `'По умолчанию'`) и словарь оболочки Electron в `apps/desktop/src/locale.ts`.
  3. Переключён сабмодуль `resources/strataharness` на тег `v1.4.6` (`41` скилл методологии) и добавлена валидируемая карта `aliases` (`Record<string, string>`) в `AgentPresetRegistry`.
  4. Перестроена линейка пресетов в `@strata/product-bundle` и `@deepseek-ai/dsh-client-ui-agent-preset`: удалён пресет `strata` (настроен алиас `strata -> strata-developer` для старых сессий `1.0.x`), добавлены декларативные оверлеи для `standard`, `ptc` и `cordis` с единым `tool-result-pruner` (`thresholdChars: 32768`), скрыты `cordis` и кнопка черновика конструктора за `developerTools`, синхронизированы контракты Office и `delegation` под `dsh-v0.2.2-rc.3` (хостовой `skill-office` + пресетный `tool-office`), исправлена вёрстка заголовков карточек.
  5. Обновлено описание `welcomeDescription` для `ru`/`en`/`zh` и исправлена CSS-сетка окна приветствия `600×700` в `apps/desktop/renderer/welcome.css`.
  6. Версия продукта поднята до `1.1.0` (`dsh-v0.2.2-rc.3`), архитектурная запись [`2026-11-15-strata-preset-lineup-and-legacy-aliases.md`](../../.agents/notes/implemented/architecture/2026-11-15-strata-preset-lineup-and-legacy-aliases.md) переведена в `implemented/`, актуализирована запись [`2026-10-31-strata-russian-localization-pack.md`](../../.agents/notes/implemented/architecture/2026-10-31-strata-russian-localization-pack.md), подготовлено русское резюме [`docs/strata/releases/v1.1.0.md`](../strata/releases/v1.1.0.md) и устранены расхождения ревью Этапа 5.
- **Решения и нюансы (Gotchas & Decisions):**
  - В Vitest на Windows нельзя передавать префикс `packages/sandbox/sandbox` (подстрочно захватывает `sandbox-windows-acl` с зависанием дочерних restricted-token процессов) и голую папку `apps/desktop/tests` (`windows-cli-signals.spec.ts` ловит таймаут `CTRL_C_EVENT` во вложенной изоляции); передавайте точные `.spec.ts` пути.
  - На Windows при запуске `check:package` и `test:updates:local` в `PATH` каталог `C:\Windows\System32` (`bsdtar`) должен предшествовать Git `usr\bin`, а для `verify-cli-help` при нехватке ресурсов помогает `DSH_CLI_HELP_CONCURRENCY=1`.
  - В `dsh-v0.2.2-rc.3` пакет `skill-office` удалил опцию `cli` и безопасно монтируется на хосте (`web-app/cordis.patch.yml`), а пресеты подключают `@deepseek-ai/dsh-tool-office`; фикстуры `apps/desktop/tests/fixtures/{local-updater,update-dialogs}.mjs` используют `setBackgroundThrottling(false)` и `captureOptionalPage` для стабильной проверки в Windows-сессии Electron.
  - Пакеты `packages/strata/*` изолированы `strata(override)`-фильтрами в `scripts/gen-cordis-catalog.ts`, `scripts/gen-doc-graphs.ts` и `scripts/verify-subsystem-pages.ts` (включая `packages/strata/README.md`).
  - Два визуальных критерия приёмки (`AC 11` экран приветствия `600×700` и перетаскивание за шапку, `AC 12` заголовки карточек пресетов в Настройках) подтверждены автотестами разметки и могут быть при желании дополнительно проверены в живом окне командой `pnpm run start:desktop`.

---

## 2. Открытые тикеты (Open tickets)

none

---

## 3. Следующий шаг (Next step)

При необходимости выполнить быструю живую визуальную проверку UI (`pnpm run start:desktop`), затем переключиться на `main`, влить ветку `sync/dsh-v0.2.2-rc.3` (`git switch main && git merge --no-ff sync/dsh-v0.2.2-rc.3`), запустить `/strata-release` для создания аннотированного тега `strata-v1.1.0` и атомарного `git push --atomic` (который запустит сборку установщиков `win-x64`, `mac-arm64`, `mac-x64` в GitHub Actions), а после публикации релиза закрыть Issue #9.

---

## 4. Рекомендуемые скиллы (Recommended skills)

- `/strata-release` ([`.agents/skills/strata-release/SKILL.md`](../../.agents/skills/strata-release/SKILL.md)) — подготовка, тегирование `strata-v1.1.0` и подтверждаемый `git push --atomic` релизного конвейера.
- `dsh-pre-push-checks` ([`.agents/skills/dsh-pre-push-checks/SKILL.md`](../../.agents/skills/dsh-pre-push-checks/SKILL.md)) — таргетированные проверки перед отправкой ветки и тегов в удалённый репозиторий.
