<!-- Copied from docs/handoff/2026-11-16-fix-asar-gitkeep-and-ci-artifact-quota.md -->
# Передача контекста: Исправление целостности ASAR (.gitkeep) и квоты артефактов CI (fix-asar-gitkeep-and-ci-artifact-quota)

**Дата:** 2026-11-16
**Целевая ветка:** `main`
**Текущий тег продукта в манифесте:** `1.1.0` (`strata-v1.1.0` занят упавшей сборкой; следующий релиз планируется как `1.1.1` / `strata-v1.1.1`)
**Базовый тег апстрима:** `dsh-v0.2.2-rc.3`
**Сабмодуль методологии:** `v1.4.6`

---

## 1. Состояние (State)

- **Цель:** Устранить две причины падения облачного релиза `strata-v1.1.0` (GitHub Actions run `43859697161`): (1) `Error: desktop runtime: ASAR integrity verification failed` при упаковке Desktop под Windows и macOS (`win-x64`, `mac-arm64`, `mac-x64`) из-за попадания `docs/analysis/.gitkeep` и `docs/specs/.gitkeep` в инвентарь `desktop-runtime.json` и последующего отсеивания `.gitkeep` обходом `builder-util`; (2) `Failed to CreateArtifact: Artifact storage quota has been hit` в приватном репозитории `cannoneer85-svg/strataharness-app` из-за исчерпания 500-МБ квоты старыми промежуточными артефактами `v1.0.2` с 14-дневным сроком хранения.
- **Достигнутый этап:** Этап 6 (Закрытие задачи / `close-task`), завершены Этап 1 (`Minor`), Этап 4 (`In-Place` + сквозная локальная проверка `win-x64 --dir --unsigned`) и Этап 5 (`/code-review` с исправлением замечания Adversary).
- **Что сделано:**
  1. В [`apps/desktop/scripts/runtime-file-policy.ts`](../../apps/desktop/scripts/runtime-file-policy.ts) добавлено исключение файлов `.DS_Store` и `.gitkeep` при материализации `dsh/node_modules` до запечатывания `desktop-runtime.json`; регрессионный тест добавлен в [`apps/desktop/tests/runtime-file-policy.spec.ts`](../../apps/desktop/tests/runtime-file-policy.spec.ts).
  2. В [`scripts/stage-dsh-docs.ts`](../../scripts/stage-dsh-docs.ts) из стейджинга документации `@deepseek-ai/dsh` исключены операционные каталоги Strata (`analysis`, `specs`, `handoff`, `strata`) и файлы `.DS_Store` / `.gitkeep`; регрессионные проверки добавлены в [`scripts/stage-dsh-docs.spec.ts`](../../scripts/stage-dsh-docs.spec.ts).
  3. В [`.github/workflows/strata-windows-package.yml`](../../.github/workflows/strata-windows-package.yml) и [`.github/workflows/strata-macos-package.yml`](../../.github/workflows/strata-macos-package.yml) срок хранения `strata-dist-*` и `strata-packaging-runs-*` снижен с `14` до `1` дня (`retention-days: 1`), а загрузка диагностических логов переведена в `continue-on-error: true`.
  4. В [`.github/workflows/strata-release.yml`](../../.github/workflows/strata-release.yml) джобе `publish` выдано минимальное право `actions: write` и добавлен завершающий шаг (`if: success()`, `continue-on-error: true`) автоудаления временных артефактов `strata-dist-*` и `strata-packaging-runs-*` текущего `run_id` с использованием `--paginate` и явной проверкой ошибок `gh api` (вместо `<(...)` подстановки); security- и контрактные тесты обновлены в [`scripts/strata/strata-workflows.spec.ts`](../../scripts/strata/strata-workflows.spec.ts).
  5. Обновлена документация жизненного цикла временных сборочных артефактов в [`docs/strata/fork-maintenance.md`](../strata/fork-maintenance.md).
- **Решения и нюансы (Gotchas & Decisions):**
  - Местные 14-дневные артефакты релиза `v1.0.2` истекли `2026-11-16T13:01Z` (текущее занятое место в API `actions/artifacts` равно `0 МБ`), но биллинговый кэш квоты GitHub пересчитывается раз в `6–12` часов; повторный облачный релиз следует запускать после обнуления биллинговой квоты на стороне GitHub.
  - Тег `strata-v1.1.0` уже опубликован в `origin` на сборке с ошибкой упаковки и не подлежит перезаписи, при этом GitHub Release `v1.1.0` не создавался; следующий выпуск оформляется как **`1.1.1` (`strata-v1.1.1`)** со сводным русским резюме, объединяющим продуктовые изменения [`docs/strata/releases/v1.1.0.md`](../strata/releases/v1.1.0.md) и данный фикс упаковки.
  - Проверен сквозной прогон на Windows: `pnpm --filter @deepseek-ai/dsh-desktop run package -- win-x64 --dir --unsigned --build-version 1.1.0` (`verifyRuntimeArchive`, Host + Office smoke `exit 0`); macOS (`mac-arm64`, `mac-x64`) проверяется в CI при выпуске `v1.1.1`.

---

## 2. Открытые тикеты (Open tickets)

none

---

## 3. Следующий шаг (Next step)

Дождаться пересчёта квоты хранилища GitHub Actions (окно 6–12 часов после `2026-11-16T13:01Z`), затем запустить `/strata-release` на ветке `main` с целевой версией `1.1.1` (`strata-v1.1.1`), включив в русское резюме `docs/strata/releases/v1.1.1.md` все продуктовые улучшения из [`docs/strata/releases/v1.1.0.md`](../strata/releases/v1.1.0.md) и фикс целостности ASAR / очистки артефактов, выполнить подтверждённый `git push --atomic` и после зелёной публикации установщиков в GitHub Releases закрыть Issue #9.

---

## 4. Рекомендуемые скиллы (Recommended skills)

- `/strata-release` ([`.agents/skills/strata-release/SKILL.md`](../../.agents/skills/strata-release/SKILL.md)) — поднятие версии до `1.1.1`, подготовка сводного резюме `docs/strata/releases/v1.1.1.md`, локальное тегирование `strata-v1.1.1` и атомарная отправка в `origin`.
- `dsh-pre-push-checks` ([`.agents/skills/dsh-pre-push-checks/SKILL.md`](../../.agents/skills/dsh-pre-push-checks/SKILL.md)) — проверка области изменений и предпушевых гейтов перед отправкой ветки `main` и тега.
