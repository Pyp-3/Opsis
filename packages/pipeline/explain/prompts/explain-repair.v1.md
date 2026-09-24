<!-- prompt: explain-repair/v1 — sent once when the explainer's first output fails validation. -->

Your previous reply could not be used because it failed validation.

<request>{{REQUEST}}</request>

<context>
{{CONTEXT}}
</context>

<previous_output>
{{PREVIOUS_OUTPUT}}
</previous_output>

<validation_errors>
{{ERRORS}}
</validation_errors>

Return a corrected Explanation for the same request that fixes every error listed above and
follows every rule in the system prompt. Respond with the JSON object only: no prose, no Markdown,
no code fences.
