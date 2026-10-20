# AI integration

The provider is optional. With no complete configuration, `/api/chat` returns an explicitly marked `demo` answer assembled from matched knowledge records. If a configured compatible endpoint fails or returns invalid data, the endpoint returns a source-grounded excerpt in `fallback` mode.

Set these environment variables to enable the optional provider:

- `LLM_BASE_URL`: provider base URL, optionally ending in `/chat/completions`.
- `LLM_API_KEY`: secret key, read only from the environment.
- `LLM_MODEL`: model identifier.

The application makes no assumptions about KazLLM endpoints or model names. No provider key is configured or real model request has been made in this workspace. Requests have a 20 second timeout and a limit of 10 questions per client IP per minute. Source metadata is selected by the backend before the provider is called.
