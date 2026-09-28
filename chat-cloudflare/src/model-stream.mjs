const MAXIMUM_STREAM_BYTES = 1024 * 1024;
const MAXIMUM_ANSWER_CHARS = 12_000;

function eventData(frame) {
  return frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

/** Read an OpenAI-compatible SSE response without exposing reasoning_content. */
export async function readOpenAiEventStream(response, onDelta = () => {}) {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "text/event-stream" || !response.body) throw new Error("MODEL_STREAM_INVALID");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let size = 0;
  let text = "";
  let finishReason = null;

  const consume = (frame) => {
    const data = eventData(frame);
    if (!data || data === "[DONE]") return;
    let value;
    try {
      value = JSON.parse(data);
    } catch {
      throw new Error("MODEL_STREAM_INVALID");
    }
    const choice = value?.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === "string" && delta) {
      text += delta;
      if (text.length > MAXIMUM_ANSWER_CHARS) throw new Error("MODEL_STREAM_TOO_LARGE");
      onDelta(delta);
    }
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAXIMUM_STREAM_BYTES) throw new Error("MODEL_STREAM_TOO_LARGE");
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    buffer += decoder.decode().replaceAll("\r\n", "\n");
    if (buffer.trim()) consume(buffer);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  if (!text.trim()) throw new Error("MODEL_ANSWER_EMPTY");
  return { text, finishReason };
}
