# Reasoner benchmarks

## Gemini and OpenRouter, 28 October 2026

The server-side key was detected without printing it. Google returned HTTP 200 for the `gemini-3.5-flash-lite` model endpoint. The older `gemini-2.5-flash-lite` endpoint returned HTTP 404, so the app pins the available model. The free-tier pricing page lists this model, but the API did not expose a numeric remaining request quota or the project's billing state. No billing was enabled for these tests.

These were bounded live calls with required structured tool output. They measured the provider, not Supabase writes:

| Probe | Gemini `gemini-3.5-flash-lite` | OpenRouter Nemotron free |
| --- | --- | --- |
| Hindi 10 ice creams, follow-up unit price ₹25 | Correct 10 × ₹25 proposal, HTTP 200, 2,502 ms | HTTP 200 in 10,055 ms, but no function call |
| Hindi 2.5 kg sugar at ₹40/kg | Correct ₹100 proposal, HTTP 200, 1,313 ms | Timed out after 20,009 ms |
| Ambiguous “पाव तेल देना” | Asked for the missing unit, HTTP 200, 4,923 ms | Not probed |
| Hinglish ₹50 repayment | Safe repayment proposal, HTTP 200, 1,114 ms | Not probed |
| No-price stock request with an injected instruction | Asked for price without saving, HTTP 200, 5,760 ms | Not probed |

In the real production app, a Hindi supplier-list request reached Gemini with HTTP 200 and an 11,518 ms provider trace; the browser received the database-grounded answer in 14,601 ms. A fresh browser run after setting `AI_REASONER=gemini` in local configuration returned the three saved suppliers in Hindi in 12,256 ms; that run did not record a provider trace. Browser stock flows separately proved that a proposed change did not write until approval and that a confirmed change survived refresh and appeared in Supabase. OpenRouter remains configured as a fallback for Gemini provider failures. This small probe supports the local primary choice; it does not establish universal accuracy, guaranteed free-tier availability, or a quota balance.

## Earlier OpenRouter comparison, 8 October 2026

Run on 2026-10-08 against OpenRouter's live free model IDs. All three saw the same ten synthetic Hindi, Hinglish, and English merchant commands: stock increases and decreases, product stock checks, khata balance and credit, and today's sales. Requests carried five proposed tool definitions. The script only evaluated responses with the existing Zod tool-call schema; it did not connect to Supabase or execute any business tool. Latency excludes API errors.

| Free model ID | Correct intent + arguments | Schema-valid single tool calls | API errors | Average / p50 success latency |
| --- | ---: | ---: | ---: | ---: |
| `google/gemma-4-26b-a4b-it:free` | 0/10 | 0/10 | 10 × HTTP 429 | n/a |
| `google/gemma-4-31b-it:free` | 1/10 | 1/10 | 9 × HTTP 429 | 2.2s / 2.2s (one success) |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 8/10 | 8/10 | 0 | 5.8s / 4.6s |

Nemotron was the only route reliably available during this run. Two responses contained text but no tool call. A five-case probe with `tool_choice=required` still produced only two valid tool calls, so the application treats absent calls as unsupported and never invents an action. Free endpoint availability can change; this is a small, time-specific comparison, not a general model ranking. The selected model remains configurable with `OPENROUTER_MODEL` and must end in `:free`.
