const ANSI = {
  cyan: "36",
  blue: "34",
  bold: "1",
  green: "32",
  yellow: "33",
  red: "31",
};

export function colorEnabled(output = process.stdout, environment = process.env, platform = process.platform) {
  if (!output.isTTY || "NO_COLOR" in environment || environment.FORCE_COLOR === "0") return false;
  if (environment.TERM === "dumb") return false;
  if (platform === "win32") {
    return Boolean(environment.WT_SESSION || environment.ANSICON || /^ON$/i.test(environment.ConEmuANSI || "") || environment.TERM_PROGRAM || environment.TERM);
  }
  return true;
}

export function paint(text, color, { output = process.stdout, environment = process.env, platform = process.platform } = {}) {
  if (!colorEnabled(output, environment, platform)) return String(text);
  return `\u001b[${ANSI[color] || ANSI.cyan}m${text}\u001b[0m`;
}

export function writeHeader(output = process.stdout) {
  output.write(`${paint("Queryra CLI", "bold", { output })} ${paint("| Natural language to SQL", "cyan", { output })}\n`);
}

export function writeStatus(message, output = process.stdout) {
  output.write(`${paint("[i] Queryra CLI", "blue", { output })} ${message}\n`);
}

export function writeSuccess(message, output = process.stdout) {
  output.write(`${paint("[+] Queryra CLI", "green", { output })} ${message}\n`);
}

export function writeWarning(message, output = process.stdout) {
  output.write(`${paint("[!] Queryra CLI", "yellow", { output })} ${message}\n`);
}

export function writeError(message, output = process.stderr) {
  output.write(`${paint("[x] Queryra CLI", "red", { output })} ${message}\n`);
}
