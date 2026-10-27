import path from "node:path";
import { discoverCsvFiles, displayDatasetDirectory, resolveCsvPath } from "./csv-source.js";
import { CliError } from "./errors.js";
import { selectMenu } from "./selector.js";

export async function selectCsvDataset({ file, directory, cwd = process.cwd(), command = "schema", interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY), choose = selectMenu, output = process.stdout }) {
  if (file) {
    const filePath = await resolveCsvPath(file, cwd);
    output.write(`Dataset directory: ${displayDatasetDirectory(path.dirname(filePath), cwd)}\n`);
    output.write(`Dataset: ${path.basename(filePath)}\n`);
    return { filePath, selectedBy: "file" };
  }

  const targetDirectory = directory || cwd;
  const discovered = await discoverCsvFiles(targetDirectory, { cwd });
  if (!discovered.files.length) {
    throw new CliError(`No CSV datasets found in ${discovered.directory}. Move to the directory containing your CSV files with cd, or use \`queryra ${command} --dir ".\\datasets"\` or \`queryra ${command} --file ".\\datasets\\sales.csv"\`. Queryra does not scan subdirectories automatically.`, 5);
  }
  output.write(`Dataset directory: ${displayDatasetDirectory(discovered.directory, cwd)}\n`);

  if (discovered.files.length === 1) {
    const filePath = await resolveCsvPath(discovered.files[0]);
    output.write(`Dataset: ${path.basename(filePath)}\n`);
    return { filePath, selectedBy: "automatic" };
  }

  if (!interactive) {
    throw new CliError(`Found ${discovered.files.length} CSV datasets in ${discovered.directory}. Choose one explicitly with --file "path.csv".`, 5);
  }
  const filePath = await choose(discovered.files.map((candidate) => ({ label: path.basename(candidate), value: candidate })), {
    title: "Choose a dataset",
    output,
  });
  const validated = await resolveCsvPath(filePath);
  output.write(`Dataset: ${path.basename(validated)}\n`);
  return { filePath: validated, selectedBy: "interactive" };
}
