# Agent Note: Keep output-limit outcome separate from step scheduling

Status: implemented

English | [中文](2026-10-13-agent-loop-output-limit-continuation.zh.md)

## Problem

A model response can end at its per-response output limit while a later user continuation still needs ordinary tool execution. The loop retained `max-tokens` as the turn outcome, but also used that durable outcome to decide whether the current step owed another request. When the continued response called a tool, the step returned no completion reason, yet the sticky turn outcome stopped the loop before it could send the committed tool result back to the model.

## Decision

The [agent loop](../../../../packages/core/agent-loop/src/agent.ts) tracks step-local scheduling separately from the durable turn-end reason. A step that calls tools continues to another request even when an earlier step made `max-tokens` the sticky turn outcome; `turn/end` still records `max-tokens` after the follow-up completes.

The chat continuation action records an explicit localized user message that says the prior answer was truncated, asks the model to continue from the stopping point without repeating completed content, and asks it to split long remaining work into smaller parts. This preserves the user's existing composer draft and makes the continuation instruction reconstructable from the Session log.

## Alternatives considered

**Raise the adapter's default output-token limit.** Rejected: server-side limits vary, reasoning and visible output share provider budgets, and a larger request cap cannot repair a loop that skips a required tool-result request.

**Keep using the durable turn outcome as the scheduling signal.** Rejected: `max-tokens` is intentionally sticky for the completed turn, while a tool-call step has no step-completion reason and still owes another model request.

**Send only a generic “Continue” message.** Rejected: the model may repeat an oversized response because the durable history does not explain why the prior assistant message stopped or how to bound the remaining output.

## Consequences

Users can continue a truncated answer through the existing Conversation send path; the instruction appears as a normal durable user message, and any tool calls in the truncated provider attempt remain undispatched. The turn keeps its `max-tokens` outcome for status and history while later steps can finish the work. This does not change the provider's output cap or promise that every remaining answer fits in one request.

## Testing

The agent-loop regression test covers max-tokens, a steered continuation, a tool call, the subsequent request containing its committed tool result, the final answer, and the sticky turn-end reason. UI tests cover the localized continuation action and visible reasoning expansion.
