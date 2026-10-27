import readline from "node:readline";
import { CliError } from "./errors.js";

export function nextMenuIndex(index, direction, count) {
  if (count < 1) return 0;
  return (index + direction + count) % count;
}

export function selectMenu(items, { title = "Select a dataset", input = process.stdin, output = process.stdout, initialIndex = 0 } = {}) {
  if (!items.length) return Promise.reject(new CliError("There are no datasets to select.", 5));
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new CliError("Dataset selection needs an interactive terminal. Use --file or run `queryra init` to configure a default dataset.", 5));
  }
  readline.emitKeypressEvents(input);
  return new Promise((resolve, reject) => {
    const previousRawMode = Boolean(input.isRaw);
    let selected = Math.max(0, Math.min(initialIndex, items.length - 1));
    let rendered = false;
    const lineCount = items.length + 2;
    const render = () => {
      if (rendered) {
        readline.moveCursor(output, 0, -lineCount);
        readline.cursorTo(output, 0);
        readline.clearScreenDown(output);
      }
      output.write(`${title}\n`);
      items.forEach((item, index) => output.write(`${index === selected ? ">" : " "} ${item.label}\n`));
      output.write("Use Up/Down arrows and Enter to choose.\n");
      rendered = true;
    };
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(previousRawMode);
      input.pause();
    };
    const onKeypress = (_character, key = {}) => {
      if (key.ctrl && (key.name === "c" || key.name === "d")) {
        cleanup();
        output.write("\n");
        reject(new CliError("Dataset selection cancelled.", 2));
      } else if (key.name === "up") {
        selected = nextMenuIndex(selected, -1, items.length);
        render();
      } else if (key.name === "down") {
        selected = nextMenuIndex(selected, 1, items.length);
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        output.write("\n");
        resolve(items[selected].value);
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKeypress);
    render();
  });
}
