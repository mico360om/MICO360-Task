# Connecting MICO360 AI

MICO360 AI is the AI platform of MICO360 Connect. MICO360 Tasks uses its OpenAI-compatible API as its
*API guide* describes it (`docs/API-Guide.md` in MICO360 Connect). **Checked against the guide for
Connect 2.6.28** (11 November 2026); the server's own version is at `https://ai.mico360.com:5310/api/status`.

## Connect it

1. In MICO360 Connect's console, **AI Platform → Applications & keys → Issue key** (an Admin). Allow it:
   - **Chat** — every AI feature;
   - **Vision** — if Tasks should read scanned files and pictures (search reads them with a picture model);
   - **Embedding** — if Tasks should search by meaning.

   An empty list allows everything. Its *Max concurrency* (default 4) is shared by every model the key
   uses: set it to at least the total of the models' concurrency switched on in Tasks.
2. In MICO360 Tasks, **AI Management → Connect a provider → Service: MICO360 AI (our AI platform)**.
   Paste the key (`mico_…`) and press **Connect & load models**. The address is filled in:
   `https://ai.mico360.com:5310/v1` — **https**, port **5310** and **/v1** all matter. Since Connect
   2.6.17 (21 October 2026) port 5310 speaks only HTTPS: plain `http://` gets no answer, and the IP
   address fails the certificate check. A provider saved earlier with `http://ai.mico360.com…` is called
   on https by itself.
3. The models load by themselves. Text models (for example `llama3.1:latest`, `qwen2.5:0.5b`) are
   offered for chat; picture readers such as `glm-ocr` are offered for OCR, and embedding models (for
   example `nomic-embed-text`) for meaning search — switch on the ones you want.
4. Press **Test** on the chat model you want. The first answer of the day can take 20–90 seconds while
   the platform loads the model; later ones take a few seconds.

## What Tasks does for it

| The guide says (Connect 2.6.28) | Tasks |
|---|---|
| `https://ai.mico360.com:5310/v1`, HTTPS only since 2.6.17 | The preset's address; an `http://ai.mico360.com…` address is used as https |
| `Authorization: Bearer <key>` | Sent with every request |
| Wait at least 120 s; 180 s for long answers; the platform itself waits 300 s (a vision job may run 300 s) | Waits 120 s for an answer and for **Test**, 180 s for the minutes MICO AI drafts. Background work — reading scans and pictures, and the Final MOM drafted with AI (the meeting page runs it as a background job) — waits 310 s (just past the platform's 300 s, so its own answer comes first); the meaning-search sweep 120 s. One run of reading scans starts no new file after 2 minutes |
| `response_format: {"type": "json_object"}` holds the model to JSON (2.6.7+) | Every feature that reads a JSON answer asks for it; the project summary is plain text |
| A conversation is at most 32,000 characters, system messages included (`413` over it) | Every feature's prompt fits at its largest: Describe a task / a meeting and Draft agenda fit their project and people lists to the room left (the people and projects the sentence names first), and MICO AI's running summary sends only its newest messages; a test checks each feature. Other providers' prompts are unchanged |
| `429`: the key's concurrency (`Retry-After: 1`), its rate limit (until the minute ends) or a quota ("Quota exceeded: …", until the period resets) | A "try again in a second" is waited out once; a rate limit reads "busy"; a quota reads "the usage allowance is used up for now". Background work tries a quota again only if it resets within 5 minutes; files waiting to be read wait until it resets, and meaning search pauses 15 minutes |
| `503` when no node can serve, `504` when too slow | Plain messages to people; the platform's own reason on the admin's **Test** |
| Embeddings: at most 64 texts, 8,000 characters each, 32,000 together; no blank text | Texts are packed into as many requests as needed, a long one cut (never inside a character), a blank one sent as "(no text)" |
| Another model may answer when the named one is unavailable (`X-Mico-Model-Warning`, the answer's `model`) | Chat: the answer is used. Embeddings: vectors from another model are not kept (they can't be compared); meaning search pauses 15 minutes and tries again |
| `/v1/models` lists only the models of nodes accepting work right now (a busy node's are left out for a while) | A model missing from the list stays available for 3 days; an empty list changes nothing, is noted on the provider and is loaded again within the hour |
| A base URL without `/v1` gets a `wrong_base_url` hint | The hint is shown on the provider's card |
| (Not in the guide) a strict JSON reader may refuse half a character, such as a cut emoji | Never sent: texts are cut on whole characters and sent well formed |
| Never `n` ≠ 1 or tools | Never sent |

## If it doesn't work

- **"Could not reach the AI provider" / "did not respond in time" on Test:** check the address is
  `https://ai.mico360.com:5310/v1`, and that the server running Tasks can open outbound connections to
  port **5310** — some hosting plans allow only 80/443; then ask for outbound 5310 to be opened.
- **"The provider did not accept the API key":** the key is wrong, disabled, expired or deleted, issued on
  another server, or the address is outside its *Allowed IPs* (see the guide, §9).
- **"The AI provider rejected the request (HTTP 403)":** the key may not use that capability (Chat,
  Vision, Embedding) or that model — allow it on **Applications & keys**.
- **"No model available right now (HTTP 503)":** no AI node with a suitable model is online; check
  **AI Platform → Nodes** and **Models** in MICO360 Connect. For scans and pictures a node needs a
  picture model (`ollama pull glm-ocr:latest`); for meaning search an embedding model
  (`ollama pull nomic-embed-text`).
- **"The usage allowance is used up for now (HTTP 429)":** the key's quota (requests, tokens, pages) is
  used up until its period resets; an administrator can check it in MICO360 Connect.
- **"MICO360 AI listed no models right now":** its AI nodes were busy or offline when the list was
  loaded; the models stay as they were and the list loads again within the hour (or press **Refresh models**).
- **A model never answers:** check it is a chat model (not `glm-ocr`) and switched on in both places.
