# Передача контекста: Полная интеграция воркфлоу StrataHarness, исправление профиля `strata`, инсталлятора и таймаута `office-kit` (strata-workflow-full-integration)

**Дата:** 2026-11-17
**Целевая ветка:** `main`
**Текущий тег продукта в манифесте:** `1.1.1` (предыдущая попытка релиза `strata-v1.1.1` выявила обрезку кнопок русского инсталлятора Windows NSIS, сбой `Unknown agent preset: strata` на старых профилях и таймаут `office-kit` на `mac-x64`)
**Базовый тег апстрима:** `dsh-v0.2.2-rc.3`
**Сабмодуль методологии:** `v1.4.6`

---

## Состояние

- **Цель:** Завершить интеграцию воркфлоу StrataHarness в приложение и репозиторий ([спека 0007](../specs/0007-strata-workflow-full-integration-spec.md)): выстроить линейку из 4 пресетов во главе со «Стандартным режимом», устранить ошибку `Unknown agent preset: strata` на обновлённых профилях `1.0.x` (и новых, и возобновляемых сессиях), автоматизировать подготовку каркаса проектной памяти без ручного `/init-project` и настроить автоподгрузку `CODING_STANDARDS.md`, привести репозиторий к эталону `v1.4.6`, исправить геометрию русских кнопок установщика Windows NSIS и таймаут LibreOffice при упаковке `mac-x64`.
- **Достигнутый этап:** Этап 6 (Закрытие задачи `/close-task`); все 3 тикета (`01`, `02`, `03`), финальная верификация (Этап 4) и параллельное ревью по осям `Standards`, `Spec` и `Adversary` (Этап 5) полностью завершены.
- **Что сделано:**
  1. **Линейка из 4 пресетов и авто-каркас проектной памяти:** В [`packages/strata/product-bundle/cordis.patch.yml`](../../packages/strata/product-bundle/cordis.patch.yml) и оверлеях пресетов режим `standard` поставлен первым (`order: 1`, `default: standard`, без `bundledSkillDir`), за ним сгруппированы `strata-developer` (`2`), `strata-analyst` (`3`) и `strata-designer` (`4`), а `preset-minimal`, `preset-ptc` и `preset-cordis` отключены (`disabled: true`, удалены `ptc.patch.yml` и `cordis.patch.yml`). В ролевых пресетах `Strata` до `agent-instructions` смонтирован [`workspace-scaffold.ts`](../../packages/strata/product-bundle/src/workspace-scaffold.ts) (`@strata/product-bundle/workspace-scaffold`), который на `agent/pre-step` с очередью сериализации `scaffoldLocks` и `realpathSync`-канонизацией (защита FS root, `os.homedir()`, `os.tmpdir()`) идемпотентно материализует `.agents/` и `docs/{adr,agents,analysis,handoff,research,specs}/` со стартовыми файлами без `.agents/skills/` и `AGENTS.md`, а `CODING_STANDARDS.md` добавлен в `instructionFileCandidates` во всех 4 активных пресетах. Из Шага 0 `strata-developer` убрано ручное напоминание `/init-project`, а локализация плагина добавлена в `@strata/locale-ru`.
  2. **Защита алиаса `strata` и атомарная миграция профиля Desktop:** В [`AgentPresetRegistry`](../../packages/preset/agent-preset-registry/src/index.ts) дефолт схемы `Config.aliases` установлен в `{ strata: 'strata-developer' }` с безопасным откатом `defaultId`, а в [`DesktopProjectManager`](../../apps/desktop/src/project-manager.ts) добавлена `migrateLegacyPresetPatch` с атомарной записью через `writeFileAtomic` (`mode: 0o600`, защищённый `try/catch`) для очистки устаревших `default: strata` / `selectedDefault: strata` в `profiles/desktop/cordis.patch.yml` при сохранении пользовательских настроек и выражений `!!js`.
  3. **Инсталлятор Windows NSIS и таймаут `office-kit`:** В [`pages.nsh`](../../apps/desktop/installer/pages.nsh) и [`theme.nsh`](../../apps/desktop/installer/theme.nsh) `$InstallerChoose` расширен до `240` px (`X = 180`), а `INSTALLER_BUTTON_WIDTH` / `INSTALLER_BUTTON_X` — до `200` / `200`; конфигурация `id: office-kit` (`timeoutMs: 120000`) задана декларативно в [`smoke-runtime.ts`](../../apps/desktop/scripts/smoke-runtime.ts) (`SMOKE_PROFILE_PATCH_YAML`) и в [`packages/strata/product-bundle/cordis.patch.yml`](../../packages/strata/product-bundle/cordis.patch.yml) без правки апстримного `@deepseek-ai/dsh-office-kit`.
  4. **Эталон репозитория `v1.4.6` и документация:** Созданы корневой [`CODING_STANDARDS.md`](../../CODING_STANDARDS.md), `docs/adr/.gitkeep`, `docs/research/.gitkeep`; обновлены исключения в `stage-dsh-docs.ts`, `repo-files.ts`, `translation-pairing.manifest.json`; синхронизированы `setup-pre-commit` и `migrate-to-shoehorn` (`63` скилла в [`.agents/SKILLS.md`](../../.agents/SKILLS.md) и `.claude/skills/`); актуализированы Agent Notes ([2026-11-15](../../.agents/notes/implemented/architecture/2026-11-15-strata-preset-lineup-and-legacy-aliases.md) и [2026-10-31](../../.agents/notes/implemented/architecture/2026-10-31-strata-russian-localization-pack.md)), package README и графы событий [`docs/event-producer-consumer.md`](../event-producer-consumer.md) и [`docs/event-producer-consumer.zh.md`](../event-producer-consumer.zh.md).
- **Решения и нюансы:** На Windows запуск полного `doc-sync` требует `DSH_CLI_HELP_CONCURRENCY=1`, чтобы 12 параллельных `tsx`-процессов `gen-cli-help` не упирались в 30-секундный таймаут на `acp --help` (подтверждены 43 из 43 гейтов `doc-sync`, `build` 10/10, `typecheck` 5/5, `lint` 0 ошибок, `test:docs` 21/21, `strata:audit-overrides` 6/6, `Test-Template.ps1` и 191 preflight-тест). В UI собранного Desktop-приложения остаётся только ручная визуальная проверка критерия `AC 10`.

---

## Открытые тикеты

none

---

## Следующий шаг

Выполнить `/strata-release` на ветке `main` для подготовки и выпуска следующего релиза `StrataHarness Desktop` (и при финальной ручной приёмке убедиться по `AC 10`, что в UI отображаются 4 пресета со «Стандартным режимом» по умолчанию, старые и новые сессии открываются без ошибки `Unknown agent preset: strata`, а в ролевых пресетах `Strata` авто-каркас и `/retro` работают сразу).

---

## Рекомендуемые скиллы

- `/strata-release` ([`.agents/skills/strata-release/SKILL.md`](../../.agents/skills/strata-release/SKILL.md)) — проверка чистоты дерева, превью changelog, русское описание релиза, локальный тег `strata-v*` и подтверждённый `git push`.
- `/retro` ([`.agents/skills/retro/SKILL.md`](../../.agents/skills/retro/SKILL.md)) — при необходимости зафиксировать улучшения гейтов или стандартов по итогам цикла.
