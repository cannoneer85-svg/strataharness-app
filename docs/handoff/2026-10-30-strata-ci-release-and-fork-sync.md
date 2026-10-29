# Handoff: Фаза 4 MVP — Кроссплатформенный CI/CD, канал релизов/обновлений и регламент сопровождения Soft-Fork

## Состояние

- **Цель:** Завершить Фазу 4 (финальную фазу MVP) десктоп-приложения `StrataHarness` (`Windows win-x64 .exe` + `macOS mac-arm64 / mac-x64 .dmg + .zip`): внедрить двухконтурное версионирование `1.0.0` поверх `dsh-v0.2.1-rc.4`, изолировать 25 апстримных пайплайнов GitHub Actions, создать собственные пайплайны упаковки и атомарного релиза без Tencent COS и `*.deepseek.com`, реализовать CLI сопровождения `Soft-Fork` и радар обновлений апстрима, квалифицировать локальный установщик и автообновление на Windows и задокументировать эксплуатационный ранбук.
- **Достигнутый этап:** Этап 6 — Закрытие задачи (`/close-task`); все 6 тикетов реализации (`01..06`), трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) и preflight-гейты завершены на 100%.
- **Что сделано:**
  - Утверждена спецификация [0001-strata-ci-release-and-fork-sync-spec.md](../specs/0001-strata-ci-release-and-fork-sync-spec.md) и переведены в `implemented/` три двуязычные архитектурные записи Agent Notes: [2026-10-29-strata-dual-track-product-versioning.md](../../.agents/notes/implemented/architecture/2026-10-29-strata-dual-track-product-versioning.md), [2026-10-29-upstream-workflow-relocation-isolation.md](../../.agents/notes/implemented/process/2026-10-29-upstream-workflow-relocation-isolation.md) и [2026-10-29-strata-release-distribution-and-upstream-radar.md](../../.agents/notes/implemented/process/2026-10-29-strata-release-distribution-and-upstream-radar.md).
  - Внедрён корневой манифест [strata-product.json](../../strata-product.json) (`productVersion: "1.0.0"`, `upstreamBaseTag: "dsh-v0.2.1-rc.4"`): пакеты `@strata/product-bundle` и `@strata/ui-brand`, имена установщиков Electron (`strataharness-1.0.0-<os>-<arch>.*`), `DSH_CLIENT_VERSION`, `app.getVersion()` и теги релизов `strata-v*` используют продуктовую линейку `1.0.0`, тогда как более 100 пакетов `@deepseek-ai/dsh-*` остаются на `0.2.1-rc.4` без merge-конфликтов при слияниях `dsh-v*`; диалог `About StrataHarness`, `RELEASE_NOTES.md` и `strata:status` выводят также `Engine: DSH 0.2.1-rc.4`.
  - Все 25 апстримных пайплайнов побайтово перенесены через `git mv` (`100%` rename similarity) в `.github/upstream-workflows/`, а в `.github/workflows/` работают только 4 собственных пайплайна: [strata-windows-package.yml](../../.github/workflows/strata-windows-package.yml), [strata-macos-package.yml](../../.github/workflows/strata-macos-package.yml), [strata-release.yml](../../.github/workflows/strata-release.yml) и [strata-upstream-watch.yml](../../.github/workflows/strata-upstream-watch.yml).
  - Реализованы режимы подписи `auto` / `unsigned` / `signed` ([strata-signing-mode.mjs](../../apps/desktop/scripts/strata-signing-mode.mjs)), подпись Windows через `.pfx` (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`) с отказоустойчивой цепочкой из 3 RFC-3161 TSA серверов (`DigiCert` → `Sectigo` → `GlobalSign`) в [windows-sign.mjs](../../apps/desktop/scripts/windows-sign.mjs), статический HTTPS-фид `${DOWNLOAD_PROD_ORIGIN}/strataharness/feeds/<target>/` без Tencent COS и двухуровневая блокировка `deepseek.com` / `*.deepseek.com` как при сборке, так и в runtime-транспорте ([update-http-executor.ts](../../apps/desktop/src/update-http-executor.ts), [mandatory-update-policy.ts](../../apps/desktop/src/mandatory-update-policy.ts)).
  - Созданы CLI сопровождения форка [fork-ops.ts](../../scripts/strata/fork-ops.ts) (`strata:status`, `strata:version`, `strata:update-methodology`, `strata:audit-overrides`, `strata:check-upstream`, `strata:prepare-upstream-sync`), релизный оркестратор [release-helper.ts](../../scripts/strata/release-helper.ts) и русскоязычный эксплуатационный ранбук [fork-maintenance.md](../strata/fork-maintenance.md).
  - Локально собран и верифицирован установщик `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/strataharness-1.0.0-win-x64-unsigned.exe` (`check:package` PASS) и пройден сквозной интеграционный тест автообновления `pnpm --filter @deepseek-ai/dsh-desktop run test:updates:local` (`18/18` в реальном Electron `44.7.0`).
- **Важные эксплуатационные нюансы (Gotchas):**
  - В Windows `pwsh` каталог `C:\Program Files\Git\usr\bin` всегда должен располагаться **в конце** `$env:PATH` после `C:\Windows\System32`, чтобы системный `bsdtar` (`tar.exe`) не перекрывался GNU `tar` при упаковке архивов рантайма.
  - В публикуемых каталогах пакетов нельзя размещать файлы `.gitkeep` (они вырезаются `electron-builder` при упаковке в `app.asar` и нарушают сверку `verifyRuntimeArchive`).
  - При будущих коммитах правок поверх файлов апстрима необходимо сохранять префикс `strata(override): ...`, так как `strata:status` и `strata:check-upstream` вычисляют карту потенциальных конфликтов по `git log --basic-regexp --grep=^strata(override):`.

## Открытые тикеты

none

## Следующий шаг

1. Подключить собственный удалённый репозиторий GitHub `origin` (оставив `upstream` с `pushurl = DISABLED`), запушить ветку `main` и выполнить смоук-запуск `workflow_dispatch` пайплайна `strata-release.yml` в режиме `signing_mode: auto` (`draft: true`) для проверки облачной сборки `win-x64`, `mac-arm64` и `mac-x64` без сертификатов, либо выпустить релизный тег `strata-v1.0.0` по разделу 5 ранбука [fork-maintenance.md](../strata/fork-maintenance.md).
2. Любую новую задачу разработки или анализа начинать со **Шага 0** согласно корневому [AGENTS.md](../../AGENTS.md).

## Рекомендуемые скиллы

- Роутер скиллов и маршрутов: `.agents/skills/ask/SKILL.md`
- Этап 1 (Интервью разработки): `.agents/skills/grill-with-docs/SKILL.md`
- Этап 1 для категории `Fog` (Туман): `.agents/skills/wayfinder/SKILL.md`
- Маршрут исследования без правок кода (`Analysis`): `.agents/skills/analyze/SKILL.md`
- Выбор минимального набора локальных проверок перед пушем: `.agents/skills/dsh-pre-push-checks/SKILL.md`
