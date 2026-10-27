import readline from "node:readline";
import { CliError } from "./errors.js";

export function promptLine(question, { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

export function promptSecret(question, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== "function") return Promise.reject(new CliError("Secure key entry requires an interactive terminal. Set QUERYRA_GEMINI_API_KEY in the environment instead.", 3));
  return new Promise((resolve, reject) => {
    output.write(question);
    let value = "";
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          output.write("\n");
          reject(new CliError("Setup cancelled.", 3));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          output.write("\n");
          resolve(value.trim());
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}
