import { CliArguments, MeteoraConfig } from '../utils/types';
import { parseArgs } from 'util';
import { safeParseJsonFromFile } from './utils';
import { validateConfig } from './validation';
import { parse } from 'csv-parse';
import fs from 'fs';
import path from 'path';

export function parseCliArguments(): CliArguments {
  const { values } = parseArgs({
    args: process.argv,
    options: {
      config: {
        type: 'string',
      },
    },
    strict: true,
    allowPositionals: true,
  });

  return values;
}

export async function parseConfigFromCli(): Promise<MeteoraConfig> {
  const cliArguments = parseCliArguments();
  if (!cliArguments.config) {
    throw new Error('Please provide a config file path to --config flag');
  }
  let configFilePath = cliArguments.config;

  // If the path is relative, resolve it appropriately based on where we're running from
  if (!path.isAbsolute(configFilePath)) {
    const workspaceMarker = path.join(process.cwd(), '../pnpm-workspace.yaml');
    if (fs.existsSync(workspaceMarker)) {
      if (configFilePath.startsWith('./studio/')) {
        configFilePath = configFilePath.replace('./studio/', './');
      }
      configFilePath = path.resolve(process.cwd(), configFilePath);
    } else {
      configFilePath = path.resolve(process.cwd(), configFilePath);
    }
  }

  console.log(`> Using config file: ${configFilePath}`);

  const config: MeteoraConfig = await safeParseJsonFromFile(configFilePath);

  validateConfig(config);

  return config;
}

export async function parseCsv<T>(filePath: string): Promise<Array<T>> {
  const fileStream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: true, // Use the header row as keys
      skip_empty_lines: true, // Skip empty lines
    });

    const results: T[] = [];

    fileStream
      .pipe(parser)
      .on('data', (row: T) => results.push(row)) // Collect rows
      .on('end', () => resolve(results)) // Resolve the promise with results
      .on('error', (err) => reject(err)); // Reject the promise if error occurs
  });
}
