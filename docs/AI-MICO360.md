# Connecting MICO360 AI

MICO360 AI is the AI platform of MICO360 Connect. Its OpenAI-compatible API is what MICO360 Tasks
uses, as its *API guide* describes (`docs/API-Guide.md` in MICO360 Connect).

## Connect it

1. In MICO360 Connect's console, **AI Platform → Applications & keys → Issue key** (an Admin). Allow it
   the `Chat` capability. Its *Max concurrency* (default 4) should be at least the concurrency of the
   models you switch on in Tasks.
2. In MICO360 Tasks, **AI Management → Connect a provider → Service: MICO360 AI (our AI platform)**.
   Paste the key (`mico_…`) and press **Connect & load models**. The address is filled in:
   `http://ai.mico360.com:5310/v1` — port **5310** and **/v1** both matter.
3. The models load by themselves. Text models (for example `llama3.1:latest`, `qwen2.5:0.5b`) are
   offered for chat; document readers such as `glm-ocr` and embedding models are not.
4. Press **Test** on the chat model you want. The first answer of the day can take 20–90 seconds while
   the platform loads the model; later ones take a few seconds.

## What Tasks does for it

| The guide says | Tasks |
|---|---|
| Wait at least 120 s; 180 s for long answers (a cold model loads in 20–90 s) | Waits 120 s for an answer, 180 s for the Final MOM draft, and 120 s for **Test** |
| `response_format: {"type": "json_object"}` holds the model to JSON (2.6.7+) | Describe a task, the checklist, priority suggestions and the Final MOM ask for it; the project summary is plain text |
| `429` with `Retry-After: 1` when the key's concurrency is full | Waits and retries once; a longer wait (a quota) is reported as "busy" |
| `503` when no node can serve, `504` when too slow, `413` over 32,000 characters | Plain messages to people; the platform's own reason on the admin's **Test** |
| A base URL without `/v1` gets a `wrong_base_url` hint | The hint is shown on the provider's card |
| Plain HTTP: the key travels unencrypted | AI Management says so under the address |
| Never `n` ≠ 1 or tools; at most 32,000 characters a conversation | Never sent; the longest Tasks prompt (the minutes) stays under 13,000 |

## If it doesn't work

- **"No response" / "did not respond in time" on Test:** the server running Tasks must be able to open
  outbound connections to port **5310**. Some hosting plans allow only 80/443 — then ask for the
  platform on 443 (TLS) or for outbound 5310 to be opened.
- **"The provider did not accept the API key":** the key is wrong, disabled, expired, issued on another
  server, or the address is outside its *Allowed IPs* (see the guide, §9).
- **"No model available right now (HTTP 503)":** no AI node with a chat model is online; check
  **AI Platform → Nodes** and **Models** in MICO360 Connect.
- **A model never answers:** check it is a chat model (not `glm-ocr`) and switched on in both places.
