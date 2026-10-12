# Task Coordination Foundation

English | [中文](task-coordination.zh.md)

Asynchronous task executors can opt into `TaskExecutorContext.coordination`. The facade belongs to the original task Job and owner Session. It exposes task-keyed shared JSON records, compare-and-set revisions, change waits, and a message channel to currently active task members.

Shared records are written as `plugin:task-strategy/shared-record` experimental Session records. Each write carries the JobId, key, next revision, writer SessionId, and a detached JSON value. A successful write waits for Session persistence flush; the record log remains outside model-visible conversation history. The experimental plugin-record catalog marks these records as best-effort across Session format migration.

The message channel uses the exact task owner as sender and accepts only a currently active member. Its receipt identifies inbox acceptance; it does not establish that the member read, understood, or adopted the message. An executor can use `members.continue()` for an explicit next turn on an idle session it created.

Record waits are cancelled with the task and release their timers and listeners. Other strategies retain their existing paths unless their executor explicitly consumes the optional context. Superpowers owns any blackboard schema, risk interpretation, meeting schedule, and adoption report built on this foundation.
