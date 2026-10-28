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

A later model-only stock probe exposed a failure: Gemini's OpenAI-compatible endpoint timed out after 40,012 ms across two attempts; OpenRouter returned HTTP 200 after 650 ms but its proposal failed the grounding check, so the app asked for clarification and changed no stock. A separate compatible-endpoint probe succeeded in 18,375 ms, while a native Gemini probe succeeded in 5,432 ms then timed out on its second request after 20,023 ms. Free endpoint responsiveness is intermittent. The application now gives Gemini one 20-second attempt before using OpenRouter; OpenRouter has a 20-second total request budget. This is a latency bound, not a service-level guarantee.

After that change, the production app sent “Please increase Maggi inventory by five packets” to Gemini: HTTP 200 in 9,367 ms. Chrome displayed the approval prompt in 11,850 ms, and the synthetic demo stock stayed at 71. After refresh and “हाँ,” the trusted tool saved the change in 1,728 ms; Chrome and a direct Supabase owner query both showed 76 packets. The model proposed the action; the server-owned confirmation and database function performed the write. Local Gemini primary remains an evaluated setting with OpenRouter fallback, not a claim of uninterrupted free-tier reliability.

The structured stock proposal now accepts a fractional number, and the shared parser preserves `2.5` and Devanagari `२.५` instead of splitting them. A separate browser sale with “2.5 kilo chini 40 rupaye kilo bech do” matched the saved “चीनी” product, showed a ₹100 draft, and saved only after explicit confirmation. Supabase returned quantity `2.500`, line total `100.00`, and remaining stock `5.250` kg. This sale used the deterministic parser and trusted database path; it is not counted as a Gemini model accuracy probe.

## Earlier OpenRouter comparison, 8 October 2026

Run on 2026-10-08 against OpenRouter's live free model IDs. All three saw the same ten synthetic Hindi, Hinglish, and English merchant commands: stock increases and decreases, product stock checks, khata balance and credit, and today's sales. Requests carried five proposed tool definitions. The script only evaluated responses with the existing Zod tool-call schema; it did not connect to Supabase or execute any business tool. Latency excludes API errors.

| Free model ID | Correct intent + arguments | Schema-valid single tool calls | API errors | Average / p50 success latency |
| --- | ---: | ---: | ---: | ---: |
| `google/gemma-4-26b-a4b-it:free` | 0/10 | 0/10 | 10 × HTTP 429 | n/a |
| `google/gemma-4-31b-it:free` | 1/10 | 1/10 | 9 × HTTP 429 | 2.2s / 2.2s (one success) |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 8/10 | 8/10 | 0 | 5.8s / 4.6s |

Nemotron was the only route reliably available during this run. Two responses contained text but no tool call. A five-case probe with `tool_choice=required` still produced only two valid tool calls, so the application treats absent calls as unsupported and never invents an action. Free endpoint availability can change; this is a small, time-specific comparison, not a general model ranking. The selected model remains configurable with `OPENROUTER_MODEL` and must end in `:free`.
