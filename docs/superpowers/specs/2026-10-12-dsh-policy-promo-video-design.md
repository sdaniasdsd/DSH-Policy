# DSH Policy Edition promotional video

English | [中文](2026-10-12-dsh-policy-promo-video-design.zh.md)

## Audience and purpose

Create a three-minute Chinese-language video that introduces the independently maintained DSH Policy Edition to potential users. Help viewers understand what the strategy layer adds to DSH and invite them to inspect the project repository.

## Recommended concept

Follow one development task from request to result. Show the strategy layer selecting a suitable workflow, arranging the work into stages, and exposing strategy and progress information while the original DSH agent loop executes child tasks. Use a cautious workflow example: two read-only inspections run in parallel before implementation.

This concept starts with a familiar user problem and demonstrates the product through one continuous example. A feature-catalog approach would cover more settings but could feel like a list. An architecture-first approach would be precise but require more background from new viewers.

## Narrative and timing

Target a three-minute runtime and approximately 700–950 Chinese characters, divided into 24–32 narration beats and visual shots. The content should follow this sequence:

1. A complex request can involve several distinct steps.
2. DSH Policy Edition adds a strategy layer before the original DSH execution loop.
3. The layer selects or accepts a workflow and arranges tasks into ordered stages; tasks in one stage can run concurrently within their configured limit.
4. The original DSH agent loop executes the child tasks; users can inspect stage progress and results.
5. The interface presents the selected strategy and scenario-based child-task token estimates.
6. Close by identifying the project as an independent experimental fork and directing viewers to its GitHub repository.

Use one development scenario throughout. Keep the explanation user-facing and visual; omit API and implementation details that do not help potential users decide whether to explore the project.

## Visual and audio direction

Use the explainer skill's code-drawn motion-graphics approach: a black canvas with a star-field background, white line art, purple emphasis, large readable Chinese text, narration subtitles, a chapter progress bar, and a compact HUD. Give each shot one main visual subject and maintain continuous motion. Use Chinese narration and synthesize it with a local or cloud TTS engine after the script is approved. Review the opening 30-second preview separately for visual style, font size, voice pace, and rhythm.

## Factual and editorial constraints

- Identify the project as an independently maintained experimental fork, not an official DeepSeek release.
- State that the strategy layer organizes and dispatches work while the original DSH agent loop executes child tasks.
- Describe token figures as scenario estimates, not billing amounts or hard execution limits.
- Do not imply that estimates prove savings, that a completed model turn guarantees correctness, or that the strategy layer adds permissions or filesystem isolation.
- Do not promise durable workflow recovery, automatic retries, or stable commercial support.
- Keep every on-screen number, term, and product claim traceable to the research notes and their primary-source URLs.

Primary sources: [project README](https://github.com/sdaniasdsd/dsh-change), [task-strategy package README](https://github.com/sdaniasdsd/dsh-change/blob/main/packages/experimental/task-strategy/README.zh.md), and [default-entry guide](https://github.com/sdaniasdsd/dsh-change/blob/main/docs/upgrade-guide/v0.2.0-rc.2/task-strategy-default-entry/guide.zh.md).

## Deliverables and review points

Create a standalone Remotion project in `DSH策略版宣传视频/`, separate from the DSH source repository. Deliver the editable project, approved narration and research notes, a rendered MP4, and a concise delivery note. Obtain approval of the narration before generating voice audio. Obtain approval of the opening 30-second preview before completing the remaining shot groups. Run the project's type, render, motion, and factual-claim checks before delivery.

## Completion criteria

- The approved narration fits the three-minute target and uses one consistent example.
- The final MP4 presents the project accurately, distinguishes it from the official DSH release, and includes a GitHub repository call to action.
- The visuals follow the selected motion-graphics direction, keep subtitles readable, and pass the explainer workflow's motion and factual-claim checks.
- The delivery folder contains the editable source, research sources, approved narration, final video, and remaining limitations.
