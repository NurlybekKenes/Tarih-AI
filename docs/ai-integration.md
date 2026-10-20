# AI integration

The provider is optional. With no complete configuration, `/api/chat` returns an explicitly marked `demo` answer assembled from matched knowledge records. If a configured compatible endpoint fails or returns invalid data, the endpoint returns a source-grounded excerpt in `fallback` mode.

Set these environment variables to enable the optional provider:

- `LLM_BASE_URL`: provider base URL, optionally ending in `/chat/completions`. For OpenRouter, use `https://openrouter.ai/api/v1`.
- `LLM_API_KEY`: secret key, read only from the environment.
- `LLM_MODEL`: model identifier.

For a free OpenRouter route, set `LLM_MODEL=openrouter/free`; this chooses among currently available free models, so the underlying model may vary. Requests have a 20 second timeout and a limit of 10 questions per client IP per minute. Source metadata is selected by the backend before the provider is called. Keep API keys in a local `.env` file and never commit that file.
