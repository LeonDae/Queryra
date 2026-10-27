import { CliError } from "./errors.js";

export function parseOptions(args) {
  const options = { json: false, positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--file" || argument === "--dir" || argument === "--limit") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`${argument} requires a value.`, 2);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--json") options.json = true;
    else if (argument.startsWith("--")) throw new CliError(`Unknown option: ${argument}`, 2);
    else options.positional.push(argument);
  }
  return options;
}
