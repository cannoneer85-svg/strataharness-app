# Handoff: Нативная сборка `mac-x64` на `macos-15-intel` в релизном пайплайне (`fix-macos-x64-release`)

## Состояние

- **Цель:** Устранить падение матричной сборки `Package macOS (mac-x64)` на 60-секундном таймауте холодного старта `x86_64` `LibreOffice` в `smokeDesktopRuntime` (`docx → pdf`) под эмуляцией Rosetta 2 на 3-ядерном ARM64-раннере `macos-15`, сохранив трёхплатформенную атомарность боевых релизов (`win-x64`, `mac-arm64`, `mac-x64`).
- **Достигнутый этап:** Этап 6 — Закрытие задачи (`/close-task`); маршрут `Development` / `Minor` (этапы `1 → 4 (In-Place) → 5 → 6`) и трёхосевое ревью (`/code-review`: `Standards`, `Spec`, `Adversary`) успешно завершены.
- **Что сделано:**
  - В [strata-macos-package.yml](../../.github/workflows/strata-macos-package.yml) выбор раннера переведён на `runs-on: ${{ matrix.target == 'mac-x64' && 'macos-15-intel' || 'macos-15' }}`: `mac-arm64` собирается на Apple Silicon `macos-15`, а `mac-x64` собирается и проходит smoke-тест упакованного приложения нативно на Intel `macos-15-intel` без JIT-трансляции Rosetta 2.
  - В [strata-macos-package.yml](../../.github/workflows/strata-macos-package.yml) шаг установки Rosetta 2 заменён на раннюю `fail-fast` проверку нативной архитектуры `Verify native runner architecture matches requested macOS target`: до `actions/checkout` сверяются `/usr/bin/uname -m` (`arm64` для `mac-arm64`, `x86_64` для `mac-x64`) и `/usr/sbin/sysctl -in sysctl.proc_translated` (отказ `exit 1`, если процесс раннера запущен под трансляцией Rosetta 2).
  - В шаге `Cache pnpm store` ([strata-macos-package.yml](../../.github/workflows/strata-macos-package.yml)) удалён архитектурно-нейтральный fallback-префикс из `restore-keys`, чтобы кэш `pnpm` был строго изолирован по `${{ matrix.target }}` наравне с кэшем `strata-desktop-runtime`.
  - Расширены контрактные тесты в [strata-workflows.spec.ts](../../scripts/strata/strata-workflows.spec.ts) (проверки `macos-15-intel` / `macos-15`, отсутствия `--install-rosetta`, проверок `uname -m` и `sysctl.proc_translated`, а также изоляции `key` и `restore-keys` обоих шагов `actions/cache`).
  - Синхронизированы эксплуатационный ранбук [fork-maintenance.md](../strata/fork-maintenance.md) и двуязычная архитектурная заметка [2026-10-29-strata-release-distribution-and-upstream-radar.md](../../.agents/notes/implemented/process/2026-10-29-strata-release-distribution-and-upstream-radar.md) / [2026-10-29-strata-release-distribution-and-upstream-radar.zh.md](../../.agents/notes/implemented/process/2026-10-29-strata-release-distribution-and-upstream-radar.zh.md) (включая обоснование отказа от Rosetta 2 в CI в разделе `Alternatives considered` и обновлённый хеш `.i18n.yaml`).
- **Важные эксплуатационные нюансы (Gotchas):**
  - В локальной ветке `main` теперь находятся два неотправленных коммита поверх `origin/main`: фильтр каналов `rc` для радара апстрима (`upstream-radar-channel-filter`) и перевод `mac-x64` на `macos-15-intel` (`fix-macos-x64-release`).
  - После `git push origin main` пересоздавать или двигать тег `strata-v1.0.0` не требуется: ручной запуск `Strata Atomic Desktop Release` ([strata-release.yml](../../.github/workflows/strata-release.yml)) кнопкой `Run workflow` на ветке `main` (`signing_mode: auto`, `targets: all`, `draft: false`, `prerelease: false`) использует исправленный пайплайн из `main`, автоматически определяет `releaseTag = strata-v1.0.0` из [strata-product.json](../../strata-product.json) (`"productVersion": "1.0.0"` в [`runReleasePreflight`](../../scripts/strata/release-helper.ts)) и публикует боевой GitHub Release `StrataHarness v1.0.0` на тег `strata-v1.0.0` после успеха всех трёх платформ (`win-x64`, `mac-arm64`, `mac-x64`).

## Открытые тикеты

none

## Следующий шаг

1. Отправить локальные коммиты ветки `main` в удалённый репозиторий: `git push origin main`.
2. Во вкладке **Actions** на GitHub нажать **Run workflow** (ветка `main`) для:
   - **Strata Atomic Desktop Release** (`signing_mode: auto`, `targets: all`, `draft: false`, `prerelease: false`) — чтобы собрать все три платформы с нативным `macos-15-intel` для `mac-x64` и опубликовать релиз `StrataHarness v1.0.0`;
   - **Strata Upstream Release Radar** (`channel: rc`, `dry_run: false`) — чтобы обновить открытый Issue радара с отфильтрованным релиз-кандидатом `dsh-v0.2.1-rc.5` вместо `dsh-v0.2.2-alpha.2`.

## Рекомендуемые скиллы

- Ручной мастер подготовки и выпуска релиза продукта (`/strata-release`): `.agents/skills/strata-release/SKILL.md`
- Выбор минимального набора локальных проверок перед пушем: `.agents/skills/dsh-pre-push-checks/SKILL.md`
- Этап 1 (Интервью разработки): `.agents/skills/grill-with-docs/SKILL.md`
- Роутер скиллов и маршрутов: `.agents/skills/ask/SKILL.md`
