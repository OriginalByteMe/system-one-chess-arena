// Runs the model off the main thread so the page stays responsive while
// gigabytes of weights are compiled and loaded. WebLLM's own handler does the
// work; this file only wires it to the worker's message port.
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message: MessageEvent): void => {
  handler.onmessage(message);
};
