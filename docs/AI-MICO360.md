# Connecting MICO360 AI

MICO360 AI is the AI platform of MICO360 Connect. MICO360 Tasks uses its OpenAI-compatible API (`/v1`)
and, for what only it offers, its native API (`/api/v1`), as its *API guide* describes them
(`docs/API-Guide.md` in MICO360 Connect). **Checked against the guide for Connect 2.6.28** (11 November
2026); the server's own version is at `https://ai.mico360.com:5310/api/status`, and AI Management shows it
on the provider's card.

## Connect it

1. In MICO360 Connect's console, **AI Platform → Applications & keys → Issue key** (an Admin). Allow it:
   - **Chat** — every AI feature;
   - **Ocr** — to read whole scanned files (every page of a PDF, black-and-white scans too, turned upright
     first) and pictures;
   - **Vision** — the picture reader (`glm-ocr`): Tasks falls back to it when whole-document reading isn't
     allowed or available;
   - **Embedding** — to search by meaning.

   An empty list allows everything. Its *Max concurrency* (default 4) is the key's budget for every model
   together: Tasks reads it (`GET /api/v1/status`, and every answer's `X-Mico-Concurrency-Limit`) and keeps
   all its AI work within it.
2. In MICO360 Tasks, **AI Management → Connect a provider → Service: MICO360 AI (our AI platform)**.
   Paste the key (`mico_…`) and press **Connect & load models**. The address is filled in:
   `https://ai.mico360.com:5310/v1` — **https**, port **5310** and **/v1** all matter. Since Connect
   2.6.17 (21 October 2026) port 5310 speaks only HTTPS: plain `http://` gets no answer, and the IP
   address fails the certificate check. A provider saved earlier with `http://ai.mico360.com…` is called
   on https by itself.
3. The models load by themselves. Text models (for example `llama3.1:latest`, `qwen2.5:0.5b`) are
   offered for chat; picture readers such as `glm-ocr` for OCR — **switching one on as the OCR model is
   what turns on reading scans**: whole documents first, that model when they can't be read whole —
   and embedding models (for example `nomic-embed-text`) for meaning search.
4. Press **Test** on the chat model you want. It says which model answered (the platform may answer with
   another when the one asked for is unavailable). The first answer of the day can take 20–90 seconds while
   the platform loads the model; later ones take a few seconds.

The provider's card shows, from the platform itself (read with the models, and again every day): the
Connect version it runs, how many requests the key may run at once, a note when **no AI node offers** Ocr,
Vision or Embedding (and what that stops), a note when **scans were read as pictures** (and why), and the
**stand-in models** — which model answered when another was asked for, how often, and when.

## What Tasks does for it

| The guide says (Connect 2.6.28) | Tasks |
|---|---|
| `https://ai.mico360.com:5310/v1`, HTTPS only since 2.6.17 | The preset's address; an `http://ai.mico360.com…` address is used as https |
| `/v1`: `Authorization: Bearer <key>`; native `/api/v1`: **only** `X-Mico-Api-Key` | Bearer on `/v1`; `X-Mico-Api-Key` on the native routes; no key to the keyless `GET /api/status` |
| `GET /api/status`: the server's version | Read with the models; on the provider's card |
| `GET /api/v1/models`: `capabilities` is what every connected node can do | Read with the models; the card lists what no node offers (Ocr, Vision, Embedding) |
| `GET /api/v1/status` and `X-Mico-Concurrency-Limit`: the key's concurrency, shared by every request | One budget for the key, sized from them (4 until known); each model's own "At once" still applies |
| `POST /api/v1/ocr` (multipart): every page of a PDF or picture, up to 64 MB and 500 pages, upright first, in `language` | Scans and pictures are sent whole while MICO360 AI's model is the OCR model; `language` is ar-SA or en-US when the task's words (else the file name, project and company) are Arabic or English, none when mixed; a language the node can't read, or one that reads almost nothing, is tried again without one (the text with more letters is kept). Scans that could not be read before (no page pictures) are read again, a few a minute, a day apart |
| `403` (no Ocr), `404` (older server), `503` (no OCR node) | Read as pictures instead (the first 5 pages of a PDF, as before), a note on the card; whole-document reading waits an hour (10 minutes after a 503) before it is tried again. A file it won't take (`415`) or one over its page limits goes to the pictures on its own; WebP pictures (which it doesn't read) always do. One file's reading — every request together — takes at most 5½ minutes; what isn't finished is tried again later and answered from its first reading |
| GLM-OCR works best asked plainly — `Text Recognition:` | The picture reader on MICO360 AI is asked one picture at a time, with only those words |
| `response_format: json_schema` holds the answer to a JSON Schema (≤16,000 characters) | Describe a task, Describe a meeting, Suggest priority, Draft agenda, the Final MOM and MICO AI send their schema; the checklist and meeting description ask for any JSON object; the summary is plain text. Tasks still checks every answer as before |
| `POST /api/v1/chat/stream`: Server-Sent Events while the model writes; `done` with `completed`, `failed`, `timed_out`, `client_too_slow` or `switched_to_artifact`; `sequence` with no gaps | MICO AI's answers are written live: the words so far show on the page (not an answer's figures before any data is behind them, which MICO AI would send back, and nothing of a try that waits to be tried again). A lost chunk, a stream that ended early or a `timed_out` one: the whole answer is collected from its job; `failed`: the job's error; a repeat still being answered (`409`): that one is collected; Stop ends it at once; a server without the stream: `/v1` as before |
| `Idempotency-Key`: a repeat with the same key gets the first answer | The Final MOM job, MICO AI's background answers and reading a scan send one, made from the job (or file) and the request, so their retries are answered from the first try's work |
| `504` keeps the job; collect it with `GET /api/v1/jobs/{jobId}` | Background work collects it, looking every few seconds — the Final MOM until 9 minutes after it asked, a scan within its 5½ minutes; the key's slot is free meanwhile |
| Wait at least 120 s; 180 s for long answers; the platform itself waits 300 s (a vision job may run 300 s) | Waits 120 s for an answer and for **Test**, 180 s for the minutes MICO AI drafts. Background work — reading scans and pictures, and the Final MOM — waits 310 s; the meaning-search sweep 120 s. One run of reading scans starts no new file after 2 minutes |
| Models stay loaded 30 minutes after use; a cold large model takes 20–90 s | A chat model that answered nothing for 25 minutes is cold: opening search warms it up (one tiny request, at most every 5 minutes, counted against nobody), and the AI search then waits up to 90 s instead of 20 |
| `X-Mico-Correlation-Id` follows a request; job ids name the work | Kept with an AI failure in the log and shown on the Error log's occurrence ("MICO360 AI · correlation id … · job …") — to look up under AI Platform → Jobs |
| `user` is pseudonymised before it is stored | Each request names the Tasks user it is for (background system work names none) |
| `created` in `/v1/models` is the time of the request | Not kept: "Automatic" ranks MICO360 AI's models by name and version only |
| A conversation is at most 32,000 characters, system messages included (`413` over it) | Every feature's prompt fits at its largest (the people and projects a sentence names first); MICO AI's running summary sends only its newest messages; a test checks each feature |
| `429`: the key's concurrency (`Retry-After: 1`), its rate limit, or a quota ("Quota exceeded: …") | A "try again in a second" is waited out once; a rate limit reads "busy"; a quota reads "the usage allowance is used up for now". Background work tries a quota again only if it resets within 5 minutes; files waiting to be read wait until it resets |
| `401`, `403`, `502` | Said plainly: the key isn't accepted (who can check it), the key may not do this (where to allow it), the model failed while answering (try again) |
| Embeddings: at most 64 texts, 8,000 characters each, 32,000 together | Texts are packed into as many requests as needed; vectors from another model than the one chosen are not kept |
| `/v1/models` lists only the models of nodes accepting work right now | A model missing from the list stays available for 3 days; an empty list changes nothing and is loaded again within the hour |
| Never `n` ≠ 1 or tools | Never sent |

Other AI providers (OpenAI, Anthropic, Gemini, Ollama…) are sent exactly what they were before: none of
the native routes, schemas, keys or live text above.

## If it doesn't work

- **"Could not reach the AI provider" / "did not respond in time" on Test:** check the address is
  `https://ai.mico360.com:5310/v1`, and that the server running Tasks can open outbound connections to
  port **5310** — some hosting plans allow only 80/443; then ask for outbound 5310 to be opened.
- **"MICO360 AI did not accept the API key (HTTP 401)":** the key is wrong, disabled, expired or deleted,
  issued on another server, or the address is outside its *Allowed IPs* (see the guide, §9).
- **"MICO360 AI's key may not be used for this (HTTP 403)":** the key may not use that capability (Chat,
  Vision, Embedding, Ocr) or that model — allow it on **Applications & keys**.
- **The card says scans were read as pictures:** whole-document reading was refused — HTTP 403: allow
  **Ocr** on the key; 404: the MICO360 Connect server needs updating; 503: no AI node could read documents
  then (it is tried again in a few minutes). Until then scans are read as pictures (the first 5 pages).
- **The card says no AI node offers Ocr, Vision or Embedding:** install a model that offers it on a node
  in MICO360 Connect (AI Platform → Ollama engine): `glm-ocr` reads pictures, `nomic-embed-text` makes
  meaning search work. Ocr comes with an AI node (2.6.7 or later).
- **"No model available right now (HTTP 503)":** no AI node with a suitable model is online; check
  **AI Platform → Nodes** and **Models** in MICO360 Connect.
- **"MICO360 AI's model failed while answering (HTTP 502)":** try again; if it keeps happening, look up the
  correlation id from the Error log under **AI Platform → Jobs**.
- **"The usage allowance is used up for now (HTTP 429)":** the key's quota (requests, tokens, pages) is
  used up until its period resets; an administrator can check it in MICO360 Connect.
- **"MICO360 AI listed no models right now":** its AI nodes were busy or offline when the list was
  loaded; the models stay as they were and the list loads again within the hour (or press **Refresh models**).
- **A model never answers:** check it is a chat model (not `glm-ocr`) and switched on in both places. If the
  card lists it as a stand-in, the platform has been answering with another model.
